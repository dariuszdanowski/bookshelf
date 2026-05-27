import { expect, test } from '@playwright/test';

/**
 * Golden path E2E dla S-03:
 *  1. Signup nowego usera.
 *  2. /upload → widoczny uploader.
 *  3. Mock endpointu process (intercept) → symuluje sukces z detekcjami.
 *  4. Upload mock-obrazu → widoczna lista detekcji.
 *
 * Vision API jest mockowane przez interceptowanie /api/photos/<id>/process.
 * Nie wymaga ANTHROPIC_API_KEY ani prawdziwego vision call.
 * Bucket shelf-photos i Storage RLS weryfikowane manualnie po merge.
 */

const STAMP = Date.now();
const EMAIL = `e2e-upload-${STAMP}@example.com`;
const PASSWORD = 'E2eUploadPass!23';

const MOCK_PROCESS_RESPONSE = {
  data: {
    photo: {
      id: '00000000-0000-4000-8000-aaaaaaaaaaaa',
      shelf_id: '00000000-0000-4000-8000-bbbbbbbbbbbb',
      status: 'processed',
      detected_count: 2,
      error_message: null,
      vision_cost_usd: 0.005,
      vision_latency_ms: 4200,
      created_at: new Date().toISOString(),
    },
    detections: [
      { position_index: 1, raw_title: 'Solaris', raw_author: 'Stanisław Lem', vision_confidence: 0.95, spine_color: 'niebieski' },
      { position_index: 2, raw_title: 'Dune', raw_author: 'Frank Herbert', vision_confidence: 0.88, spine_color: 'brązowy' },
    ],
  },
};

const MOCK_RECORD_RESPONSE = {
  data: {
    photo: {
      id: '00000000-0000-4000-8000-aaaaaaaaaaaa',
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

test('upload flow: signup → /upload → wybór półki → upload → detekcje widoczne', async ({ page }) => {
  // 1. Signup — wait for networkidle so React island hydrates before clicking
  await page.goto('/signup');
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="display_name"]', `E2E Upload ${STAMP}`);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('[data-testid="submit-signup"]');
  await page.waitForURL('/', { timeout: 10_000 });

  // 2. Navigate to /upload via nav link
  await page.getByTestId('nav-upload').click();
  await page.waitForURL('/upload', { timeout: 5_000 });
  await expect(page.getByTestId('photo-uploader')).toBeVisible();

  // Override URL.createObjectURL in the live page so the canvas Image.onload always
  // fires with a valid tiny PNG, regardless of the test blob content.
  await page.evaluate(() => {
    const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    URL.createObjectURL = () => TINY_PNG;
    URL.revokeObjectURL = () => {};
  });

  // 3. Wait for shelves to load (selector should appear)
  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 5_000 });

  // 4. Intercept Storage upload to avoid real bucket dependency
  await page.route('**/storage/v1/object/shelf-photos/**', (route) => {
    void route.fulfill({ status: 200, body: JSON.stringify({ Key: 'shelf-photos/mock-path.jpg' }) });
  });

  // 5. Intercept /api/photos (record)
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

  // 6. Intercept /api/photos/*/process
  await page.route('**/api/photos/*/process', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROCESS_RESPONSE),
    });
  });

  // 7. Upload a real minimal JPEG (fake bytes cause Image load failed in real browser)
  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles('tests/fixtures/test-shelf.jpg');

  // 8. Detections list appears
  await expect(page.getByTestId('results-area')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('detections-list')).toBeVisible();
  await expect(page.getByTestId('detection-item-0')).toContainText('Solaris');
  await expect(page.getByTestId('detection-item-1')).toContainText('Dune');
});
