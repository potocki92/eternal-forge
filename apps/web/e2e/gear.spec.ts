import { expect, test } from '@playwright/test';
import { registerWithHero } from './support/auth-helpers';
import { grantItem } from './support/game-fixtures';

test.describe('inventory and equipment', () => {
  test('equip and unequip persist through reload', async ({ page }) => {
    const account = await registerWithHero(page);
    await grantItem(account.heroName, 'forged_iron_sword', 'RARE');
    await page.goto('/play/gear');
    await page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, unequipped' }).click();
    await page.getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, equipped' }),
    ).toBeVisible();
    await expect(page.getByText('No items waiting')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, equipped' }).click();
    await page.getByRole('button', { name: 'Unequip', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, unequipped' }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, unequipped' }),
    ).toBeVisible();
  });

  test('equipping a replacement returns the former weapon to inventory', async ({ page }) => {
    const account = await registerWithHero(page);
    await grantItem(account.heroName, 'forged_iron_sword', 'COMMON', true);
    await grantItem(account.heroName, 'forged_iron_sword', 'LEGENDARY');
    await page.goto('/play/gear');
    await page
      .getByRole('button', { name: 'LEGENDARY Forged Iron Sword, Weapon, unequipped' })
      .click();
    await page.getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'LEGENDARY Forged Iron Sword, Weapon, equipped' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'COMMON Forged Iron Sword, Weapon, unequipped' }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'LEGENDARY Forged Iron Sword, Weapon, equipped' }),
    ).toBeVisible();
  });

  test('an empty loadout is intentional', async ({ page }) => {
    await registerWithHero(page);
    await page.goto('/play/gear');
    await expect(page.getByText('No items waiting')).toBeVisible();
    await expect(page.getByText('Empty', { exact: true })).toHaveCount(7);
  });
});
