import { expect, test } from '@playwright/test';

import { createShelf, expectHoverBg } from './helpers/interactions';

/**
 * E2E dla Pakietu A2 (dark-polish, M13+M14): kontrast przycisków i hoverów
 * w trybie ciemnym — asercje na computed style (jsdom tego nie widzi,
 * to ryzyko istnieje wyłącznie w wyrenderowanym CSS).
 *
 * Ryzyka pokryte:
 *  - M14: primary „Dodaj półkę" (dawniej gray-900) znikał na ciemnym tle
 *    → po fixie bg-blue-600, widocznie różny od tła strony
 *  - M13: hover na secondary („Edytuj", hover:bg-gray-100) bielał w dark
 *    → po fixie override #1f2937 z global.css
 *
 * Dark mode włączany przed nawigacją przez localStorage (inline head script
 * czyta 'bookshelf:theme-mode' i ustawia klasę .dark na <html>).
 */

// Tailwind v4 definiuje palety w oklch — computed style zwraca oklch, nie rgb.
const BLUE_600 = 'oklch(0.546 0.245 262.881)';
const DARK_HOVER_GRAY = 'rgb(31, 41, 55)'; // #1f2937 — override z global.css
// (gray-100 #f3f4f6 = bug M13 „bieleje" — równość z DARK_HOVER_GRAY go wyklucza)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('bookshelf:theme-mode', 'dark');
  });
});

test('M14: „Dodaj półkę" w dark ma primary blue-600, kontrastowy do tła', async ({ page }) => {
  await page.goto('/shelves');
  await expect(page.getByTestId('shelves-island')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  const submit = page.getByTestId('shelf-form-submit');
  await expect(submit).toBeVisible();

  const btnBg = await submit.evaluate((el) => getComputedStyle(el).backgroundColor);
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  expect(btnBg).toBe(BLUE_600);
  expect(btnBg).not.toBe(bodyBg);
});

test('M13: hover na „Edytuj" w dark ciemnieje (#1f2937), nie bieleje', async ({ page }) => {
  const shelfName = `E2E Dark Hover ${Date.now()}`;

  await page.goto('/shelves');
  await expect(page.getByTestId('shelves-island')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  // „Zakupione" (systemowa) nie ma Edytuj — tworzymy własną półkę (cleanup niżej).
  // createShelf czeka na POST + refetch (S-44).
  await createShelf(page, shelfName);
  const row = page.locator('[data-testid^="shelf-item-"]').filter({ hasText: shelfName });
  const editButton = row.getByTestId('shelf-item-edit-button');
  await expect(editButton).toBeVisible({ timeout: 5_000 });

  // expectHoverBg polluje computed-style do ustabilizowania (S-44) — równość z
  // DARK_HOVER_GRAY implikuje „nie bieleje" (≠ gray-100 z buga M13).
  await expectHoverBg(editButton, DARK_HOVER_GRAY);

  // cleanup — usuwamy testową półkę (couple klik z odpowiedzią DELETE, S-44)
  await row.getByTestId('shelf-item-delete-button').click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/shelves/') && r.request().method() === 'DELETE' && r.ok(),
    ),
    page.getByRole('button', { name: 'Usuń półkę' }).click(),
  ]);
  await expect(page.getByTestId('shelf-item-name').filter({ hasText: shelfName })).not.toBeVisible({
    timeout: 10_000,
  });
});

test('M14: CTA na landing w dark ma primary blue-600', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);

  // storageState = zalogowany → wariant cta-library
  const cta = page.getByTestId('cta-library');
  await expect(cta).toBeVisible();
  expect(await cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(BLUE_600);
});

test('kontrola: w trybie jasnym „Dodaj półkę" też blue-600 (parytet motywów)', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('bookshelf:theme-mode', 'light');
  });
  await page.goto('/shelves');
  await expect(page.getByTestId('shelves-island')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  const submit = page.getByTestId('shelf-form-submit');
  expect(await submit.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(BLUE_600);
});
