import { expect, test, type Page } from '@playwright/test';
import { registerWithHero } from './support/auth-helpers';
import { grantPoweredItem, type AffixRollFixture } from './support/game-fixtures';

/**
 * Character stats and gear comparison (ADR-030), against the real API and
 * PostgreSQL. A level-1 hero starts at 10 Damage, 100 Max Health, 1.00 attack
 * per second, 5% Critical Chance and 150% Critical Damage. Every value
 * asserted here is rendered from a server response; the test only arranges
 * owned items directly in the database.
 */

const flatDamage = (value: string): AffixRollFixture => ({
  affixDefinitionId: 'damage_flat',
  stat: 'DAMAGE',
  operation: 'FLAT',
  value,
});
const critChance = (value: string): AffixRollFixture => ({
  affixDefinitionId: 'critical_chance_flat',
  stat: 'CRITICAL_CHANCE',
  operation: 'FLAT',
  value,
});
const critDamage = (value: string): AffixRollFixture => ({
  affixDefinitionId: 'critical_damage_percent',
  stat: 'CRITICAL_DAMAGE',
  operation: 'ADDITIVE_PERCENT',
  value,
});

function stat(page: Page, id: string) {
  return page.locator(`.stat-tile[data-stat="${id}"] .stat-tile__value`);
}

function detail(page: Page) {
  return page.getByRole('dialog');
}

function comparisonRow(page: Page, id: string) {
  return detail(page).locator(`.comparison-row[data-stat="${id}"]`);
}

