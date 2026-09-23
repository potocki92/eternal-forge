import { expect, test } from '@playwright/test';
import {
  PASSWORD,
  expectPlayerShell,
  newAccount,
  register,
  registerWithHero,
  revokeSessions,
  signIn,
  tamperStoredSession,
} from './support/auth-helpers';

test.describe('protected routes', () => {
  test('an anonymous visitor is sent from the game to sign-in', async ({ page }) => {
    await page.goto('/play');

    await expect(page).toHaveURL(/\/login$/u);
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  });
});

test.describe('registration', () => {
  test('a new player registers, names a hero and lands in the player shell', async ({ page }) => {
    const account = newAccount();

    await register(page, account);
    await expect(page).toHaveURL(/\/play$/u);
    await page.getByLabel('Display name').fill(account.displayName);
    await page.getByLabel('Hero name').fill(account.heroName);
    await page.getByRole('button', { name: 'Begin' }).click();

    await expectPlayerShell(page, account);
    await expect(page.getByText('Level', { exact: true })).toBeVisible();
    await expect(page.getByTestId('signed-in-as')).toHaveText(
      `Signed in as ${account.displayName}`,
    );
  });

  test('an invalid hero name is explained before anything is sent', async ({ page }) => {
    await register(page, newAccount());

    await page.getByLabel('Display name').fill('x');
    await page.getByLabel('Hero name').fill('<script>');
    await page.getByRole('button', { name: 'Begin' }).click();

    await expect(page.getByLabel('Display name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Hero name')).toHaveAttribute('aria-invalid', 'true');
  });

  test('registering an existing email is refused with a useful message', async ({ browser }) => {
    const account = newAccount();
    const first = await browser.newPage();
    await register(first, account);
    await expect(first).toHaveURL(/\/play$/u);
    await first.close();

    const second = await browser.newPage();
    await register(second, account);

    await expect(second.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
    await second.close();
  });

  test('a short password is caught on the form', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(newAccount().email);
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/register$/u);
  });
});

test.describe('sign-in and session', () => {
  test('wrong credentials are refused without saying which part was wrong', async ({ page }) => {
    const account = await registerWithHero(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/u);

    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill(`${PASSWORD}-wrong`);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'That email and password do not match an account.' }),
    ).toBeVisible();
  });

  test('the session survives a reload and is shared with a new tab', async ({ page, context }) => {
    const account = await registerWithHero(page);

    await page.reload();
    await expectPlayerShell(page, account);

    const secondTab = await context.newPage();
    await secondTab.goto('/play');
    await expectPlayerShell(secondTab, account);
  });

  test('a signed-in player skips the sign-in page', async ({ page }) => {
    await registerWithHero(page);

    await page.goto('/login');

    await expect(page).toHaveURL(/\/play$/u);
  });
});

test.describe('sign-out', () => {
  test('signing out returns to sign-in and locks the game again', async ({ page }) => {
    const account = await registerWithHero(page);

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login\?reason=signed-out$/u);
    await expect(
      page.getByRole('status').filter({ hasText: 'You have been signed out.' }),
    ).toBeVisible();
    await expect(page.getByText(account.displayName)).toHaveCount(0);

    await page.goto('/play');
    await expect(page).toHaveURL(/\/login$/u);
  });

  test("the next account never sees the previous account's data", async ({ page }) => {
    const first = await registerWithHero(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/u);

    const second = newAccount();
    await register(page, second);
    await expect(page.getByRole('heading', { name: 'Name your hero' })).toBeVisible();
    await expect(page.getByText(first.displayName)).toHaveCount(0);
    await expect(page.getByText(first.heroName)).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, first);
    await expectPlayerShell(page, first);
  });

  test('signing out in one tab signs out the other', async ({ page, context }) => {
    await registerWithHero(page);
    const otherTab = await context.newPage();
    await otherTab.goto('/play');
    await expect(otherTab.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(otherTab).toHaveURL(/\/login/u);
  });
});

test.describe('session expiry', () => {
  test('an expired session that cannot be refreshed returns the player to sign-in', async ({
    page,
  }) => {
    const account = await registerWithHero(page);
    await revokeSessions(page, account.email);
    await tamperStoredSession(page, { expired: true });

    await page.reload();

    await expect(page).toHaveURL(/\/login/u);
    await expect(page.getByText(account.displayName)).toHaveCount(0);
  });

  test('a token the API rejects ends the session with an explanation', async ({ page }) => {
    const account = await registerWithHero(page);
    await revokeSessions(page, account.email);
    // Well-formed but not signed by the identity provider. Built at runtime so
    // no token-like literal is committed (secret scanners flag those).
    const unsignedToken = [{ alg: 'ES256' }, { sub: 'x' }, 'signature']
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.');
    await tamperStoredSession(page, { accessToken: unsignedToken });

    await page.reload();

    await expect(page).toHaveURL(/\/login\?reason=expired$/u);
    await expect(page.getByText('Your session has expired. Please sign in again.')).toBeVisible();
  });
});
