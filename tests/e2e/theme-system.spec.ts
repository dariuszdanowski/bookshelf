import { expect, test } from '@playwright/test';

/**
 * E2E dla Pakietu D2 (M17): tryb „systemowy" motywu.
 *
 * Ryzyka pokryte:
 *  - default (brak wpisu w localStorage) = systemowy: inline <head> script
 *    rozwiązuje prefers-color-scheme PRZED renderem (bez FOUC)
 *  - zmiana schematu OS W TRAKCIE sesji przełącza motyw na żywo (listener
 *    matchMedia w ThemeToggle) — bez przeładowania strony
 *  - jawny wybór (ciemny) wygrywa z systemem i przeżywa reload
 *
 * emulateMedia({ colorScheme }) emuluje prefers-color-scheme + odpala
 * eventy 'change' na matchMedia — dokładnie ścieżka produkcyjna.
 */

test('M17: brak preferencji + ciemny OS → html.dark od pierwszego renderu', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/shelves');
  await expect(page.getByTestId('shelves-island')).toBeVisible();

  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('bookshelf:theme-mode'))).toBeNull();
});

test('M17: tryb systemowy reaguje na zmianę OS na żywo (bez reloadu)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/shelves');
  await expect(page.getByTestId('theme-toggle')).toBeVisible();

  // default = systemowy (segment aktywny), jasny OS → brak .dark
  await expect(page.getByTestId('theme-mode-system')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  // OS przechodzi na ciemny w trakcie sesji → listener przełącza motyw
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);

  // i z powrotem
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('M17: jawny wybór ciemnego wygrywa z jasnym OS i przeżywa reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/shelves');
  await expect(page.getByTestId('theme-toggle')).toBeVisible();

  await page.getByTestId('theme-mode-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('bookshelf:theme-mode'))).toBe('dark');

  await page.reload();
  await expect(page.getByTestId('shelves-island')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  // jawny ciemny NIE słucha OS — zmiana schematu nic nie zmienia
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('M17: powrót na systemowy podejmuje schemat OS', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    window.localStorage.setItem('bookshelf:theme-mode', 'light');
  });
  await page.goto('/shelves');
  await expect(page.getByTestId('theme-toggle')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dark/); // jawny light

  await page.getByTestId('theme-mode-system').click();
  await expect(page.locator('html')).toHaveClass(/dark/); // OS ciemny
  expect(await page.evaluate(() => localStorage.getItem('bookshelf:theme-mode'))).toBe('system');
});
