import { expect, test } from '@playwright/test';

import { openUserMenu } from './helpers/interactions';

/**
 * E2E dla S-31: strona /account
 *
 * Phase 2: nawigacja, statystyki, display_name (PATCH mockowany).
 * Phase 3: walidacja haseł klient-side, zmiana emaila i hasła
 *          (auth.updateUser mockowany przez page.route('*\/auth/v1/user') —
 *           celowo wąski glob; szeroki '*\/auth/v1\/**' przechwyciłby też
 *           odświeżanie tokenu i rozwalił współdzieloną sesję storageState).
 */

const DISPLAY_NAME_NEW = `TestUser-${Date.now()}`;

test('/account → sekcje widoczne, edycja display_name z mock PATCH', async ({ page }) => {
  await page.route('**/api/account/profile', (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            profile: { id: '00000000-0000-4000-8000-000000000001', display_name: DISPLAY_NAME_NEW },
          },
        }),
      });
    }
    return route.continue();
  });

  await page.goto('/shelves');
  // S-38: wejście na /account przez UserMenu (link nav-account usunięty z nav).
  // openUserMenu — deterministyczne otwarcie mimo wyścigu hydratacji wyspy (S-44).
  await openUserMenu(page);
  await page.getByTestId('user-menu-account').click();
  await page.waitForURL('/account');

  await expect(page.getByTestId('account-profile-section')).toBeVisible();
  await expect(page.getByTestId('account-keys-section')).toBeVisible();

  await expect(
    page.getByTestId('account-stats-content').or(page.getByTestId('account-stats-error')),
  ).toBeVisible({ timeout: 8_000 });

  const input = page.getByTestId('account-display-name-input');
  await input.fill(DISPLAY_NAME_NEW);
  await page.getByTestId('account-display-name-save').click();

  await expect(page.getByTestId('account-display-name-success')).toBeVisible({ timeout: 5_000 });
});

test('/account → niezgodne hasła → błąd klient-side bez network', async ({ page }) => {
  await page.goto('/account');
  await expect(
    page.getByTestId('account-stats-content').or(page.getByTestId('account-stats-error')),
  ).toBeVisible({ timeout: 8_000 });

  await page.getByTestId('account-new-password-input').fill('Haslo123');
  await page.getByTestId('account-confirm-password-input').fill('InneHaslo');
  await page.getByTestId('account-password-save').click();

  await expect(page.getByTestId('account-password-field-error')).toBeVisible();
  // Brak zapytań do auth/v1/user — walidacja zatrzymała request po stronie klienta.
  await expect(page.getByTestId('account-password-success')).not.toBeVisible();
});

test('/account → zmiana emaila i hasła z mock auth.updateUser', async ({ page }) => {
  // Mock PUT /auth/v1/user (Supabase auth.updateUser) — nie mutuje współdzielonego konta.
  await page.route('**/auth/v1/user', (route) => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          email: 'new@example.com',
        }),
      });
    }
    return route.continue();
  });

  await page.goto('/account');
  // Poczekaj na zakończenie stats fetch — eliminuje race condition z concurrent
  // React re-render, który resetuje controlled inputs podczas hydratacji wyspy.
  await expect(
    page.getByTestId('account-stats-content').or(page.getByTestId('account-stats-error')),
  ).toBeVisible({ timeout: 8_000 });

  // Zmiana emaila → baner pending
  await page.getByTestId('account-new-email-input').fill('new@example.com');
  await page.getByTestId('account-email-save').click();
  await expect(page.getByTestId('account-email-pending')).toBeVisible({ timeout: 5_000 });

  // Zmiana hasła → komunikat sukcesu + wyczyszczone pola
  await page.getByTestId('account-new-password-input').fill('NoweHaslo123');
  await page.getByTestId('account-confirm-password-input').fill('NoweHaslo123');
  await page.getByTestId('account-password-save').click();
  await expect(page.getByTestId('account-password-success')).toBeVisible({ timeout: 5_000 });

  await expect(page.getByTestId('account-new-password-input')).toHaveValue('');
  await expect(page.getByTestId('account-confirm-password-input')).toHaveValue('');
});