test.describe('character stats and gear comparison', () => {
  test('compare, equip, reload and unequip: the sheet shows what the preview promised', async ({
    page,
  }) => {
    const account = await registerWithHero(page);
    await grantPoweredItem(account.heroName, 'forged_iron_sword', 'RARE', [
      flatDamage('1.8e1'),
      critDamage('700'),
    ]);
    await page.goto('/play/gear');

    await expect(page.getByRole('heading', { name: account.heroName })).toBeVisible();
    await expect(stat(page, 'DAMAGE')).toHaveText('10');
    await expect(stat(page, 'MAX_HEALTH')).toHaveText('100');
    await expect(stat(page, 'ATTACK_SPEED')).toHaveText('1.00 / sec');
    await expect(stat(page, 'CRITICAL_CHANCE')).toHaveText('5.00%');
    await expect(stat(page, 'CRITICAL_DAMAGE')).toHaveText('150.00%');

    await page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, unequipped' }).click();
    await expect(detail(page).getByText('Fills your empty Weapon slot')).toBeVisible();
    await expect(comparisonRow(page, 'DAMAGE').locator('.comparison-row__current')).toHaveText(
      '10',
    );
    await expect(comparisonRow(page, 'DAMAGE').locator('.comparison-row__delta')).toHaveText(
      '↑ +18',
    );
    await expect(comparisonRow(page, 'CRITICAL_DAMAGE')).toContainText('150.00%→160.50%');
    await expect(detail(page).getByText('Damage increases by 18', { exact: false })).toBeAttached();
    const promisedDamage = await comparisonRow(page, 'DAMAGE')
      .locator('.comparison-row__after')
      .textContent();
    expect(promisedDamage).toBe('28');

    await detail(page).getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(detail(page)).toBeHidden();
    await expect(stat(page, 'DAMAGE')).toHaveText(promisedDamage ?? '');
    await expect(stat(page, 'CRITICAL_DAMAGE')).toHaveText('160.50%');
    await expect(
      page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, equipped' }),
    ).toBeFocused();

    await page.reload();
    await expect(stat(page, 'DAMAGE')).toHaveText('28');

    await page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, equipped' }).click();
    await expect(detail(page).getByRole('heading', { name: 'If you unequip this' })).toBeVisible();
    await expect(comparisonRow(page, 'DAMAGE').locator('.comparison-row__after')).toHaveText('10');
    await expect(comparisonRow(page, 'DAMAGE').locator('.comparison-row__delta')).toHaveText(
      '↓ -18',
    );
    await detail(page).getByRole('button', { name: 'Unequip', exact: true }).click();
    await expect(detail(page)).toBeHidden();
    await expect(stat(page, 'DAMAGE')).toHaveText('10');
    await expect(stat(page, 'CRITICAL_DAMAGE')).toHaveText('150.00%');

    await page.reload();
    await expect(stat(page, 'DAMAGE')).toHaveText('10');
    await expect(
      page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, unequipped' }),
    ).toBeVisible();
  });

  test('a replacement names the item it replaces, and the new build equals the preview', async ({
    page,
  }) => {
    const account = await registerWithHero(page);
    await grantPoweredItem(account.heroName, 'forged_iron_sword', 'MAGIC', [flatDamage('1e1')]);
    await grantPoweredItem(account.heroName, 'forged_iron_sword', 'RARE', [
      flatDamage('2.5e1'),
      critChance('300'),
    ]);
    await page.goto('/play/gear');

    await page.getByRole('button', { name: 'MAGIC Forged Iron Sword, Weapon, unequipped' }).click();
    await detail(page).getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(detail(page)).toBeHidden();
    await expect(stat(page, 'DAMAGE')).toHaveText('20');

    await page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, unequipped' }).click();
    await expect(detail(page).getByTestId('replaces')).toHaveText(
      'Replaces MAGIC Forged Iron Sword',
    );
    await expect(comparisonRow(page, 'DAMAGE')).toContainText('20→35');
    await expect(comparisonRow(page, 'CRITICAL_CHANCE')).toContainText('5.00%→8.00%');
    await expect(
      detail(page).getByText('Unchanged: Max Health, Attack Speed, Critical Damage'),
    ).toBeVisible();
    const promised = await comparisonRow(page, 'DAMAGE')
      .locator('.comparison-row__after')
      .textContent();

    await detail(page).getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(detail(page)).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'RARE Forged Iron Sword, Weapon, equipped' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'MAGIC Forged Iron Sword, Weapon, unequipped' }),
    ).toBeVisible();
    await expect(stat(page, 'DAMAGE')).toHaveText(promised ?? '');
    await expect(stat(page, 'CRITICAL_CHANCE')).toHaveText('8.00%');
    await expect(page.getByRole('button', { name: /Forged Iron Sword/u })).toHaveCount(2);
    await expect(page.getByText('1 available')).toBeVisible();
  });

  test('a zero-power Common item compares as no effective stat change', async ({ page }) => {
    const account = await registerWithHero(page);
    await grantPoweredItem(account.heroName, 'emberguard_helm', 'COMMON', []);
    await page.goto('/play/gear');
    await page.getByRole('button', { name: 'COMMON Emberguard Helm, Helmet, unequipped' }).click();
    await expect(detail(page).getByText('No effective stat change')).toBeVisible();
    await expect(detail(page).locator('.comparison-row')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(detail(page)).toBeHidden();
  });

  test('phones: readable stats, a scrollable sheet and a reachable Equip, without overflow', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Phone viewports only.');
    const account = await registerWithHero(page);
    await grantPoweredItem(account.heroName, 'runed_iron_ring', 'EPIC', [
      flatDamage('1.2e1'),
      critChance('250'),
    ]);
    await grantPoweredItem(account.heroName, 'runed_iron_ring', 'MYTHIC', [
      flatDamage('2.5e1'),
      critChance('500'),
      critDamage('1000'),
      {
        affixDefinitionId: 'max_health_flat',
        stat: 'MAX_HEALTH',
        operation: 'FLAT',
        value: '8e1',
      },
      {
        affixDefinitionId: 'attack_speed_percent',
        stat: 'ATTACK_SPEED',
        operation: 'ADDITIVE_PERCENT',
        value: '750',
      },
    ]);
    await page.goto('/play/gear');
    await page.getByRole('button', { name: 'EPIC Runed Iron Ring, Ring, unequipped' }).click();
    await detail(page).getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(detail(page)).toBeHidden();

    for (const viewport of [
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/play/gear');
      await expect(stat(page, 'DAMAGE')).toHaveText('22');
      for (const id of ['DAMAGE', 'MAX_HEALTH', 'ATTACK_SPEED', 'CRITICAL_CHANCE']) {
        await expect(stat(page, id)).toBeInViewport();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);

      await page.getByRole('button', { name: 'MYTHIC Runed Iron Ring, Ring, unequipped' }).click();
      await expect(detail(page).getByTestId('replaces')).toHaveText(
        'Replaces EPIC Runed Iron Ring',
      );
      await expect(comparisonRow(page, 'DAMAGE')).toContainText('22→35');
      const equip = detail(page).getByRole('button', { name: 'Equip', exact: true });
      await expect(equip).toBeInViewport();
      const sheet = await detail(page).evaluate((element) => ({
        overflowX: element.scrollWidth > element.clientWidth,
        insideViewport: element.getBoundingClientRect().right <= window.innerWidth,
      }));
      expect(sheet).toEqual({ overflowX: false, insideViewport: true });

      // The sheet scrolls on its own while the action stays reachable.
      await detail(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(comparisonRow(page, 'ATTACK_SPEED')).toBeVisible();
      await expect(equip).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(detail(page)).toBeHidden();
    }
  });
});
