import { type Page, expect, test } from '@playwright/test';

/**
 * E2E spec: potwierdzenie przed vision / match / refine.
 *
 * Weryfikuje, że kosztowne operacje (Uruchom vision, Uruchom match, Ponów match,
 * Doprecyzuj odczyt) wymagają potwierdzenia w ConfirmDialog zanim wywołają API.
 *
 * Nawigacja do półki przez /shelves (SSR wymaga prawdziwej półki w DB; po signup
 * zawsze istnieje co najmniej półka „Zakupione"). Zdjęcia mockowane przez page.route().
 * API vision/match/refine mockowane — zero realnych wywołań LLM.
 */

const PHOTO_UPLOADED_ID = 'cc000000-0000-4000-8000-000000000010';
const PHOTO_VISION_DONE_ID = 'cc000000-0000-4000-8000-000000000011';
const PHOTO_MATCH_DONE_ID = 'cc000000-0000-4000-8000-000000000012';
const DET_ID = 'cc000000-0000-4000-8000-000000000020';

const MOCK_VISION_RUN = {
  id: 'cc000000-0000-4000-8000-000000000030',
  model: 'claude-sonnet-4-6',
  created_at: new Date().toISOString(),
  cost_usd: 0.005,
  latency_ms: 3000,
};

const MOCK_DETECTION = {
  id: DET_ID,
  position_index: 1,
  raw_title: 'Solaris',
  raw_author: 'Stanisław Lem',
  vision_confidence: 0.9,
  spine_color: null,
  bbox: { x1: 0.1, y1: 0.05, x2: 0.3, y2: 0.95 },
  status: 'matched',
  candidates: [],
  duplicate: null,
};

function makePhotoItem(id: string, stage: 'uploaded' | 'vision_done' | 'match_done', matched = 0) {
  return {
    id,
    status: 'processed',
    stage,
    created_at: new Date().toISOString(),
    thumbnail_url: null,
    detected_count: stage === 'uploaded' ? 0 : 1,
    matched_count: matched,
    confirmed_count: 0,
    latest_vision_run: stage === 'uploaded' ? null : MOCK_VISION_RUN,
    has_running_run: false,
  };
}

const PHOTOS_LIST_BODY = JSON.stringify({
  data: {
    photos: [
      makePhotoItem(PHOTO_UPLOADED_ID, 'uploaded'),
      makePhotoItem(PHOTO_VISION_DONE_ID, 'vision_done'),
      makePhotoItem(PHOTO_MATCH_DONE_ID, 'match_done', 1),
    ],
  },
});

// ── Navigation helpers ────────────────────────────────────────────────────────

/**
 * Retry-click na zakładkę Zdjęcia — odporna na hydration race (client:load).
 * Wzorzec z shelf-photo-pipeline-ui.spec.ts.
 */
async function revealPhotosTab(page: Page) {
  await expect(async () => {
    await page.getByTestId('shelf-tab-photos').click();
    await expect(page.getByTestId('shelf-tab-photos')).toHaveAttribute('aria-selected', 'true', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 10_000 });
}

/**
 * Rejestruje mocki i nawiguje na stronę zdjęć prawdziwej półki.
 * SSR /shelves/[id] wymaga prawdziwej półki w DB — idziemy przez /shelves (click).
 */
async function setupAndGoToShelfPhotos(page: Page) {
  // Mock listy zdjęć (wildcard — dowolny shelfId) z fałszywymi foto
  await page.route('**/api/shelves/**/photos', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: PHOTOS_LIST_BODY,
    });
  });

  // Domyślne mocki process/match — żeby przyciski Confirm nie zawieszały testu
  await page.route('**/api/photos/*/process**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {} }),
    });
  });
  await page.route('**/api/photos/*/match-stream**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: 'event: done\ndata: {"matched":1,"rate_limited":0}\n\n',
    });
  });
  await page.route('**/api/photos/*/match', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { matched: 1 } }),
    });
  });

  // Nawigacja przez listę półek (SSR wymaga prawdziwej półki)
  await page.goto('/shelves');
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });
  const link = page.getByTestId('shelf-item-photos-link').first();
  await link.click();
  await page.waitForURL(/\/shelves\/[0-9a-f-]+/, { timeout: 5_000 });
  await revealPhotosTab(page);
  await expect(page.getByTestId('photo-list')).toBeVisible({ timeout: 10_000 });
}

