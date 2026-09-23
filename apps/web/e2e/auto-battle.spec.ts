import { expect, test, type Page } from '@playwright/test';
import { registerWithHero, signIn } from './support/auth-helpers';
import { placeHeroOnStage, recordedCombats } from './support/game-fixtures';

/**
 * Online auto-battle through the browser, against the real API and
 * PostgreSQL (ADR-022). The loop sends the ordinary combat request; every
 * assertion reads the DOM, the network or the database — never pixels, never
 * an animation frame.
 */

const COMBAT_TIMEOUT = 30_000;

const stageMode = (page: Page) => page.getByTestId('stage-mode');
const autoStatus = (page: Page) => page.getByTestId('auto-battle-status');

/** Counts the combats the server committed for this page (201 answers). */
function countCommittedCombats(page: Page): () => number {
  let committed = 0;
  page.on('response', (response) => {
    if (
      response.request().method() === 'POST' &&
      /\/combats$/u.test(new URL(response.url()).pathname) &&
      response.status() === 201
    ) {
      committed += 1;
    }
  });
  return () => committed;
}

/** Counts every combat request the page sends, answered or not. */
function countCombatRequests(page: Page): () => number {
  let sent = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/combats$/u.test(new URL(request.url()).pathname)) {
      sent += 1;
    }
  });
  return () => sent;
}

async function selectFarm(page: Page, stage: string): Promise<void> {
  const toggle = page.getByTestId('stage-selector-toggle');
  await expect(toggle).toBeEnabled({ timeout: COMBAT_TIMEOUT });
  await toggle.click();
  await page.getByRole('radio', { name: 'Stay on this stage' }).check();
  await page.getByLabel('Stage to farm').fill(stage);
  await page.getByTestId('stage-selection-submit').click();
  await expect(stageMode(page)).toHaveText(`Farming stage ${stage} · stays on this stage`);
}

async function selectClimbing(page: Page): Promise<void> {
  const toggle = page.getByTestId('stage-selector-toggle');
  await expect(toggle).toBeEnabled({ timeout: COMBAT_TIMEOUT });
  await toggle.click();
  await page.getByRole('radio', { name: 'Continue climbing' }).check();
  await page.getByTestId('stage-selection-submit').click();
  await expect(stageMode(page)).toContainText('Climbing');
}

test.describe('online auto battle', () => {
  test('farm on auto → stop → climb on auto → refresh keeps the server’s state', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const committed = countCommittedCombats(page);
    const sent = countCombatRequests(page);

    const account = await registerWithHero(page);
    // Arrange: stages 1–4 cleared, stage 5 reached (a state the loop would
    // take minutes to reach). Everything after this goes through the game.
    await placeHeroOnStage(account.heroName, 5n);
    await page.reload();
    await expect(page.getByTestId('hud-stage')).toHaveText('5');

    // FARM stage 2 on auto: several fights, the stage never moves, gold grows.
    await selectFarm(page, '2');
    await page.getByTestId('auto-battle-start').click();
    await expect(autoStatus(page)).toHaveAttribute('data-auto-status', 'running');
    await expect(autoStatus(page)).toContainText('Auto battle · Farming stage 2');
    await expect(page.getByTestId('fight-button')).toBeHidden();

    await expect.poll(committed, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('hud-stage')).toHaveText('2');
    await expect(page.getByTestId('hud-best-cleared')).toHaveText('4');
    await expect(page.getByTestId('hud-gold')).not.toHaveText('0');

    // Stop: whatever is in flight completes; nothing new starts.
    await page.getByTestId('auto-battle-stop').click();
    await expect(page.getByTestId('fight-button')).toBeVisible({ timeout: COMBAT_TIMEOUT });
    await expect(autoStatus(page)).toBeHidden();
    const requestsAtStop = sent();
    // Longer than a stage-2 fight plus the pause between fights.
    await page.waitForTimeout(12_000);
    expect(sent()).toBe(requestsAtStop);

    const farmed = await recordedCombats(account.heroName);
    expect(farmed.length).toBe(committed());
    expect(farmed.every((run) => run.stage === '2' && run.stageMode === 'FARM')).toBe(true);

    // PROGRESS on auto: the server moves the hero from its frontier, stage 5.
    await selectClimbing(page);
    await expect(page.getByTestId('hud-stage')).toHaveText('5');
    await page.getByTestId('auto-battle-start').click();
    await expect(autoStatus(page)).toContainText('Auto battle · Climbing');
    await expect(page.getByTestId('hud-stage')).toHaveText('6', { timeout: 60_000 });
    await page.getByTestId('auto-battle-stop').click();
    await expect(page.getByTestId('fight-button')).toBeVisible({ timeout: COMBAT_TIMEOUT });

    // Refresh: auto-battle is off, the progress is the server's.
    const stage = await page.getByTestId('hud-stage').textContent();
    const best = await page.getByTestId('hud-best-cleared').textContent();
    await page.reload();
    await expect(page.getByTestId('hud-stage')).toHaveText(stage ?? '');
    await expect(page.getByTestId('hud-best-cleared')).toHaveText(best ?? '');
    await expect(stageMode(page)).toContainText('Climbing');
    await expect(autoStatus(page)).toBeHidden();
    await expect(page.getByTestId('auto-battle-start')).toBeEnabled();

    // Every committed fight occupied the hero for its whole duration.
    const runs = await recordedCombats(account.heroName);
    for (let index = 1; index < runs.length; index += 1) {
      const previous = runs[index - 1];
      const current = runs[index];
      if (previous !== undefined && current !== undefined) {
        expect(current.createdAt.getTime() - previous.createdAt.getTime()).toBeGreaterThanOrEqual(
          previous.durationMs,
        );
      }
    }
  });

  test('two tabs on auto share one hero’s time: no extra fights', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const first = await context.newPage();
    const account = await registerWithHero(first);
    const second = await context.newPage();
    await second.goto('/play');
    await expect(second.getByTestId('hud-stage')).toBeVisible();

    await first.getByTestId('auto-battle-start').click();
    await second.getByTestId('auto-battle-start').click();
    await first.waitForTimeout(25_000);
    await first.getByTestId('auto-battle-stop').click();
    await second.getByTestId('auto-battle-stop').click();
    await expect(first.getByTestId('fight-button')).toBeVisible({ timeout: COMBAT_TIMEOUT });
    await expect(second.getByTestId('fight-button')).toBeVisible({ timeout: COMBAT_TIMEOUT });

    const runs = await recordedCombats(account.heroName);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < runs.length; index += 1) {
      const previous = runs[index - 1];
      const current = runs[index];
      if (previous !== undefined && current !== undefined) {
        expect(current.createdAt.getTime() - previous.createdAt.getTime()).toBeGreaterThanOrEqual(
          previous.durationMs,
        );
      }
    }
    await context.close();
  });

  test('signing out stops the loop; signing in again starts with it off', async ({ page }) => {
    test.setTimeout(90_000);
    const sent = countCombatRequests(page);
    const account = await registerWithHero(page);

    await page.getByTestId('auto-battle-start').click();
    await expect.poll(sent, { timeout: COMBAT_TIMEOUT }).toBeGreaterThanOrEqual(1);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/u);
    const requestsAtSignOut = sent();
    await page.waitForTimeout(8_000);
    expect(sent()).toBe(requestsAtSignOut);

    await signIn(page, account);
    await expect(page.getByTestId('auto-battle-start')).toBeVisible();
    await expect(autoStatus(page)).toBeHidden();
    await page.waitForTimeout(6_000);
    expect(sent()).toBe(requestsAtSignOut);
  });
});
