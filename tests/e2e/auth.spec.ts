import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

/**
 * Golden path E2E dla S-01: signup → auto-login → logout → redirect.
 *
 * Wymagane env (z .dev.vars przez Astro dev server uruchamiany w
 * playwright.config.ts webServer + tu w teście do cleanup admin call):
 *   PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Dependencies: trigger 0003 aplikowany na zlinkowanym projekcie + Supabase
 * Dashboard Auth → Settings → Confirm email = off.
 *
 * Cleanup: admin.auth.deleteUser na utworzonym e2e userze (resilient pattern,
 * Promise.allSettled). Niezależnie od pass/fail testu cleanup się odpala.
 */

const url = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(url && serviceRoleKey);

const stamp = Date.now();
const email = `e2e-auth-${stamp}@example.com`;
const password = 'e2e-Test-Password-12345!';
const displayName = `E2E User ${stamp}`;

let createdUserId = '';

// auth.spec testuje sam signup/login — musi startować anonimowo, bez współdzielonej sesji.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.configure({ mode: 'serial' });

test.describe('auth golden path', () => {
  test.skip(!hasEnv, 'brak env (PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');

  test.afterAll(async () => {
    if (!hasEnv || !createdUserId) return;
    const admin = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await Promise.allSettled([admin.auth.admin.deleteUser(createdUserId)]);
  });

  test('signup → auto-login → header pokazuje email usera', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="display_name"]', displayName);
    await page.fill('input[name="password"]', password);
    await Promise.all([page.waitForURL('/'), page.click('[data-testid="submit-signup"]')]);

    await expect(page.getByTestId('user-email')).toHaveText(email);

    // Capture user id from admin API for cleanup.
    if (hasEnv) {
      const admin = createClient(url!, serviceRoleKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data } = await admin.auth.admin.listUsers();
      const found = data.users.find((u) => u.email === email);
      if (found) createdUserId = found.id;
    }
  });

  test('logout → nav znika', async ({ page }) => {
    // Re-login first (each Playwright test gets fresh browser context).
    await page.goto('/login');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await Promise.all([page.waitForURL('/'), page.click('[data-testid="submit-login"]')]);
    await expect(page.getByTestId('user-email')).toHaveText(email);

    // Otwórz dropdown UserMenu i kliknij Wyloguj
    await page.click('[data-testid="user-menu-trigger"]');
    await Promise.all([page.waitForURL('/login'), page.click('[data-testid="user-menu-logout"]')]);
    // Po wylogowaniu header jest zawsze widoczny (S-38), ale nav-links znikają
    await expect(page.getByTestId('nav-library')).toHaveCount(0);
  });
});