// ── PhotoListIsland — Uruchom vision ─────────────────────────────────────────

test.describe('confirm: Uruchom vision (PhotoListIsland)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAndGoToShelfPhotos(page);
    await expect(page.getByTestId(`run-vision-${PHOTO_UPLOADED_ID}`)).toBeVisible();
  });

  test('kliknięcie "Uruchom vision" otwiera dialog — API nie wywołane przed potwierdzeniem', async ({
    page,
  }) => {
    let processCalled = false;
    await page.route(`**/api/photos/${PHOTO_UPLOADED_ID}/process**`, async (route) => {
      processCalled = true;
      await route.fallback();
    });

    await page.getByTestId(`run-vision-${PHOTO_UPLOADED_ID}`).click();
    await expect(page.getByTestId('photo-vision-confirm')).toBeVisible();
    expect(processCalled).toBe(false);
  });

  test('"Anuluj" zamyka dialog i nie wywołuje API', async ({ page }) => {
    let processCalled = false;
    await page.route(`**/api/photos/${PHOTO_UPLOADED_ID}/process**`, async (route) => {
      processCalled = true;
      await route.fallback();
    });

    await page.getByTestId(`run-vision-${PHOTO_UPLOADED_ID}`).click();
    await expect(page.getByTestId('photo-vision-confirm')).toBeVisible();
    await page.getByTestId('photo-vision-confirm-cancel').click();
    await expect(page.getByTestId('photo-vision-confirm')).not.toBeVisible();
    expect(processCalled).toBe(false);
  });

  test('"Potwierdź" wywołuje endpoint /process', async ({ page }) => {
    const processPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/photos/${PHOTO_UPLOADED_ID}/process`) && req.method() === 'POST',
    );

    await page.getByTestId(`run-vision-${PHOTO_UPLOADED_ID}`).click();
    await expect(page.getByTestId('photo-vision-confirm')).toBeVisible();
    await page.getByTestId('photo-vision-confirm-confirm').click();
    await processPromise;
  });
});

// ── PhotoListIsland — Uruchom match / Ponów match ────────────────────────────

test.describe('confirm: Uruchom match (PhotoListIsland)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAndGoToShelfPhotos(page);
    await expect(page.getByTestId(`run-match-${PHOTO_VISION_DONE_ID}`)).toBeVisible();
  });

  test('"Uruchom match" otwiera dialog — API nie wywołane przed potwierdzeniem', async ({
    page,
  }) => {
    let matchCalled = false;
    await page.route(`**/api/photos/${PHOTO_VISION_DONE_ID}/match**`, async (route) => {
      matchCalled = true;
      await route.fallback();
    });

    await page.getByTestId(`run-match-${PHOTO_VISION_DONE_ID}`).click();
    await expect(page.getByTestId('photo-match-confirm')).toBeVisible();
    expect(matchCalled).toBe(false);
  });

  test('"Anuluj" zamyka dialog i nie wywołuje API', async ({ page }) => {
    let matchCalled = false;
    await page.route(`**/api/photos/${PHOTO_VISION_DONE_ID}/match**`, async (route) => {
      matchCalled = true;
      await route.fallback();
    });

    await page.getByTestId(`run-match-${PHOTO_VISION_DONE_ID}`).click();
    await expect(page.getByTestId('photo-match-confirm')).toBeVisible();
    await page.getByTestId('photo-match-confirm-cancel').click();
    await expect(page.getByTestId('photo-match-confirm')).not.toBeVisible();
    expect(matchCalled).toBe(false);
  });

  test('"Potwierdź" wywołuje endpoint match-stream', async ({ page }) => {
    const matchStreamPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/photos/${PHOTO_VISION_DONE_ID}/match-stream`) &&
        req.method() === 'GET',
    );

    await page.getByTestId(`run-match-${PHOTO_VISION_DONE_ID}`).click();
    await expect(page.getByTestId('photo-match-confirm')).toBeVisible();
    await page.getByTestId('photo-match-confirm-confirm').click();
    await matchStreamPromise;
  });
});

