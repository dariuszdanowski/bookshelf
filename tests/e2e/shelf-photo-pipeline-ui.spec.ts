import { expect, test } from '@playwright/test';

/**
 * E2E spec dla zmiany shelf-photo-pipeline-ui (Phase 3):
 *  - /shelves pokazuje „Zobacz zdjęcia →" link przy każdej półce
 *  - /shelves/[id] renderuje PhotoListIsland z listą zdjęć + stage badges
 *  - /photos/[id] pokazuje vision_run panel + przyciski Ponów vision / Ponów match
 *  - Run vision na uploaded photo → zmiana stage na vision_done
 *  - Re-run vision pokazuje confirm dialog; anulowanie nie wywołuje fetch
 *  - Toast 409 po podwójnym kliknięciu Run vision
 *  - DetectionReview augmentation: vision_run badge + akcje
 *
 * API vision/match/storage mockowane przez page.route() intercept.
 * Auth: współdzielona sesja z auth.setup.ts (storageState) — bez signup per-test.
 */

const PHOTO_ID = '00000000-0000-4000-8000-cccccccccccc';
const SHELF_ID_MOCK = '00000000-0000-4000-8000-dddddddddddd';
const RUN_ID_MOCK = '00000000-0000-4000-8000-eeeeeeeeeeee';

const MOCK_PHOTO_BASE = {
  id: PHOTO_ID,
  shelf_id: SHELF_ID_MOCK,
  status: 'processed',
  detected_count: 2,
  error_message: null,
  vision_cost_usd: 0.0042,
  vision_latency_ms: 4000,
  created_at: new Date().toISOString(),
};

const MOCK_VISION_RUN = {
  id: RUN_ID_MOCK,
  model: 'claude-sonnet-4-6',
  created_at: new Date().toISOString(),
  cost_usd: 0.0042,
  latency_ms: 4000,
};

const MOCK_DETECTION = {
  id: '00000000-0000-4000-8000-000000000010',
  position_index: 1,
  raw_title: 'Solaris',
  raw_author: 'Stanisław Lem',
  vision_confidence: 0.95,
  spine_color: 'niebieski',
  bbox: { x1: 0.1, y1: 0.05, x2: 0.3, y2: 0.95 },
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
};

const MOCK_PHOTO_LIST_UPLOADED = {
  data: {
    photos: [
      {
        id: PHOTO_ID,
        status: 'uploaded',
        stage: 'uploaded',
        created_at: new Date().toISOString(),
        thumbnail_url: null,
        detected_count: 0,
        matched_count: 0,
        confirmed_count: 0,
        latest_vision_run: null,
        has_running_run: false,
      },
    ],
  },
};

const MOCK_PHOTO_LIST_VISION_DONE = {
  data: {
    photos: [
      {
        id: PHOTO_ID,
        status: 'processed',
        stage: 'vision_done',
        created_at: new Date().toISOString(),
        thumbnail_url: null,
        detected_count: 2,
        matched_count: 0,
        confirmed_count: 0,
        latest_vision_run: MOCK_VISION_RUN,
        has_running_run: false,
      },
    ],
  },
};

const MOCK_PHOTO_LIST_MATCH_DONE = {
  data: {
    photos: [
      {
        id: PHOTO_ID,
        status: 'processed',
        stage: 'match_done',
        created_at: new Date().toISOString(),
        thumbnail_url: null,
        detected_count: 2,
        matched_count: 2,
        confirmed_count: 0,
        latest_vision_run: MOCK_VISION_RUN,
        has_running_run: false,
      },
    ],
  },
};

const MOCK_PROCESS_RESPONSE = {
  data: {
    photo: { ...MOCK_PHOTO_BASE },
    detections: [MOCK_DETECTION],
  },
};

const MOCK_MATCH_RESPONSE = {
  data: { matched: 1, detections: [MOCK_DETECTION] },
};

// tiny 1×1 transparent PNG — used as photo_url in E2E to avoid hitting storage
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const MOCK_PHOTO_GET = {
  data: {
    photo: MOCK_PHOTO_BASE,
    photo_url: TINY_PNG,
    detections: [MOCK_DETECTION],
    vision_run: MOCK_VISION_RUN,
  },
};

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * S-29: lista zdjęć żyje w zakładce „Zdjęcia" (domyślnie aktywne „Książki").
 * Klik odporny na hydration race (`client:load` SSR-uje przycisk zanim React
 * podepnie handler) — retry-click aż `aria-selected` faktycznie się przełączy.
 */
