import { expect, test } from '@playwright/test';

/**
 * Golden path E2E dla S-04:
 *  1. Auth: współdzielona sesja z auth.setup.ts (storageState) — bez signup.
 *  2. /upload → widoczny uploader.
 *  3. Mock endpointu process (intercept) → symuluje sukces z detekcjami.
 *  4. Mock endpointu match (intercept) → symuluje sukces z kandydatami.
 *  5. Mock GET /api/photos/[id] → symuluje odpowiedź z kandydatami.
 *  6. Upload mock-obrazu → redirect na /photos/[id] → propozycje widoczne.
 *
 * Vision API i Google Books są mockowane przez interceptowanie endpointów.
 * Nie wymaga ANTHROPIC_API_KEY ani GOOGLE_BOOKS_API_KEY ani prawdziwych calli.
 * Bucket shelf-photos i Storage RLS weryfikowane manualnie po merge.
 */

const PHOTO_ID = '00000000-0000-4000-8000-aaaaaaaaaaaa';

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

const MOCK_PROCESS_RESPONSE = {
  data: {
    photo: {
      id: PHOTO_ID,
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

const MOCK_MATCH_RESPONSE = {
  data: {
    matched: 2,
    detections: [
      {
        id: '00000000-0000-4000-8000-000000000010',
        raw_title: 'Solaris',
        raw_author: 'Stanisław Lem',
        position_index: 1,
        status: 'matched',
        candidates: [
          {
            source: 'google_books',
            externalId: 'gb-solaris',
            title: 'Solaris',
            authors: ['Stanisław Lem'],
            isbn10: null,
            isbn13: '9780156027601',
            publisher: 'Harvest Books',
            publishedYear: 1987,
            coverUrl: null,
            matchScore: 0.92,
            rank: 1,
          },
        ],
        duplicate: null,
      },
    ],
  },
};

const MOCK_PHOTO_GET_RESPONSE = {
  data: {
    photo: {
      id: PHOTO_ID,
      shelf_id: '00000000-0000-4000-8000-bbbbbbbbbbbb',
      status: 'processed',
      detected_count: 2,
      error_message: null,
      vision_cost_usd: 0.005,
      vision_latency_ms: 4200,
      created_at: new Date().toISOString(),
    },
    detections: [
      {
        id: '00000000-0000-4000-8000-000000000010',
        position_index: 1,
        raw_title: 'Solaris',
        raw_author: 'Stanisław Lem',
        vision_confidence: 0.95,
        spine_color: 'niebieski',
        bbox: null,
        status: 'matched',
        candidates: [
          {
            id: '00000000-0000-4000-8000-000000000020',
            source: 'google_books',
            externalId: 'gb-solaris',
            title: 'Solaris',
            authors: ['Stanisław Lem'],
            isbn10: null,
            isbn13: '9780156027601',
            publisher: 'Harvest Books',
            publishedYear: 1987,
            coverUrl: null,
            matchScore: 0.92,
            rank: 1,
          },
        ],
        duplicate: null,
      },
    ],
  },
};

test('upload flow: /upload → wybór półki → upload → redirect → propozycje widoczne', async ({ page }) => {
  // Sesja z współdzielonego storageState — od razu na /upload (bez signup per-test)
  await page.goto('/upload');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('photo-uploader')).toBeVisible();

  // Override URL.createObjectURL in the live page so the Image.onload always
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
  await page.route(`**/api/photos/${PHOTO_ID}/process`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROCESS_RESPONSE),
    });
  });

  // 7. Intercept /api/photos/*/match
  await page.route(`**/api/photos/${PHOTO_ID}/match`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MATCH_RESPONSE),
    });
  });

  // 8. Intercept GET /api/photos/[id] (used by DetectionReview on review page)
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PHOTO_GET_RESPONSE),
      });
    } else {
      void route.continue();
    }
  });

  // 9. Upload a real minimal JPEG
  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles('tests/fixtures/test-shelf.jpg');

  // 10. Wait for redirect to review page
  await page.waitForURL(`/photos/${PHOTO_ID}`, { timeout: 15_000 });

  // 11. Review page shows proposals
  await expect(page.getByTestId('detection-review')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('detection-card-1')).toBeVisible();
  await expect(page.getByTestId('tier-badge-high')).toBeVisible();
});
