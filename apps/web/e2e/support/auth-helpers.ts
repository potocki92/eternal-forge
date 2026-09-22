import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export const AUTH_STUB_URL = 'http://127.0.0.1:54329';
export const AUTH_STORAGE_KEY = 'eternal-forge.auth';
export const PASSWORD = 'correct-horse-battery';

export interface TestAccount {
  readonly email: string;
  readonly displayName: string;
  readonly heroName: string;
}

/** A fresh account per test, so parallel tests never share state. */
export function newAccount(): TestAccount {
  const suffix = randomUUID().slice(0, 8);
  return {
    email: `player-${suffix}@example.test`,
    displayName: `Player ${suffix}`,
    heroName: `Hero ${suffix}`,
  };
}

export async function register(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

export async function createHero(page: Page, account: TestAccount): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Name your hero' })).toBeVisible();
  await page.getByLabel('Display name').fill(account.displayName);
  await page.getByLabel('Hero name').fill(account.heroName);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expectPlayerShell(page, account);
}

export async function registerWithHero(page: Page, account: TestAccount = newAccount()) {
  await register(page, account);
  await createHero(page, account);
  return account;
}

export async function signIn(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function expectPlayerShell(page: Page, account: TestAccount): Promise<void> {
  await expect(page).toHaveURL(/\/play$/u);
  await expect(page.getByRole('heading', { name: account.displayName, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: account.heroName })).toBeVisible();
}

/** Revokes every session of the account at the identity provider. */
export async function revokeSessions(page: Page, email: string): Promise<void> {
  const response = await page.request.post(`${AUTH_STUB_URL}/__test__/revoke-sessions`, {
    data: { email },
  });
  expect(response.status()).toBe(204);
}

/** Rewrites the stored session, e.g. to simulate expiry without waiting an hour. */
export async function tamperStoredSession(
  page: Page,
  change: { readonly expired?: boolean; readonly accessToken?: string },
): Promise<void> {
  await page.evaluate(
    ({ key, expired, accessToken }) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        throw new Error('No stored session');
      }
      const session = JSON.parse(raw) as { expires_at: number; access_token: string };
      if (expired === true) {
        session.expires_at = Math.floor(Date.now() / 1000) - 60;
      }
      if (accessToken !== undefined) {
        session.access_token = accessToken;
      }
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    { key: AUTH_STORAGE_KEY, ...change },
  );
}
