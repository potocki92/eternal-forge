import { expect, test, type Page } from '@playwright/test';
import { newAccount, register, registerWithHero } from './support/auth-helpers';
import { placeHeroOnStage } from './support/game-fixtures';

/**
 * The Phase 3 gameplay loop through the browser, against the real API and
 * PostgreSQL (ADR-019). Nothing here inspects canvas pixels: the combat's
 * state is read from the DOM that mirrors the scene (ADR-007).
 */

// A stage-1 combat lasts about 4 s of real time; a boss defeat about 11 s.
const COMBAT_TIMEOUT = 30_000;

const report = (page: Page) => page.getByTestId('combat-report');
const fightButton = (page: Page) => page.getByTestId('fight-button');

async function fightAndWait(page: Page, outcome: 'WIN' | 'LOSS'): Promise<void> {
  await expect(fightButton(page)).toBeEnabled({ timeout: COMBAT_TIMEOUT });
  await fightButton(page).click();
  await expect(report(page)).toHaveAttribute('data-phase', /requesting|fighting|finished/u);
  await expect(report(page)).toHaveAttribute('data-outcome', outcome, { timeout: COMBAT_TIMEOUT });
}

test.describe('the gameplay loop', () => {
  test('fight → reward → next stage → next enemy, and progress survives a reload', async ({
    page,
  }) => {
    await registerWithHero(page);

    await expect(page.getByTestId('combat-status')).toHaveText('Stage 1: Husk awaits.');
    await expect(page.getByTestId('hud-stage')).toHaveText('1');
    await expect(page.getByTestId('hud-gold')).toHaveText('0');
    // The combat scene started (WebGL, or its canvas fallback) — not inspected.
    await expect(page.locator('[data-scene]')).toHaveAttribute('data-scene', 'ready');

    await fightAndWait(page, 'WIN');

    await expect(page.getByTestId('outcome-banner')).toHaveText('Victory!');
    await expect(page.getByTestId('combat-status')).toHaveText(
      'Victory! Stage 1 cleared. +5 gold, +3 experience.',
    );
    await expect(page.getByTestId('reward-gold')).toHaveText('+5 gold');
    await expect(page.getByTestId('hud-stage')).toHaveText('2');
    await expect(page.getByTestId('hud-gold')).toHaveText('5');
    await expect(page.getByTestId('next-encounter')).toHaveText('Next: Stage 2: Husk');

    await page.reload();
    await expect(page.getByTestId('hud-stage')).toHaveText('2');
    await expect(page.getByTestId('hud-gold')).toHaveText('5');
    await expect(page.getByTestId('combat-status')).toHaveText('Stage 2: Husk awaits.');

    await fightAndWait(page, 'WIN');
    await expect(page.getByTestId('hud-stage')).toHaveText('3');
    await expect(page.getByTestId('hud-gold')).toHaveText('10');
  });

  test('a burst of taps starts exactly one combat', async ({ page }) => {
    await registerWithHero(page);
    const combatRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/combats')) {
        combatRequests.push(request.url());
      }
    });

    await expect(fightButton(page)).toBeEnabled();
    await fightButton(page).dblclick();
    await expect(report(page)).toHaveAttribute('data-outcome', 'WIN', {
      timeout: COMBAT_TIMEOUT,
    });

    expect(combatRequests).toHaveLength(1);
    await expect(page.getByTestId('hud-stage')).toHaveText('2');
  });

  test('a boss stage looks and plays as the server defines it', async ({ page }) => {
    const account = await registerWithHero(page);
    await placeHeroOnStage(account.heroName, 10n);
    await page.reload();

    await expect(page.getByTestId('battlefield')).toHaveAttribute('data-stage-kind', 'BOSS');
    await expect(page.getByTestId('boss-badge')).toBeVisible();
    await expect(page.getByTestId('enemy-name')).toHaveText('Warden');
    await expect(page.getByText('Boss stage')).toBeVisible();
    await expect(fightButton(page)).toHaveText('Fight boss');

    // A level-1 hero cannot beat the stage-10 boss under rules v1.
    await fightAndWait(page, 'LOSS');

    await expect(page.getByTestId('outcome-banner')).toHaveText('Defeat');
    await expect(page.getByTestId('combat-status')).toHaveText(
      'Defeat on stage 10. No rewards. Your hero falls back to stage 9.',
    );
    await expect(page.getByTestId('hud-stage')).toHaveText('9');
    await expect(page.getByTestId('hud-gold')).toHaveText('0');
    await expect(page.getByTestId('next-encounter')).toHaveText('Next: Stage 9: Husk');
  });

  test('another account never sees the previous player’s progress', async ({ page }) => {
    await registerWithHero(page);
    await fightAndWait(page, 'WIN');
    await expect(page.getByTestId('hud-gold')).toHaveText('5');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/u);
    const second = newAccount();
    await register(page, second);
    await page.getByLabel('Display name').fill(second.displayName);
    await page.getByLabel('Hero name').fill(second.heroName);
    await page.getByRole('button', { name: 'Begin' }).click();

    await expect(page.getByTestId('signed-in-as')).toHaveText(second.displayName);
    await expect(page.getByTestId('hud-stage')).toHaveText('1');
    await expect(page.getByTestId('hud-gold')).toHaveText('0');
    await expect(page.getByTestId('combat-report')).toHaveAttribute('data-phase', 'waiting');
  });
});
