import { offlineProgressResponseSchema } from '@eternal-forge/contracts';
import { expect, test, type Page } from '@playwright/test';
import { registerWithHero } from './support/auth-helpers';
import { placeHeroOnStage, recordedOfflineRuns, sendHeroAway } from './support/game-fixtures';

/**
 * Offline progression through the browser, against the real API and
 * PostgreSQL (ADR-023). Away time is arranged on the server's time line
 * (the database), never with the browser clock: the claim carries no time.
 */

const HOUR = 3_600_000;
const OFFLINE_PATH = /\/offline-progress$/u;

/** Every offline claim the page sends, with the server's parsed answer. */
function watchClaims(page: Page) {
  const answers: { status: number; fights: number; gold: string }[] = [];
  const bodies: (string | null)[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && OFFLINE_PATH.test(new URL(request.url()).pathname)) {
      bodies.push(request.postData());
    }
  });
  page.on('response', async (response) => {
    if (
      response.request().method() === 'POST' &&
      OFFLINE_PATH.test(new URL(response.url()).pathname) &&
      (response.status() === 200 || response.status() === 201)
    ) {
      const body = offlineProgressResponseSchema.parse(await response.json());
      answers.push({
        status: response.status(),
        fights: body.offline.fights,
        gold: body.character.gold,
      });
    }
  });
  return { answers, bodies };
}

test.describe('offline progression', () => {
  test('away → return → summary → continue → refresh never pays twice', async ({ page }) => {
    const claims = watchClaims(page);
    const account = await registerWithHero(page);
    // Arrange: stages 1–4 cleared, standing on 5; then three hours away.
    await placeHeroOnStage(account.heroName, 5n);
    await sendHeroAway(account.heroName, 3 * HOUR);

    await page.reload();

    const summary = page.getByTestId('offline-summary');
    await expect(summary).toBeVisible();
    await expect(page.getByTestId('offline-away')).toHaveText(/^3h( \d+m)?$/u);
    await expect(page.getByTestId('offline-stage')).toHaveText('4');
    await expect(page.getByTestId('offline-battles')).toHaveText(/^[\d,]+$/u);
    await expect(page.getByTestId('offline-victories')).toHaveText(/^[\d,]+$/u);
    await expect(page.getByTestId('offline-gold')).toContainText('+');
    await expect(page.getByTestId('offline-xp')).toContainText('+');

    // The screen shows the server's answer, and the server recorded it once.
    await expect.poll(() => claims.answers.some((answer) => answer.status === 201)).toBe(true);
    const collected = claims.answers.find((answer) => answer.status === 201);
    const runs = await recordedOfflineRuns(account.heroName);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.targetStage).toBe('4');
    expect(runs[0]?.fights).toBe(collected?.fights);
    // The stage and the record did not move: still on 5, best 4.
    await expect(page.getByTestId('hud-stage')).toHaveText('5');
    await expect(page.getByTestId('hud-best-cleared')).toHaveText('4');
    // The claim sent no body at all — no time, no stage, no reward.
    expect(claims.bodies.every((body) => body === null)).toBe(true);

    await page.getByTestId('offline-continue').click();
    await expect(summary).toHaveCount(0);
    const goldAfterClaim = await page.getByTestId('hud-gold').textContent();

    await page.reload();
    await expect(page.getByTestId('fight-button')).toBeEnabled();
    await expect(page.getByTestId('offline-summary')).toHaveCount(0);
    await expect(page.getByTestId('hud-gold')).toHaveText(goldAfterClaim ?? '');
    expect(await recordedOfflineRuns(account.heroName)).toHaveLength(1);
    expect(claims.answers.at(-1)?.fights).toBe(0);
  });

  test('a hero that never cleared a stage collects nothing, and sees nothing', async ({ page }) => {
    const claims = watchClaims(page);
    const account = await registerWithHero(page);
    await sendHeroAway(account.heroName, 5 * HOUR);

    await page.reload();

    await expect(page.getByTestId('fight-button')).toBeEnabled();
    await expect.poll(() => claims.answers.length).toBeGreaterThan(0);
    expect(claims.answers.every((answer) => answer.fights === 0)).toBe(true);
    await expect(page.getByTestId('offline-summary')).toHaveCount(0);
    expect(await recordedOfflineRuns(account.heroName)).toHaveLength(0);
  });

  test('a temporary failure is recoverable, and the retry pays once', async ({ page }) => {
    const account = await registerWithHero(page);
    await placeHeroOnStage(account.heroName, 3n);
    await sendHeroAway(account.heroName, HOUR);

    const keys: string[] = [];
    await page.route(OFFLINE_PATH, async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      await route.abort('connectionreset');
    });
    await page.reload();

    await expect(page.getByTestId('offline-failed')).toBeVisible({ timeout: 20_000 });
    // No combat starts behind the recovery dialog.
    await expect(page.getByTestId('fight-button')).toBeDisabled();

    await page.unroute(OFFLINE_PATH);
    const retried = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && OFFLINE_PATH.test(new URL(request.url()).pathname),
    );
    await page.getByTestId('offline-retry').click();
    expect((await retried).headers()['idempotency-key']).toBe(keys[0]);

    await expect(page.getByTestId('offline-summary')).toBeVisible();
    expect(await recordedOfflineRuns(account.heroName)).toHaveLength(1);
  });

  test('an absence beyond the cap explains that eight hours were collected', async ({ page }) => {
    const account = await registerWithHero(page);
    await placeHeroOnStage(account.heroName, 3n);
    await sendHeroAway(account.heroName, 12 * HOUR);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.reload();

    await expect(page.getByTestId('offline-cap-notice')).toContainText('Offline limit reached');
    await expect(page.getByTestId('offline-counted')).toHaveText('8h of progress collected');
    await expect(page.getByRole('dialog', { name: 'Welcome Back' })).toHaveAttribute(
      'data-reduced-motion',
      'true',
    );
  });

  test('a claim the API refuses as unauthenticated ends the session', async ({ page }) => {
    const account = await registerWithHero(page);
    await placeHeroOnStage(account.heroName, 3n);
    await sendHeroAway(account.heroName, HOUR);
    await page.route(OFFLINE_PATH, (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 401, code: 'UNAUTHENTICATED', error: 'Unauthorized' }),
      }),
    );

    await page.reload();

    await expect(page).toHaveURL(/\/login\?reason=expired$/u);
    expect(await recordedOfflineRuns(account.heroName)).toHaveLength(0);
  });
});
