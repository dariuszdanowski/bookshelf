import { expect, test } from '@playwright/test';

/**
 * E2E dla S-33: BYOK Pipeline Enforcement — PhotoUploader error handling.
 *
 * Upload form zawsze widoczny — tylko analiza LLM wymaga klucza.
 * Gdy process zwróci 403 NO_API_KEY, uploader pokazuje komunikat z linkiem do /account.
 * Wszystkie endpointy mockowane przez page.route.
 */

const PHOTO_ID = '00000000-0000-4000-8000-000000000099';

const MOCK_RECORD_RESPONSE = {
  data: {
    photo: {
      id: PHOTO_ID,
      shelf_id: '00000000-0000-4000-8000-bbbbbbbbbbbb',
      status: 'uploaded',
      detected_count: null,
      error_message: null,
      vision_cost_usd: null,
      vision_latency_ms: null,
      created_at: new Date().toISOString(),
    },
  },
};

test('PhotoUploader bez klucza — banner informacyjny + upload nadal dostępny', async ({ page }) => {
  // The test user has no API keys — real keys API returns empty list → warning banner shows
  await page.goto('/upload');

  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 5_000 });

  // Warning banner appears (non-blocking)
  await expect(page.getByTestId('photo-uploader-no-key-warning')).toBeVisible({ timeout: 5_000 });

  // Upload form still accessible — not blocked
  await expect(page.getByTestId('drop-zone')).toBeVisible();
  await expect(page.getByTestId('photo-uploader-no-key-warning').getByRole('link')).toHaveAttribute(
    'href',
    '/account',
  );
});

test('process 403 NO_API_KEY — uploader pokazuje błąd z linkiem do /account', async ({ page }) => {
  // createObjectURL override so Image.onload fires reliably
  await page.evaluate(() => {
    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    URL.createObjectURL = () => TINY_PNG;
    URL.revokeObjectURL = () => {};
  });

  await page.route('**/storage/v1/object/shelf-photos/**', (route) => {
    void route.fulfill({ status: 200, body: JSON.stringify({ Key: 'shelf-photos/mock.jpg' }) });
  });
  await page.route('**/api/photos/check-hash**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { photo: null } }),
    });
  });
  await page.route('**/api/photos', (route) => {
    if (route.request().method() === 'POST') {
      void route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_RECORD_RESPONSE),
      });
    } else {
      void route.continue();
    }
  });
  await page.route(
    (url) => url.pathname === `/api/photos/${PHOTO_ID}/process`,
    (route) => {
      void route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'NO_API_KEY', message: 'Brak aktywnego klucza API' },
        }),
      });
    },
  );

  await page.goto('/upload');
  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 5_000 });

  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles('tests/fixtures/test-shelf.jpg');

  // Error area z linkiem do /account i linkiem do wgranego zdjęcia
  await expect(page.getByTestId('error-area')).toBeVisible({ timeout: 15_000 });
  const accountLink = page.getByTestId('no-api-key-link');
  await expect(accountLink).toBeVisible();
  await expect(accountLink).toHaveAttribute('href', '/account');
  const photoLink = page.getByTestId('uploaded-photo-link');
  await expect(photoLink).toBeVisible();
  await expect(photoLink).toHaveAttribute('href', `/photos/${PHOTO_ID}`);
});
