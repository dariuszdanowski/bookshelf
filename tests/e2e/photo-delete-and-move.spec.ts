import { type Page, expect, test } from '@playwright/test';

/**
 * E2E spec dla photo-delete-and-move.
 *
 * Pokrywa DELETE i MOVE zdjęcia z widoku /photos/[id] (DetectionReview).
 * Wszystkie API mockowane przez page.route() — zero realnych wywołań Supabase/Storage.
 */

const PHOTO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SHELF_A_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const SHELF_B_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

const MOCK_PHOTO = {
  id: PHOTO_ID,
  shelf_id: SHELF_A_ID,
  status: 'processed',
  detected_count: 1,
  error_message: null,
  vision_cost_usd: 0.005,
  vision_latency_ms: 5000,
  created_at: '2026-06-01T10:00:00Z',
};

const MOCK_VISION_RUN = {
  id: 'vvvvvvvv-0000-4000-8000-000000000001',
  model: 'claude-sonnet-4-6',
  created_at: '2026-06-01T10:00:00Z',
  cost_usd: 0.005,
  latency_ms: 5000,
};

// Jedna detekcja — aby komponent nie wchodził w "empty state" (brak detections)
// i vision-run-panel (z przyciskami move/delete) był wyrenderowany.
const MOCK_DETECTION = {
  id: 'dddddddd-0000-4000-8000-000000000001',
  position_index: 1,
  raw_title: 'Testowa Książka',
  raw_author: null,
  vision_confidence: 0.9,
  spine_color: null,
  bbox: null,
  status: 'matched',
  candidates: [],
  duplicate: null,
};

const MOCK_PHOTO_RESPONSE = {
  data: {
    photo: MOCK_PHOTO,
    photo_url: null,
    detections: [MOCK_DETECTION],
    vision_run: MOCK_VISION_RUN,
    costs_total_usd: null,
  },
};

const MOCK_SHELVES_RESPONSE = {
  data: {
    shelves: [
      {
        id: SHELF_A_ID,
        name: 'Półka A',
        location: null,
        position_index: 0,
        created_at: '2026-06-01T10:00:00Z',
      },
      {
        id: SHELF_B_ID,
        name: 'Półka B',
        location: null,
        position_index: 1,
        created_at: '2026-06-01T10:00:00Z',
      },
    ],
  },
};

// Blokuje wywołania, które nie powinny powodować realnych zapytań w testach.
async function setupCommonMocks(page: Page) {
  await page.route('**/api/shelves', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SHELVES_RESPONSE),
    }),
  );
  // Blokuj wywołania vision/match/image żeby strona się nie zawiesiła
  await page.route(`**/api/photos/${PHOTO_ID}/image**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: '' }),
  );
  await page.route(`**/api/photos/${PHOTO_ID}/process**`, (route) =>
    route.fulfill({ status: 200, body: '{}' }),
  );
  await page.route(`**/api/photos/${PHOTO_ID}/match-stream**`, (route) =>
    route.fulfill({ status: 200, body: '{}' }),
  );
}

test('usuwa zdjęcie z /photos/[id] → redirect do półki', async ({ page }) => {
  await setupCommonMocks(page);

  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { deleted: true } }),
      });
    }
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PHOTO_RESPONSE),
      });
    }
    return route.continue();
  });

  // Przechwytuje nawigację do strony półki (SSR zrobiłby redirect bo półka nie istnieje w DB).
  // resourceType 'document' = nawigacja strony; API fetch = 'fetch' → route.continue().
  await page.route('**/shelves/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><head><title>Mock Shelf</title></head><body>OK</body></html>',
      });
    } else {
      await route.continue();
    }
  });

  await page.goto(`/photos/${PHOTO_ID}`);
  await expect(page.getByTestId('delete-photo-button')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('delete-photo-button').click();
  await expect(page.getByTestId('photo-delete-confirm')).toBeVisible({ timeout: 5_000 });

  const deleteReq = page.waitForRequest(
    (req) => req.url().includes(`/api/photos/${PHOTO_ID}`) && req.method() === 'DELETE',
  );
  await page.getByTestId('photo-delete-confirm-confirm').click();
  await deleteReq;

  await page.waitForURL((url) => url.href.includes(SHELF_A_ID) && url.href.includes('tab=photos'), {
    timeout: 10_000,
  });
});

test('przenosi zdjęcie z /photos/[id] → redirect do nowej półki', async ({ page }) => {
  await setupCommonMocks(page);

  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { ...MOCK_PHOTO, shelf_id: SHELF_B_ID } }),
      });
    }
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PHOTO_RESPONSE),
      });
    }
    return route.continue();
  });

  // Przechwytuje nawigację do strony półki (SSR zrobiłby redirect bo półka nie istnieje w DB).
  await page.route('**/shelves/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><head><title>Mock Shelf</title></head><body>OK</body></html>',
      });
    } else {
      await route.continue();
    }
  });

  await page.goto(`/photos/${PHOTO_ID}`);

  const moveSelect = page.getByTestId('move-photo-select');
  await expect(moveSelect).toBeVisible({ timeout: 10_000 });
  // Półka A (aktualna) jest odfiltrowana — dropdown ma tylko Półkę B
  await expect(moveSelect).not.toBeDisabled({ timeout: 5_000 });

  const patchReq = page.waitForRequest(
    (req) => req.url().includes(`/api/photos/${PHOTO_ID}`) && req.method() === 'PATCH',
  );
  await moveSelect.selectOption(SHELF_B_ID);
  await page.getByTestId('move-photo-confirm-confirm').click();
  await patchReq;

  await page.waitForURL((url) => url.href.includes(SHELF_B_ID) && url.href.includes('tab=photos'), {
    timeout: 10_000,
  });
});
