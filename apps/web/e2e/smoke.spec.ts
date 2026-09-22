import { expect, test } from '@playwright/test';

test.describe('foundation smoke', () => {
  test('start page renders on the primary design viewport', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Eternal Forge', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open system status' })).toBeVisible();
  });

  test('page has no horizontal overflow', async ({ page }) => {
    await page.goto('/');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('status page reports the API as unreachable when it is not running', async ({ page }) => {
    // The API is deliberately not started for this suite: the web application
    // must degrade to a readable message rather than a blank screen.
    await page.route('**/health/ready', (route) => route.abort('connectionrefused'));
    await page.goto('/status');

    await expect(page.getByRole('heading', { name: 'System status', level: 1 })).toBeVisible();
    await expect(page.getByText(/could not be reached/i)).toBeVisible();
  });

  test('web application exposes its own liveness endpoint', async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', service: 'eternal-forge-web' });
  });
});
