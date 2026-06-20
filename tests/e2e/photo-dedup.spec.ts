import { expect, test, type Page } from '@playwright/test';

/**
 * E2E dla photo-dedup:
 * - SHA-256 w przeglądarce przed uploadem → GET /api/photos/check-hash (client-side early dedup)
 * - 409 DUPLICATE_PHOTO z /api/photos/upload-file (server-side dedup — działa też bez crypto.subtle na HTTP LAN)
 * - Jeśli duplikat: warning UI z opcjami (Otwórz / Anuluj)
 * - Jeśli nie duplikat: normalny upload bez ostrzeżeń
 *
 * Vision/process/match mockowane przez page.route — zero kosztu API.
 */

const PHOTO_ID = '00000000-0000-4000-8000-aaaaaaaaaaaa';
const EXISTING_PHOTO_ID = '00000000-0000-4000-8000-cccccccccccc';
const SHELF_ID = '00000000-0000-4000-8000-bbbbbbbbbbbb';
const CREATED_AT = '2026-05-01T10:00:00Z';

const MOCK_DUPLICATE_CHECK = {
  data: { photo: { id: EXISTING_PHOTO_ID, shelf_id: SHELF_ID, created_at: CREATED_AT } },
};

const MOCK_NO_DUPLICATE_CHECK = {
  data: { photo: null },
};

const MOCK_RECORD_RESPONSE = {
  data: {
    photo: {
      id: PHOTO_ID,
      shelf_id: SHELF_ID,
      status: 'uploaded',
      detected_count: null,
      error_message: null,
      vision_cost_usd: null,
      vision_latency_ms: null,
      created_at: new Date().toISOString(),
    },
  },
};

const MOCK_PROCESS_RESPONSE = {
  data: {
    photo: {
      id: PHOTO_ID,
      shelf_id: SHELF_ID,
      status: 'processed',
      detected_count: 1,
      error_message: null,
      vision_cost_usd: 0.001,
      vision_latency_ms: 3000,
      created_at: new Date().toISOString(),
    },
    detections: [
      {
        position_index: 1,
        raw_title: 'Solaris',
        raw_author: 'Stanisław Lem',
        vision_confidence: 0.95,
        spine_color: null,
      },
    ],
  },
};

const MOCK_MATCH_RESPONSE = {
  data: { matched: 1, detections: [] },
};

async function setupPage(page: Page) {
  await page.goto('/upload');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('photo-uploader')).toBeVisible();

  // Override URL.createObjectURL so Image.onload fires reliably in tests
  await page.evaluate(() => {
    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    URL.createObjectURL = () => TINY_PNG;
    URL.revokeObjectURL = () => {};
  });

  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 5_000 });
}

test('duplicate detected: shows warning with date and action buttons', async ({ page }) => {
  await setupPage(page);

  await page.route('**/api/photos/check-hash**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DUPLICATE_CHECK),
    });
  });

  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles('tests/fixtures/test-shelf.jpg');

  // Duplicate warning should appear
  await expect(page.getByTestId('duplicate-warning')).toBeVisible({ timeout: 10_000 });
  // Date from CREATED_AT should appear in the warning text
  await expect(page.getByTestId('duplicate-warning')).toContainText('1 maja 2026');
  // Open + Cancel only — "Wgraj mimo to" usunięte (akcja niemożliwa przy UNIQUE constraint na hash)
  await expect(page.getByTestId('open-existing-link')).toBeVisible();
  await expect(page.getByTestId('cancel-duplicate-button')).toBeVisible();
  await expect(page.getByTestId('upload-anyway-button')).toHaveCount(0);
  // Link points to existing photo
  await expect(page.getByTestId('open-existing-link')).toHaveAttribute(
    'href',
    `/photos/${EXISTING_PHOTO_ID}`,
  );
});

test('duplicate: clicking Anuluj returns to idle (drop zone visible)', async ({ page }) => {
  await setupPage(page);

  await page.route('**/api/photos/check-hash**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DUPLICATE_CHECK),
    });
  });

  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles('tests/fixtures/test-shelf.jpg');
  await expect(page.getByTestId('duplicate-warning')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('cancel-duplicate-button').click();

  // Drop zone should reappear, warning gone
  await expect(page.getByTestId('drop-zone')).toBeVisible();
  await expect(page.getByTestId('duplicate-warning')).not.toBeVisible();
});

test('server-side dedup: 409 from upload-file shows duplicate warning (LAN/HTTP fix)', async ({
  page,
}) => {
  await setupPage(page);

  // Client-side check-hash passes (no duplicate in local check)
  await page.route('**/api/photos/check-hash**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_NO_DUPLICATE_CHECK),
    });
  });

  // Server-side proxy detects duplicate (authoritative — works even without crypto.subtle on HTTP LAN)
  await page.route('**/api/photos/upload-file', (route) => {
    void route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'DUPLICATE_PHOTO',
          message: 'Zdjęcie o tym samym hashu już istnieje w Twoim katalogu.',
          details: { photo: { id: EXISTING_PHOTO_ID, shelf_id: SHELF_ID, created_at: CREATED_AT } },
        },
      }),
    });
  });

  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles('tests/fixtures/test-shelf.jpg');

  // Duplicate warning must appear even though client-side check passed
  await expect(page.getByTestId('duplicate-warning')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('duplicate-warning')).toContainText('1 maja 2026');
  await expect(page.getByTestId('open-existing-link')).toHaveAttribute(
    'href',
    `/photos/${EXISTING_PHOTO_ID}`,
  );
  await expect(page.getByTestId('cancel-duplicate-button')).toBeVisible();
});

test('no duplicate: normal upload without warning', async ({ page }) => {
  await setupPage(page);

  await page.route('**/api/photos/check-hash**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_NO_DUPLICATE_CHECK),
    });
  });
  await page.route('**/storage/v1/object/shelf-photos/**', (route) => {
    void route.fulfill({ status: 200, body: JSON.stringify({ Key: 'mock-path.jpg' }) });
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
  await page.route(`**/api/photos/${PHOTO_ID}/process`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROCESS_RESPONSE),
    });
  });
  await page.route(`**/api/photos/${PHOTO_ID}/match`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MATCH_RESPONSE),
    });
  });
  await page.route(`**/api/photos/${PHOTO_ID}/match-stream`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: 'event: done\ndata: {"matched":1,"rate_limited":0}\n\n',
    }),
  );

  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles('tests/fixtures/test-shelf.jpg');

  // No duplicate warning — progress area appears immediately
  await expect(page.getByTestId('progress-area')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('duplicate-warning')).not.toBeVisible();
  await page.waitForURL(`/photos/${PHOTO_ID}`, { timeout: 15_000 });
});