async function revealPhotosTab(page: import('@playwright/test').Page) {
  await expect(async () => {
    await page.getByTestId('shelf-tab-photos').click();
    await expect(page.getByTestId('shelf-tab-photos')).toHaveAttribute('aria-selected', 'true', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 10_000 });
}

/** Navigate to /shelves (sesja z współdzielonego storageState — bez signup) */
async function goToShelves(page: import('@playwright/test').Page) {
  await page.goto('/shelves');
  await page.waitForLoadState('networkidle');
}

/** Upload flow: mock all API + Storage, trigger file input, wait for redirect to /photos/[id] */
async function uploadAndGetToReviewPage(
  page: import('@playwright/test').Page,
  realShelfId: string,
) {
  await page.goto('/upload');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('photo-uploader')).toBeVisible();

  // createObjectURL override so Image.onload fires
  await page.evaluate(() => {
    const TINY =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    URL.createObjectURL = () => TINY;
    URL.revokeObjectURL = () => {};
  });

  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 5_000 });

  await page.route('**/storage/v1/object/shelf-photos/**', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ Key: 'shelf-photos/mock.jpg' }) }),
  );
  await page.route('**/api/photos', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            photo: {
              id: PHOTO_ID,
              shelf_id: realShelfId,
              status: 'uploaded',
              detected_count: null,
              error_message: null,
              vision_cost_usd: null,
              vision_latency_ms: null,
              created_at: new Date().toISOString(),
            },
          },
        }),
      });
    }
    return route.continue();
  });
  await page.route(`**/api/photos/${PHOTO_ID}/process`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROCESS_RESPONSE),
    }),
  );
  await page.route(`**/api/photos/${PHOTO_ID}/match`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MATCH_RESPONSE),
    }),
  );
  await page.route(`**/api/photos/${PHOTO_ID}/match-stream`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: 'event: done\ndata: {"matched":1,"rate_limited":0}\n\n',
    }),
  );
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PHOTO_GET),
      });
    }
    return route.continue();
  });

  await page.getByTestId('file-input').setInputFiles('tests/fixtures/test-shelf.jpg');
  await page.waitForURL(`/photos/${PHOTO_ID}`, { timeout: 15_000 });
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 1 — /shelves: ShelfListItem shows "Zobacz zdjęcia →" link
// ══════════════════════════════════════════════════════════════════════════════
test('3.5 /shelves: każda półka ma link do szczegółów półki', async ({ page }) => {
  await goToShelves(page);
  // Wait for ShelvesIsland to hydrate and render shelf items
  await expect(page.getByTestId('photo-list').or(page.locator('[data-testid^="shelf-item-"]')))
    .toBeVisible({ timeout: 10_000 })
    .catch(() => {
      // Island may take a moment — try direct locator
    });

  // The shelf list renders asynchronously; wait for at least one shelf-item
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });
  const photosLinks = page.getByTestId(/^shelf-item-photos-link$/);
  const count = await photosLinks.count();
  expect(count).toBeGreaterThanOrEqual(1);
  // Verify the href
  const href = await photosLinks.first().getAttribute('href');
  expect(href).toMatch(/\/shelves\/[0-9a-f-]+$/);
});

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 2 — /shelves/[id]: PhotoListIsland renders with stage badges + actions
// ══════════════════════════════════════════════════════════════════════════════
test('3.6 /shelves/[id]: PhotoListIsland renders photo list with stage badge', async ({ page }) => {
  await goToShelves(page);
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });

  // Click first "Zobacz zdjęcia →" link
  const link = page.getByTestId(/^shelf-item-photos-link$/).first();
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();

  // Mock the shelf photos API
  await page.route(`**/api/shelves/**/photos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PHOTO_LIST_UPLOADED),
    }),
  );

  // Navigate to /shelves/[id] via the link
  await link.click();
  await page.waitForURL(/\/shelves\/[0-9a-f-]+$/, { timeout: 5_000 });
  await revealPhotosTab(page);

  // PhotoListIsland renders after fetch
  await expect(page.getByTestId('photo-list')).toBeVisible({ timeout: 10_000 });

  // Stage badge shows "Wgrane" for uploaded photo
  const badge = page.getByTestId(`stage-badge-${PHOTO_ID}`);
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('Wgrane');

  // "Uruchom vision" button present for uploaded stage
  await expect(page.getByTestId(`run-vision-${PHOTO_ID}`)).toBeVisible();
});

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 3 — Run vision → stage changes to vision_done
// ══════════════════════════════════════════════════════════════════════════════
test('3.7 Run vision button → po sukcesie stage=vision_done (refetch)', async ({ page }) => {
  await goToShelves(page);
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });

  // Set up mocks before navigation
  let fetchCallCount = 0;
  await page.route(`**/api/shelves/**/photos`, (route) => {
    fetchCallCount++;
    const body =
      fetchCallCount === 1
        ? MOCK_PHOTO_LIST_UPLOADED // first fetch: uploaded stage
        : MOCK_PHOTO_LIST_VISION_DONE; // refetch after process: vision_done
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.route(`**/api/photos/${PHOTO_ID}/process`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROCESS_RESPONSE),
    }),
  );

  const link = page.getByTestId(/^shelf-item-photos-link$/).first();
  await link.click();
  await page.waitForURL(/\/shelves\/[0-9a-f-]+$/, { timeout: 5_000 });
  await revealPhotosTab(page);

  await expect(page.getByTestId(`run-vision-${PHOTO_ID}`)).toBeVisible({ timeout: 10_000 });

  // Click Run vision
  await page.getByTestId(`run-vision-${PHOTO_ID}`).click();

  // After successful process + refetch, badge changes to "Wykryte"
  await expect(page.getByTestId(`stage-badge-${PHOTO_ID}`)).toHaveText('Wykryte', {
    timeout: 10_000,
  });
  await expect(page.getByTestId(`run-match-${PHOTO_ID}`)).toBeVisible();
});

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 4 — Re-run vision: confirm cancel → no fetch; confirm OK → fetch called
// ══════════════════════════════════════════════════════════════════════════════
test('3.8 Re-run vision: confirm cancel → brak procesu; OK → wywołuje /process', async ({
  page,
}) => {
  await goToShelves(page);
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });

  const processRequests: string[] = [];
  await page.route(`**/api/shelves/**/photos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PHOTO_LIST_MATCH_DONE),
    }),
  );
  await page.route(`**/api/photos/${PHOTO_ID}/process`, (route) => {
    processRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROCESS_RESPONSE),
    });
  });

  const link = page.getByTestId(/^shelf-item-photos-link$/).first();
  await link.click();
  await page.waitForURL(/\/shelves\/[0-9a-f-]+$/, { timeout: 5_000 });
  await revealPhotosTab(page);
  await expect(page.getByTestId(`rerun-vision-${PHOTO_ID}`)).toBeVisible({ timeout: 10_000 });

  // First click — React ConfirmDialog pojawia się, klikamy Anuluj
  await page.getByTestId(`rerun-vision-${PHOTO_ID}`).click();
  await expect(page.getByTestId('photo-rerun-confirm-backdrop')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('photo-rerun-confirm-cancel').click();
  await expect(page.getByTestId('photo-rerun-confirm-backdrop')).not.toBeVisible();
  // No process call
  expect(processRequests).toHaveLength(0);

  // Second click — React ConfirmDialog pojawia się, klikamy Potwierdź
  await page.getByTestId(`rerun-vision-${PHOTO_ID}`).click();
  await expect(page.getByTestId('photo-rerun-confirm-backdrop')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('photo-rerun-confirm-confirm').click();
  // Process should be called
  await page.waitForFunction(() => true, null, { timeout: 5_000 }); // flush promises
  expect(processRequests.length).toBeGreaterThanOrEqual(1);
});

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 5 — Double-click Run vision → 409 toast
// ══════════════════════════════════════════════════════════════════════════════
test('3.9 Double-click Run vision → toast "Run już w toku"', async ({ page }) => {
  await goToShelves(page);
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });

  let processCallCount = 0;
  await page.route(`**/api/shelves/**/photos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PHOTO_LIST_UPLOADED),
    }),
  );
  await page.route(`**/api/photos/${PHOTO_ID}/process`, (route) => {
    processCallCount++;
    if (processCallCount === 1) {
      // First call: return 409 CONFLICT (simulates trigger blocking concurrent run)
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'CONFLICT',
            message: 'Vision run already in progress for this photo. Try again in a moment.',
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROCESS_RESPONSE),
    });
  });

  const link = page.getByTestId(/^shelf-item-photos-link$/).first();
  await link.click();
  await page.waitForURL(/\/shelves\/[0-9a-f-]+$/, { timeout: 5_000 });
  await revealPhotosTab(page);
  await expect(page.getByTestId(`run-vision-${PHOTO_ID}`)).toBeVisible({ timeout: 10_000 });

  // Click — gets 409
  await page.getByTestId(`run-vision-${PHOTO_ID}`).click();

  // Toast appears
  await expect(page.getByTestId(`row-toast-${PHOTO_ID}`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId(`row-toast-${PHOTO_ID}`)).toContainText('Run już w toku');
});

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 6 — /photos/[id]: DetectionReview shows vision_run panel + action buttons
// ══════════════════════════════════════════════════════════════════════════════
test('3.10 /photos/[id]: vision_run panel widoczny + przyciski Ponów vision / Ponów match', async ({
  page,
}) => {
  await goToShelves(page);

  // Get a real shelf id from the shelf items
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });
  const link = page.getByTestId(/^shelf-item-photos-link$/).first();
  const href = await link.getAttribute('href');
  const realShelfId = href!.split('/').pop()!;

  await uploadAndGetToReviewPage(page, realShelfId);

  // /photos/[id] renders DetectionReview; GET /api/photos/[id] is mocked above
  // (vision_run included in response)
  await expect(page.getByTestId('detection-review')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('vision-run-panel')).toBeVisible({ timeout: 5_000 });

  // Check vision_run panel content
  const panel = page.getByTestId('vision-run-panel');
  await expect(panel).toContainText('claude-sonnet-4-6');

  // Action buttons present
  await expect(page.getByTestId('rerun-vision-button')).toBeVisible();
  await expect(page.getByTestId('rerun-match-button')).toBeVisible();

  // Photo overlay visible (photo_url provided + detection with bbox)
  await expect(page.getByTestId('photo-overlay')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('bbox-marker-1')).toBeVisible({ timeout: 3_000 });
});

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 7 — /shelves/[id]: photo with all-failed runs shows stage=uploaded
// ══════════════════════════════════════════════════════════════════════════════
test('3.11 Photo z tylko failed runs pokazuje stage=uploaded + Uruchom vision', async ({
  page,
}) => {
  await goToShelves(page);
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });

  const FAILED_PHOTO_ID = '00000000-0000-4000-8000-fffffffffffg';
  await page.route(`**/api/shelves/**/photos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          photos: [
            {
              id: FAILED_PHOTO_ID,
              status: 'failed',
              stage: 'uploaded', // ← all failed runs → stage derived as uploaded
              created_at: new Date().toISOString(),
              thumbnail_url: null,
              detected_count: 0,
              matched_count: 0,
              confirmed_count: 0,
              latest_vision_run: null,
              has_running_run: false,
            },
          ],
        },
      }),
    }),
  );

  const link = page.getByTestId(/^shelf-item-photos-link$/).first();
  await link.click();
  await page.waitForURL(/\/shelves\/[0-9a-f-]+$/, { timeout: 5_000 });
  await revealPhotosTab(page);

  await expect(page.getByTestId('photo-list')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`stage-badge-${FAILED_PHOTO_ID}`)).toHaveText('Wgrane');
  await expect(page.getByTestId(`run-vision-${FAILED_PHOTO_ID}`)).toBeVisible();
});

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 8 — Mobile responsive: lista czytelna na 375px
// ══════════════════════════════════════════════════════════════════════════════
test('3.12 Mobile: /shelves/[id] czytelna na 375px', async ({ page }) => {
  // Sign up first with default viewport, then switch to mobile
  await goToShelves(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });

  await page.route(`**/api/shelves/**/photos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PHOTO_LIST_VISION_DONE),
    }),
  );

  const link = page.getByTestId(/^shelf-item-photos-link$/).first();
  await link.click();
  await page.waitForURL(/\/shelves\/[0-9a-f-]+$/, { timeout: 5_000 });
  await revealPhotosTab(page);

  await expect(page.getByTestId('photo-list')).toBeVisible({ timeout: 10_000 });

  // Stage badge must be visible (no overflow clipping)
  const badge = page.getByTestId(`stage-badge-${PHOTO_ID}`);
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('Wykryte');

  // Buttons must be visible (not pushed off-screen)
  await expect(page.getByTestId(`rerun-vision-${PHOTO_ID}`)).toBeVisible();
  await expect(page.getByTestId(`open-review-${PHOTO_ID}`)).toBeVisible();
});
