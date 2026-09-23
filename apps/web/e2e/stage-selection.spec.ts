import { expect, test, type Page } from '@playwright/test';
import { registerWithHero, signIn } from './support/auth-helpers';

/**
 * Stage selection and farming through the browser, against the real API and
 * PostgreSQL (ADR-021). Every value asserted is one the server sent; the DOM,
 * not the canvas, is read.
 */

const COMBAT_TIMEOUT = 30_000;

const fightButton = (page: Page) => page.getByTestId('fight-button');
const report = (page: Page) => page.getByTestId('combat-report');
const stageMode = (page: Page) => page.getByTestId('stage-mode');

async function fightAndWin(page: Page): Promise<void> {
  await expect(fightButton(page)).toBeEnabled({ timeout: COMBAT_TIMEOUT });
  await fightButton(page).click();
  await expect(report(page)).toHaveAttribute('data-outcome', 'WIN', { timeout: COMBAT_TIMEOUT });
}

async function openSelector(page: Page): Promise<void> {
  const toggle = page.getByTestId('stage-selector-toggle');
  await expect(toggle).toBeEnabled({ timeout: COMBAT_TIMEOUT });
  await toggle.click();
  await expect(page.getByRole('group', { name: 'Where should your hero fight?' })).toBeVisible();
}

test.describe('stage selection and farming', () => {
  test('climb → farm an earlier stage → fight → refresh and relogin keep it → climb again', async ({
    page,
  }) => {
    // Four real combats with their pacing waits, a reload and a relogin.
    test.setTimeout(120_000);

    // Login and load the character.
    const account = await registerWithHero(page);
    await expect(stageMode(page)).toContainText('Climbing');

    // Progress: stages 1 and 2 cleared, the hero stands on stage 3.
    await fightAndWin(page);
    await fightAndWin(page);
    await expect(page.getByTestId('hud-stage')).toHaveText('3');
    await expect(page.getByTestId('hud-best-cleared')).toHaveText('2');

    // A locked stage cannot even be sent.
    await openSelector(page);
    await page.getByRole('radio', { name: 'Stay on this stage' }).check();
    const stageInput = page.getByLabel('Stage to farm');
    await stageInput.fill('99');
    await expect(page.getByTestId('stage-draft-error')).toHaveText(
      'Your hero has not reached that stage yet. Stages 1 to 3 are open.',
    );
    await expect(page.getByTestId('stage-selection-submit')).toBeDisabled();

    // Select an earlier stage and farm it.
    await stageInput.fill('2');
    await page.getByRole('button', { name: 'Previous stage' }).click();
    await expect(stageInput).toHaveValue('1');
    await page.getByTestId('stage-selection-submit').click();
    await expect(stageMode(page)).toHaveText('Farming stage 1 · stays on this stage');
    await expect(page.getByTestId('hud-stage')).toHaveText('1');
    // The last result stays on screen; the next enemy is the farmed stage's.
    await expect(page.getByTestId('next-encounter')).toHaveText('Next: Stage 1: Husk');
    await expect(page.getByTestId('enemy-name')).toHaveText('Husk');

    // A farm victory pays and stays; the records do not move.
    await fightAndWin(page);
    await expect(page.getByTestId('combat-status')).toHaveText(
      'Victory! Stage 1 cleared. +5 gold, +3 experience.',
    );
    await expect(page.getByTestId('next-encounter')).toHaveText('Next: Stage 1: Husk', {
      timeout: COMBAT_TIMEOUT,
    });
    await expect(page.getByTestId('hud-stage')).toHaveText('1');
    await expect(page.getByTestId('hud-best-cleared')).toHaveText('2');

    // Refresh: the choice is the server's, so it survives.
    await page.reload();
    await expect(stageMode(page)).toHaveText('Farming stage 1 · stays on this stage');
    await expect(page.getByTestId('hud-stage')).toHaveText('1');
    await expect(page.getByTestId('hud-best-cleared')).toHaveText('2');

    // Sign out and back in: still farming.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/u);
    await signIn(page, account);
    await expect(stageMode(page)).toHaveText('Farming stage 1 · stays on this stage');

    // Return to progress mode: back to the frontier, stage 3.
    await openSelector(page);
    await page.getByRole('radio', { name: 'Continue climbing' }).check();
    await page.getByTestId('stage-selection-submit').click();
    await expect(stageMode(page)).toContainText('Climbing');
    await expect(page.getByTestId('hud-stage')).toHaveText('3');
    await expect(page.getByTestId('hud-best-cleared')).toHaveText('2');

    await fightAndWin(page);
    await expect(page.getByTestId('hud-stage')).toHaveText('4');
    await expect(page.getByTestId('hud-best-cleared')).toHaveText('3');
  });

  test('the selector is keyboard operable', async ({ page }) => {
    await registerWithHero(page);
    await fightAndWin(page);
    await expect(page.getByTestId('hud-stage')).toHaveText('2');

    await openSelector(page);
    // Focus starts on the checked choice; arrows move between the choices.
    await expect(page.getByRole('radio', { name: 'Continue climbing' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'Stay on this stage' })).toBeChecked();
    await page.getByLabel('Stage to farm').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');

    await expect(stageMode(page)).toHaveText('Farming stage 1 · stays on this stage');
    await expect(page.getByTestId('stage-selector-toggle')).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('stage-selector-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('stage-selector-panel')).toBeHidden();
    await expect(page.getByTestId('stage-selector-toggle')).toBeFocused();
  });
});
