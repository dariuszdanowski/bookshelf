import { test, expect } from '@playwright/test';

// Smoke testuje anonimowy landing — wypisz się ze współdzielonej sesji storageState.
test.use({ storageState: { cookies: [], origins: [] } });

test('home page renders without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  const response = await page.goto('/');

  expect(response?.ok(), 'GET / should return 2xx').toBeTruthy();
  await expect(page).toHaveTitle(/.+/);
  expect(consoleErrors, 'no uncaught page errors').toEqual([]);
});