test.describe('confirm: Ponów match (PhotoListIsland)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAndGoToShelfPhotos(page);
    await expect(page.getByTestId(`rerun-match-${PHOTO_MATCH_DONE_ID}`)).toBeVisible();
  });

  test('"Ponów match" otwiera dialog potwierdzenia', async ({ page }) => {
    await page.getByTestId(`rerun-match-${PHOTO_MATCH_DONE_ID}`).click();
    await expect(page.getByTestId('photo-match-confirm')).toBeVisible();
  });

  test('"Anuluj" przy Ponów match zamyka dialog bez API', async ({ page }) => {
    let matchCalled = false;
    await page.route(`**/api/photos/${PHOTO_MATCH_DONE_ID}/match**`, async (route) => {
      matchCalled = true;
      await route.fallback();
    });

    await page.getByTestId(`rerun-match-${PHOTO_MATCH_DONE_ID}`).click();
    await page.getByTestId('photo-match-confirm-cancel').click();
    await expect(page.getByTestId('photo-match-confirm')).not.toBeVisible();
    expect(matchCalled).toBe(false);
  });

  test('"Potwierdź" przy Ponów match wywołuje endpoint match-stream', async ({ page }) => {
    const matchStreamPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/photos/${PHOTO_MATCH_DONE_ID}/match-stream`) &&
        req.method() === 'GET',
    );

    await page.getByTestId(`rerun-match-${PHOTO_MATCH_DONE_ID}`).click();
    await expect(page.getByTestId('photo-match-confirm')).toBeVisible();
    await page.getByTestId('photo-match-confirm-confirm').click();
    await matchStreamPromise;
  });
});

// ── DetectionReview — Uruchom vision (empty state, process-now-button) ───────

const PHOTO_NO_DETECTIONS_ID = 'cc000000-0000-4000-8000-000000000013';

test.describe('confirm: process-now-button (DetectionReview — brak detekcji)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/api/photos/${PHOTO_NO_DETECTIONS_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            photo: {
              id: PHOTO_NO_DETECTIONS_ID,
              shelf_id: 'cc000000-0000-4000-8000-000000000001',
              status: 'processed',
              detected_count: 0,
              error_message: null,
              vision_cost_usd: null,
              vision_latency_ms: null,
              created_at: new Date().toISOString(),
            },
            photo_url: null,
            detections: [],
            vision_run: null,
            costs_total_usd: null,
          },
        }),
      });
    });
    await page.route('**/api/photos/*/process**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' });
    });
    await page.route('**/api/photos/*/match-stream**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: 'event: done\ndata: {"matched":0,"rate_limited":0}\n\n',
      });
    });
    await page.goto(`/photos/${PHOTO_NO_DETECTIONS_ID}`);
    await expect(page.getByTestId('process-now-button')).toBeVisible({ timeout: 10_000 });
  });

  test('kliknięcie process-now-button otwiera dialog — API nie wywołane przed potwierdzeniem', async ({
    page,
  }) => {
    let processCalled = false;
    await page.route(`**/api/photos/${PHOTO_NO_DETECTIONS_ID}/process**`, async (route) => {
      processCalled = true;
      await route.fallback();
    });

    await page.getByTestId('process-now-button').click();
    await expect(page.getByTestId('rerun-vision-confirm')).toBeVisible();
    expect(processCalled).toBe(false);
  });

  test('"Anuluj" zamyka dialog bez wywołania API', async ({ page }) => {
    let processCalled = false;
    await page.route(`**/api/photos/${PHOTO_NO_DETECTIONS_ID}/process**`, async (route) => {
      processCalled = true;
      await route.fallback();
    });

    await page.getByTestId('process-now-button').click();
    await expect(page.getByTestId('rerun-vision-confirm')).toBeVisible();
    await page.getByTestId('rerun-vision-confirm-cancel').click();
    await expect(page.getByTestId('rerun-vision-confirm')).not.toBeVisible();
    expect(processCalled).toBe(false);
  });

  test('"Potwierdź" wywołuje endpoint /process', async ({ page }) => {
    const processPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/photos/${PHOTO_NO_DETECTIONS_ID}/process`) &&
        req.method() === 'POST',
    );

    await page.getByTestId('process-now-button').click();
    await page.getByTestId('rerun-vision-confirm-confirm').click();
    await processPromise;
  });
});

