import { expect, test } from '@playwright/test';

/**
 * E2E dla S-32: zarządzanie kluczami BYOK na /account
 *
 * Wszystkie wywołania /api/account/keys/* mockowane przez page.route —
 * nigdy nie trafiamy na prawdziwe API (brak klucza szyfrowania w E2E env).
 */

const MOCK_KEY = {
  id: '00000000-0000-4000-8000-000000000099',
  label: 'Mój Anthropic',
  provider: 'anthropic' as const,
  model: null,
  base_url: null,
  is_active: true,
  last_tested_at: null,
  last_test_result: null,
  created_at: '2026-06-01T10:00:00.000Z',
};

test('keys section — lista kluczy renderuje się poprawnie', async ({ page }) => {
  await page.route('**/api/account/keys', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { keys: [MOCK_KEY] } }),
      });
    }
    return route.continue();
  });

  await page.goto('/account');

  const section = page.getByTestId('account-keys-section');
  await expect(section).toBeVisible();
  await expect(page.getByTestId('account-keys-loading')).not.toBeVisible({ timeout: 5_000 });

  const row = page.getByTestId(`account-key-row-${MOCK_KEY.id}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`account-key-label-${MOCK_KEY.id}`)).toHaveText(MOCK_KEY.label);
  await expect(page.getByTestId(`account-key-active-badge-${MOCK_KEY.id}`)).toBeVisible();
});

test('keys section — dodaj klucz flow (formularz → zapis → wiersz w liście)', async ({
  page,
}) => {
  const NEW_KEY = {
    ...MOCK_KEY,
    id: '00000000-0000-4000-8000-000000000098',
    label: 'Nowy klucz',
    is_active: false,
  };

  await page.route('**/api/account/keys', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { keys: [] } }),
      });
    }
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: { key: NEW_KEY } }),
      });
    }
    return route.continue();
  });

  await page.goto('/account');
  await expect(page.getByTestId('account-keys-empty')).toBeVisible({ timeout: 5_000 });

  await page.getByTestId('account-keys-add-btn').click();
  const form = page.getByTestId('account-keys-add-form');
  await expect(form).toBeVisible();

  await page.getByTestId('account-keys-label-input').fill('Nowy klucz');
  await page.getByTestId('account-keys-value-input').fill('sk-ant-test-key-value');

  await page.getByTestId('account-keys-add-submit').click();

  await expect(form).not.toBeVisible({ timeout: 5_000 });
  const row = page.getByTestId(`account-key-row-${NEW_KEY.id}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`account-key-label-${NEW_KEY.id}`)).toHaveText('Nowy klucz');
});

test('keys section — deaktywuj klucz flow (aktywny klucz traci badge aktywny)', async ({ page }) => {
  await page.route('**/api/account/keys', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { keys: [MOCK_KEY] } }),
      });
    }
    return route.continue();
  });

  await page.route(`**/api/account/keys/${MOCK_KEY.id}`, (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { key: { ...MOCK_KEY, is_active: false } } }),
      });
    }
    return route.continue();
  });

  await page.goto('/account');

  const row = page.getByTestId(`account-key-row-${MOCK_KEY.id}`);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId(`account-key-active-badge-${MOCK_KEY.id}`)).toBeVisible();

  await page.getByTestId(`account-key-deactivate-btn-${MOCK_KEY.id}`).click();

  await expect(page.getByTestId(`account-key-active-badge-${MOCK_KEY.id}`)).not.toBeVisible({ timeout: 5_000 });
  // Klucz nadal w liście (nie usunięty)
  await expect(row).toBeVisible();
  // Przycisk Aktywuj pojawia się
  await expect(page.getByTestId(`account-key-activate-btn-${MOCK_KEY.id}`)).toBeVisible();
});

test('keys section — usuń klucz flow (klucz znika z listy po DELETE)', async ({ page }) => {
  await page.route('**/api/account/keys', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { keys: [MOCK_KEY] } }),
      });
    }
    return route.continue();
  });

  await page.route(`**/api/account/keys/${MOCK_KEY.id}`, (route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {} }),
      });
    }
    return route.continue();
  });

  await page.goto('/account');

  const row = page.getByTestId(`account-key-row-${MOCK_KEY.id}`);
  await expect(row).toBeVisible({ timeout: 5_000 });

  await page.getByTestId(`account-key-delete-btn-${MOCK_KEY.id}`).click();

  await expect(row).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('account-keys-empty')).toBeVisible();
});
