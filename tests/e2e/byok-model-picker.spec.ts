import { expect, test } from '@playwright/test';

/**
 * E2E dla byok-openai-compatible-models: przycisk "Załaduj modele" + klikalna
 * lista ze znacznikiem dostępności, w add-formie i edit-formie klucza
 * openai_compatible na /account.
 *
 * `/api/account/keys/models` mockowany przez page.route (predykat pathname,
 * zgodnie z lessons.md § „Playwright page.route() — predykat pathname
 * zamiast glob-stringa") — nigdy nie trafiamy na prawdziwy serwer OpenAI-
 * -compatible w automatach.
 */

const MODELS_RESPONSE_OK = {
  data: {
    result: 'ok',
    models: [
      { id: 'model-a', available: true },
      { id: 'model-b', available: false },
    ],
  },
};

const EXISTING_KEY = {
  id: '00000000-0000-4000-8000-0000000e0001',
  label: 'Relay lokalny',
  provider: 'openai_compatible' as const,
  model: null,
  base_url: 'https://relay.example.com',
  is_active: true,
  last_tested_at: null,
  last_test_result: null,
  created_at: '2026-07-01T10:00:00.000Z',
  request_timeout_ms: null,
  max_tokens_override: null,
};

test('add-form — załaduj modele, znaczniki dostępności, wybór modelu wypełnia pole', async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === '/api/account/keys',
    (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { keys: [] } }),
        });
      }
      return route.continue();
    },
  );

  let capturedBody: unknown = null;
  await page.route(
    (url) => url.pathname === '/api/account/keys/models',
    (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MODELS_RESPONSE_OK),
      });
    },
  );

  await page.goto('/account');
  await expect(page.getByTestId('account-keys-empty')).toBeVisible({ timeout: 5_000 });

  await page.getByTestId('account-keys-add-btn').click();
  await page.getByTestId('account-keys-provider-select').selectOption('openai_compatible');
  await page.getByTestId('account-keys-base-url-input').fill('https://relay.example.com/v1');
  await page.getByTestId('account-keys-value-input').fill('sk-relay-test');

  await page.getByTestId('account-keys-models-btn').click();

  const list = page.getByTestId('account-keys-models-list');
  await expect(list).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('account-keys-models-badge-0')).toHaveText('Dostępny');
  await expect(page.getByTestId('account-keys-models-badge-1')).toHaveText('Niedostępny');

  // Klient wysyła base_url dosłownie tak jak wpisany (z trailing /v1) — normalizacja
  // (normalizeBaseUrl) dzieje się server-side w prawdziwym endpoincie, nie w kliencie.
  expect(capturedBody).toMatchObject({
    provider: 'openai_compatible',
    base_url: 'https://relay.example.com/v1',
    key_value: 'sk-relay-test',
  });

  await page.getByTestId('account-keys-models-item-0').click();

  await expect(page.getByTestId('account-keys-model-input')).toHaveValue('model-a');
  await expect(list).not.toBeVisible();
});

test('edit-form — pole klucza puste, żądanie idzie z id klucza, nie z nowym kluczem', async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === '/api/account/keys',
    (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { keys: [EXISTING_KEY] } }),
        });
      }
      return route.continue();
    },
  );

  let capturedBody: unknown = null;
  await page.route(
    (url) => url.pathname === '/api/account/keys/models',
    (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MODELS_RESPONSE_OK),
      });
    },
  );

  await page.goto('/account');
  const row = page.getByTestId(`account-key-row-${EXISTING_KEY.id}`);
  await expect(row).toBeVisible({ timeout: 5_000 });

  await page.getByTestId(`account-key-edit-btn-${EXISTING_KEY.id}`).click();
  await page.getByTestId(`account-key-edit-models-btn-${EXISTING_KEY.id}`).click();

  const list = page.getByTestId(`account-key-edit-models-list-${EXISTING_KEY.id}`);
  await expect(list).toBeVisible({ timeout: 5_000 });

  expect(capturedBody).toMatchObject({ id: EXISTING_KEY.id });
  expect((capturedBody as { key_value?: unknown }).key_value).toBeUndefined();

  await page.getByTestId(`account-key-edit-models-item-${EXISTING_KEY.id}-1`).click();
  await expect(page.getByTestId(`account-key-edit-model-${EXISTING_KEY.id}`)).toHaveValue(
    'model-b',
  );
});

test('add-form — błąd probe (result:error) pokazuje komunikat, brak crasha', async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/api/account/keys',
    (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { keys: [] } }),
        });
      }
      return route.continue();
    },
  );

  await page.route(
    (url) => url.pathname === '/api/account/keys/models',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { result: 'error', models: [] } }),
      }),
  );

  await page.goto('/account');
  await expect(page.getByTestId('account-keys-empty')).toBeVisible({ timeout: 5_000 });

  await page.getByTestId('account-keys-add-btn').click();
  await page.getByTestId('account-keys-provider-select').selectOption('openai_compatible');
  await page.getByTestId('account-keys-base-url-input').fill('https://relay.example.com');
  await page.getByTestId('account-keys-value-input').fill('sk-bad-key');

  await page.getByTestId('account-keys-models-btn').click();

  await expect(page.getByTestId('account-keys-models-error')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('account-keys-models-list')).not.toBeVisible();
  // Formularz pozostaje w pełni użyteczny — brak crasha.
  await expect(page.getByTestId('account-keys-add-submit')).toBeEnabled();
});