// ── DetectionReview — Doprecyzuj odczyt ──────────────────────────────────────

test.describe('confirm: Doprecyzuj odczyt (DetectionReview)', () => {
  test.beforeEach(async ({ page }) => {
    // /photos/[id].astro używa maybeSingle() → brak zdjęcia = graceful degradation
    // DetectionReview fetches client-side → mockujemy /api/photos/${id}
    await page.route(`**/api/photos/${PHOTO_MATCH_DONE_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            photo: {
              id: PHOTO_MATCH_DONE_ID,
              shelf_id: 'cc000000-0000-4000-8000-000000000001',
              status: 'processed',
              detected_count: 1,
              error_message: null,
              vision_cost_usd: 0.005,
              vision_latency_ms: 3000,
              created_at: new Date().toISOString(),
            },
            photo_url: null,
            detections: [MOCK_DETECTION],
            vision_run: MOCK_VISION_RUN,
            costs_total_usd: null,
          },
        }),
      });
    });

    await page.route('**/api/detections/*/refine', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { applied: true, detection: MOCK_DETECTION } }),
      });
    });

    await page.goto(`/photos/${PHOTO_MATCH_DONE_ID}`);
    await expect(page.getByTestId('detection-review')).toBeVisible();
    await expect(page.getByTestId('refine-button')).toBeVisible();
  });

  test('"Doprecyzuj odczyt" otwiera dialog — refine API nie wywołane', async ({ page }) => {
    let refineCalled = false;
    await page.route(`**/api/detections/${DET_ID}/refine`, async (route) => {
      refineCalled = true;
      await route.fallback();
    });

    await page.getByTestId('refine-button').click();
    await expect(page.getByTestId('refine-confirm')).toBeVisible();
    expect(refineCalled).toBe(false);
  });

  test('"Anuluj" zamyka dialog bez wywołania refine', async ({ page }) => {
    let refineCalled = false;
    await page.route(`**/api/detections/${DET_ID}/refine`, async (route) => {
      refineCalled = true;
      await route.fallback();
    });

    await page.getByTestId('refine-button').click();
    await expect(page.getByTestId('refine-confirm')).toBeVisible();
    await page.getByTestId('refine-confirm-cancel').click();
    await expect(page.getByTestId('refine-confirm')).not.toBeVisible();
    expect(refineCalled).toBe(false);
  });

  test('"Potwierdź" wywołuje endpoint refine', async ({ page }) => {
    const refinePromise = page.waitForRequest(
      (req) => req.url().includes(`/api/detections/${DET_ID}/refine`) && req.method() === 'POST',
    );

    await page.getByTestId('refine-button').click();
    await page.getByTestId('refine-confirm-confirm').click();
    await refinePromise;
  });
});
