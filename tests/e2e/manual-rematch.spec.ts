import { test, expect } from '@playwright/test';

const PHOTO_ID = 'cf42bf3a-0000-4000-8000-000000000001';
const DET_ID = '00000000-0000-4000-8000-000000000020';

const MOCK_DETECTION_NO_CANDIDATES = {
  id: DET_ID,
  position_index: 1,
  raw_title: 'Poraniona blyskawica',
  raw_author: null,
  vision_confidence: 0.7,
  spine_color: null,
  bbox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.9 },
  status: 'pending',
  candidates: [],
  duplicate: null,
};

const MOCK_REMATCH_RESULT = {
  id: '00000000-0000-4000-8000-000000000030',
  source: 'google_books',
  externalId: 'gb-1',
  title: 'Przerwana kołysanka',
  authors: ['Natasza Socha'],
  isbn10: null,
  isbn13: '9788383100012',
  publisher: null,
  publishedYear: 2022,
  coverUrl: null,
  matchScore: 0.95,
  rank: 1,
};

test.describe('manual rematch — szukaj po tytule', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/api/photos/${PHOTO_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            photo: {
              id: PHOTO_ID,
              shelf_id: 'shelf-1',
              status: 'processed',
              detected_count: 1,
              error_message: null,
              vision_cost_usd: 0.005,
              vision_latency_ms: 3000,
              created_at: new Date().toISOString(),
            },
            photo_url: 'https://example.com/shelf.jpg',
            detections: [MOCK_DETECTION_NO_CANDIDATES],
            vision_run: {
              id: 'vr-1',
              model: 'claude-sonnet-4-6',
              created_at: new Date().toISOString(),
              cost_usd: 0.005,
              latency_ms: 3000,
            },
          },
        }),
      }),
    );
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.waitForSelector('[data-testid="no-match-placeholder"]');
  });

  test('przycisk Szukaj po tytule jest widoczny dla detekcji bez kandydatów', async ({ page }) => {
    await expect(page.getByTestId('rematch-button').first()).toBeVisible();
  });

  test('kliknięcie Szukaj otwiera formularz z pre-wypełnionym tytułem', async ({ page }) => {
    await page.getByTestId('rematch-button').first().click();
    await expect(page.getByTestId('rematch-form')).toBeVisible();
    const titleInput = page.getByTestId('rematch-title');
    await expect(titleInput).toHaveValue('Poraniona blyskawica');
  });

  test('po wyszukaniu z wynikami kandydat pojawia się w karcie', async ({ page }) => {
    await page.route(`**/api/detections/${DET_ID}/rematch`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            applied: true,
            detection: {
              id: DET_ID,
              status: 'matched',
              raw_title: 'Przerwana kołysanka',
              raw_author: 'Natasza Socha',
            },
            candidates: [MOCK_REMATCH_RESULT],
            duplicate: null,
          },
        }),
      }),
    );

    await page.getByTestId('rematch-button').first().click();
    const titleInput = page.getByTestId('rematch-title');
    await titleInput.fill('Przerwana kołysanka');
    await page.getByTestId('rematch-author').fill('Natasza Socha');
    await page.getByTestId('rematch-submit').click();

    await expect(page.getByTestId('no-match-placeholder')).not.toBeVisible();
    await expect(page.getByText('Przerwana kołysanka').first()).toBeVisible();
  });

  test('brak wyników pokazuje komunikat i zamyka formularz', async ({ page }) => {
    await page.route(`**/api/detections/${DET_ID}/rematch`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            applied: false,
            detection: {
              id: DET_ID,
              status: 'pending',
              raw_title: 'xyz nieznany',
              raw_author: null,
            },
            candidates: [],
            duplicate: null,
          },
        }),
      }),
    );

    await page.getByTestId('rematch-button').first().click();
    await page.getByTestId('rematch-title').fill('xyz nieznany');
    await page.getByTestId('rematch-submit').click();

    await expect(page.getByTestId('rematch-form')).not.toBeVisible();
    await expect(page.getByTestId('rematch-no-results')).toBeVisible();
  });

  test('Anuluj zamyka formularz bez wywołania API', async ({ page }) => {
    let rematchCalled = false;
    await page.route(`**/api/detections/${DET_ID}/rematch`, () => {
      rematchCalled = true;
    });

    await page.getByTestId('rematch-button').first().click();
    await expect(page.getByTestId('rematch-form')).toBeVisible();
    await page.getByTestId('rematch-cancel').click();
    await expect(page.getByTestId('rematch-form')).not.toBeVisible();
    expect(rematchCalled).toBe(false);
  });

  test('progress modal: widoczny podczas rematch detekcji', async ({ page }) => {
    let resolveRematch!: () => void;
    const rematchHeld = new Promise<void>((r) => {
      resolveRematch = r;
    });

    await page.route(`**/api/detections/${DET_ID}/rematch`, async (route) => {
      await rematchHeld;
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            applied: false,
            detection: { id: DET_ID, status: 'pending', raw_title: 'test', raw_author: null },
            candidates: [],
            duplicate: null,
          },
        }),
      });
    });

    await page.getByTestId('rematch-button').first().click();
    await page.getByTestId('rematch-title').fill('test');
    await page.getByTestId('rematch-submit').click();

    // Modal powinien się pojawić podczas trzymanego requestu rematch
    await expect(page.getByTestId('progress-modal')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('progress-modal-label')).toContainText('Szukam kandydatów');

    resolveRematch();
    await expect(page.getByTestId('progress-modal')).not.toBeVisible({ timeout: 5_000 });
  });

  test('progress modal: widoczny podczas toolbar rerun match', async ({ page }) => {
    let resolveStream!: (value: string) => void;
    const streamHeld = new Promise<string>((r) => {
      resolveStream = r;
    });

    await page.route(`**/api/photos/${PHOTO_ID}/match-stream`, async (route) => {
      const body = await streamHeld;
      void route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body,
      });
    });

    await expect(page.getByTestId('rerun-match-button')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('rerun-match-button').click();

    // Modal powinien się pojawić podczas trzymanego SSE stream
    await expect(page.getByTestId('progress-modal')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('progress-modal-label')).toContainText('Dopasowywanie');

    resolveStream('event: done\ndata: {}\n\n');
    // Po sukcesie window.location.reload() — czekamy na załadowanie strony
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    await expect(page.getByTestId('progress-modal')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// S-19 (manual-cover-match): ręczne wyszukiwanie gdy detekcja MA już kandydata
// — auto-match pudłuje, user szuka właściwej książki, nowy wynik (z okładką
// + ISBN + metadanymi) zastępuje dotychczasowych kandydatów.
// ---------------------------------------------------------------------------

const WRONG_CANDIDATE = {
  id: '00000000-0000-4000-8000-000000000040',
  source: 'google_books',
  externalId: 'gb-wrong',
  title: 'Zupełnie inna książka',
  authors: ['Nie Ten Autor'],
  isbn10: null,
  isbn13: '9788300000001',
  publisher: null,
  publishedYear: 2010,
  coverUrl: null,
  matchScore: 0.61,
  rank: 1,
};

const RIGHT_CANDIDATE = {
  id: '00000000-0000-4000-8000-000000000041',
  source: 'google_books',
  externalId: 'gb-right',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn10: null,
  isbn13: '9780156027601',
  publisher: 'Harvest',
  publishedYear: 1961,
  coverUrl: 'https://example.com/solaris-cover.jpg',
  matchScore: 0.95,
  rank: 1,
};

test.describe('S-19: rematch przy ISTNIEJĄCYM kandydacie (zły auto-match)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/api/photos/${PHOTO_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            photo: {
              id: PHOTO_ID,
              shelf_id: 'shelf-1',
              status: 'processed',
              detected_count: 1,
              error_message: null,
              vision_cost_usd: 0.005,
              vision_latency_ms: 3000,
              created_at: new Date().toISOString(),
            },
            photo_url: 'https://example.com/shelf.jpg',
            detections: [
              { ...MOCK_DETECTION_NO_CANDIDATES, status: 'matched', candidates: [WRONG_CANDIDATE] },
            ],
            vision_run: {
              id: 'vr-1',
              model: 'claude-sonnet-4-6',
              created_at: new Date().toISOString(),
              cost_usd: 0.005,
              latency_ms: 3000,
            },
          },
        }),
      }),
    );
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.waitForSelector('[data-testid="detection-card-1"]');
  });

  test('przycisk Szukaj po tytule widoczny mimo istniejącego kandydata; form prefilluje ISBN topa', async ({
    page,
  }) => {
    await expect(page.getByText('Zupełnie inna książka').first()).toBeVisible();
    await page.getByTestId('rematch-button').first().click();
    await expect(page.getByTestId('rematch-form')).toBeVisible();
    await expect(page.getByTestId('rematch-title')).toHaveValue('Poraniona blyskawica');
    await expect(page.getByTestId('rematch-isbn')).toHaveValue('9788300000001');
  });

  test('ręczne wyszukiwanie zastępuje złego kandydata właściwym (okładka + ISBN + metadane)', async ({
    page,
  }) => {
    await page.route(`**/api/detections/${DET_ID}/rematch`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            applied: true,
            detection: {
              id: DET_ID,
              status: 'matched',
              raw_title: 'Solaris',
              raw_author: 'Stanisław Lem',
            },
            candidates: [RIGHT_CANDIDATE],
            duplicate: null,
          },
        }),
      }),
    );

    await page.getByTestId('rematch-button').first().click();
    await page.getByTestId('rematch-title').fill('Solaris');
    await page.getByTestId('rematch-author').fill('Stanisław Lem');
    await page.getByTestId('rematch-submit').click();

    // Business outcome: zły kandydat zniknął, właściwy (z metadanymi) jest aktywny
    await expect(
      page.getByTestId('candidate-title').filter({ hasText: 'Zupełnie inna książka' }),
    ).not.toBeVisible();
    await expect(page.getByText('Solaris').first()).toBeVisible();
    // Akceptacja nowego kandydata nadal dostępna (aktywny kandydat podmieniony)
    await expect(page.getByTestId('confirm-button').first()).toBeEnabled();
  });
});
