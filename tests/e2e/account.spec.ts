import { expect, test } from '@playwright/test';

/**
 * E2E dla S-31 Phase 2: strona /account
 *
 * - Nawigacja przez link „Moje konto" w nagłówku.
 * - Blok statystyk widoczny (realne dane z lokalnej Supabase w CI — 0 dla
 *   świeżego usera; asercja na present, nie na konkretną kwotę).
 * - Edycja display_name: PATCH mockowany przez page.route (nie mutuje
 *   współdzielonego konta auth.setup.ts).
 */

const DISPLAY_NAME_NEW = `TestUser-${Date.now()}`;

test('/account → sekcje widoczne, edycja display_name z mock PATCH', async ({ page }) => {
  // Setup PATCH mock przed nawigacją — trafi w wywołanie z AccountIsland.
  await page.route('**/api/account/profile', (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            profile: {
              id: '00000000-0000-4000-8000-000000000001',
              display_name: DISPLAY_NAME_NEW,
            },
          },
        }),
      });
    }
    return route.continue();
  });

  // Nawigacja przez link nav — testuje zarówno link jak i dostępność strony.
  await page.goto('/shelves');
  await page.getByTestId('nav-account').click();
  await page.waitForURL('/account');

  // Sekcje kluczowe widoczne.
  await expect(page.getByTestId('account-profile-section')).toBeVisible();
  await expect(page.getByTestId('account-keys-placeholder')).toBeVisible();

  // Blok statystyk — poczekaj na koniec ładowania (success lub error).
  await expect(
    page
      .getByTestId('account-stats-content')
      .or(page.getByTestId('account-stats-error'))
  ).toBeVisible({ timeout: 8_000 });

  // Edycja display_name.
  const input = page.getByTestId('account-display-name-input');
  await input.fill(DISPLAY_NAME_NEW);
  await page.getByTestId('account-display-name-save').click();

  // Potwierdzenie zapisu widoczne.
  await expect(page.getByTestId('account-display-name-success')).toBeVisible({ timeout: 5_000 });
});
