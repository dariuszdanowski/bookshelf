import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// ai-book-resolution (S-50) — ostatni poziom kaskady matchingu: „Rozwiąż przez AI".
//
// Widoczny wyłącznie gdy detekcja nie ma żadnych kandydatów. Klik → dialog
// potwierdzenia → POST /api/detections/[id]/resolve. Wszystkie scenariusze
// mockowane przez page.route — nigdy realny Anthropic call w automatach.
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-0000000ab001';
const SHELF_ID = '00000000-0000-4000-8000-0000000ab002';
const DET_NO_CANDIDATES_ID = '00000000-0000-4000-8000-0000000ab010';
const DET_WITH_CANDIDATE_ID = '00000000-0000-4000-8000-0000000ab011';
const DET_WEAK_CANDIDATE_ID = '00000000-0000-4000-8000-0000000ab012';

// matchScore 0.9 — WYSOKI, celowo (weak-match-resolve-and-ocr-audit): musi
// zostać powyżej MATCH_MID żeby test „widoczny tylko dla detekcji bez/ze
// słabym kandydatem" dalej weryfikował zamierzone ukrycie przycisku.
const EXISTING_CANDIDATE = {
  id: '00000000-0000-4000-8000-0000000ab020',
  source: 'google_books',
  externalId: 'gb-1',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn10: null,
  isbn13: '9780156027601',
  publisher: null,
  publishedYear: 1961,
  coverUrl: null,
  matchScore: 0.9,
  rank: 1,
};

// matchScore 0.3 — poniżej MATCH_MID (0.55): reprezentuje przypadek zgłoszony
// w manualnej analizie (BN zwraca luźne dopasowania jak „Metrologia elektryczna"
// dla „Podróż życia siostry Shergill", score 0.267–0.379).
const WEAK_CANDIDATE = {
  id: '00000000-0000-4000-8000-0000000ab021',
  source: 'national_library',
  externalId: 'bn-weak-1',
  title: 'Metrologia elektryczna',
  authors: ['Ktoś Inny'],
  isbn10: null,
  isbn13: null,
  publisher: null,
  publishedYear: null,
  coverUrl: null,
  matchScore: 0.3,
  rank: 1,
};

function makeDetection(id: string, idx: number, candidates: unknown[]) {
  return {
    id,
    position_index: idx,
    raw_title: 'Zlodziej ksiazek',
    raw_author: null,
    vision_confidence: 0.6,
    spine_color: null,
    bbox: null,
    status: candidates.length > 0 ? 'matched' : 'pending',
    candidates,
    duplicate: null,
  };
}

async function setupPhotoRoute(page: Page) {
  await page.route(
    (url) => url.pathname === `/api/photos/${PHOTO_ID}`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            photo: {
              id: PHOTO_ID,
              shelf_id: SHELF_ID,
              status: 'processed',
              detected_count: 3,
              error_message: null,
              vision_cost_usd: 0.01,
              vision_latency_ms: 2000,
              created_at: '2026-07-01T10:00:00Z',
            },
            photo_url: 'https://example.com/shelf.jpg',
            detections: [
              makeDetection(DET_NO_CANDIDATES_ID, 1, []),
              makeDetection(DET_WITH_CANDIDATE_ID, 2, [EXISTING_CANDIDATE]),
              makeDetection(DET_WEAK_CANDIDATE_ID, 3, [WEAK_CANDIDATE]),
            ],
            vision_run: null,
          },
        }),
      });
    },
  );
}

test.describe('ai-book-resolution — przycisk „Rozwiąż przez AI"', () => {
  test.beforeEach(async ({ page }) => {
    await setupPhotoRoute(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('detection-review')).toBeVisible();
  });

  test('widoczny dla detekcji bez kandydatów LUB ze słabym kandydatem (matchScore < MATCH_MID)', async ({
    page,
  }) => {
    const cardNoCandidates = page.getByTestId('detection-card-1');
    await expect(cardNoCandidates).toBeVisible();
    await expect(cardNoCandidates.getByTestId('ai-resolution-button')).toBeVisible();
    await expect(cardNoCandidates.getByTestId('ai-resolution-cost-hint')).toBeVisible();

    // matchScore 0.9 (wysoki) — przycisk ukryty, jak przed tym slice'em.
    const cardWithCandidate = page.getByTestId('detection-card-2');
    await expect(cardWithCandidate).toBeVisible();
    await expect(cardWithCandidate.getByTestId('ai-resolution-button')).not.toBeAttached();

    // matchScore 0.3 (< MATCH_MID=0.55) — nowe zachowanie tego slice'a:
    // przycisk widoczny mimo istniejącego (niepewnego) kandydata.
    const cardWeakCandidate = page.getByTestId('detection-card-3');
    await expect(cardWeakCandidate).toBeVisible();
    await expect(cardWeakCandidate.getByTestId('ai-resolution-button')).toBeVisible();
  });

  test('dialog potwierdzenia ostrzega o zastąpieniu propozycji tylko gdy istnieje (słaby) kandydat', async ({
    page,
  }) => {
    // Ze słabym kandydatem: dialog musi wspomnieć o zastąpieniu istniejących propozycji.
    const cardWeakCandidate = page.getByTestId('detection-card-3');
    await cardWeakCandidate.getByTestId('ai-resolution-button').click();
    await expect(page.getByTestId('ai-resolution-confirm')).toContainText(
      'Zastąpi obecne (niepewne) propozycje.',
    );
    await page.getByTestId('ai-resolution-confirm-cancel').click();

    // Bez kandydatów: nic do zastąpienia — zdanie NIE powinno się pojawić.
    const cardNoCandidates = page.getByTestId('detection-card-1');
    await cardNoCandidates.getByTestId('ai-resolution-button').click();
    await expect(page.getByTestId('ai-resolution-confirm')).not.toContainText(
      'Zastąpi obecne (niepewne) propozycje.',
    );
  });

  test('dialog potwierdzenia blokuje wysyłkę do kliknięcia confirm', async ({ page }) => {
    let resolveCalled = false;
    await page.route(
      (url) => url.pathname === `/api/detections/${DET_NO_CANDIDATES_ID}/resolve`,
      () => {
        resolveCalled = true;
      },
    );

    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('ai-resolution-button').click();
    await expect(page.getByTestId('ai-resolution-confirm')).toBeVisible();
    expect(resolveCalled).toBe(false);

    await page.getByTestId('ai-resolution-confirm-cancel').click();
    await expect(page.getByTestId('ai-resolution-confirm')).not.toBeVisible();
    expect(resolveCalled).toBe(false);
  });

  test('sukces (found) — nowy kandydat pojawia się w karcie', async ({ page }) => {
    await page.route(
      (url) => url.pathname === `/api/detections/${DET_NO_CANDIDATES_ID}/resolve`,
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              applied: true,
              detection: { id: DET_NO_CANDIDATES_ID, status: 'matched' },
              candidates: [
                {
                  id: '00000000-0000-4000-8000-0000000ab030',
                  source: 'ai_resolution',
                  externalId: `ai-resolution:${DET_NO_CANDIDATES_ID}`,
                  title: 'Złodzieje książek',
                  authors: ['Markus Zusak'],
                  isbn10: null,
                  isbn13: '9788375080195',
                  publisher: null,
                  publishedYear: 2006,
                  coverUrl: null,
                  matchScore: 0.86,
                  rank: 1,
                },
              ],
              duplicate: null,
              resolution: { status: 'found' },
            },
          }),
        });
      },
    );

    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('ai-resolution-button').click();
    await page.getByTestId('ai-resolution-confirm-confirm').click();

    await expect(page.getByText('Złodzieje książek').first()).toBeVisible();
  });

  test('not_found — komunikat błędu, brak nowego kandydata', async ({ page }) => {
    await page.route(
      (url) => url.pathname === `/api/detections/${DET_NO_CANDIDATES_ID}/resolve`,
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              applied: false,
              detection: { id: DET_NO_CANDIDATES_ID },
              candidates: [],
              duplicate: null,
              resolution: { status: 'not_found', reason: 'Brak jednoznacznego trafienia.' },
            },
          }),
        });
      },
    );

    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('ai-resolution-button').click();
    await page.getByTestId('ai-resolution-confirm-confirm').click();

    await expect(card.getByTestId('detection-error')).toContainText(
      'Brak jednoznacznego trafienia',
    );
    await expect(card.getByTestId('ai-resolution-button')).toBeVisible();
  });

  test('403 AI_RESOLUTION_PROVIDER_UNSUPPORTED — komunikat wskazujący /account', async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === `/api/detections/${DET_NO_CANDIDATES_ID}/resolve`,
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'AI_RESOLUTION_PROVIDER_UNSUPPORTED',
              message:
                'Rozwiązanie przez AI wymaga aktywnego klucza Anthropic. Przełącz na /account.',
            },
          }),
        });
      },
    );

    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('ai-resolution-button').click();
    await page.getByTestId('ai-resolution-confirm-confirm').click();

    await expect(card.getByTestId('detection-error')).toContainText('/account');
  });

  test('429 RESOLUTION_BUDGET_EXCEEDED — komunikat limitu', async ({ page }) => {
    await page.route(
      (url) => url.pathname === `/api/detections/${DET_NO_CANDIDATES_ID}/resolve`,
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'RESOLUTION_BUDGET_EXCEEDED',
              message: 'Osiągnięto limit wywołań AI-resolution.',
            },
          }),
        });
      },
    );

    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('ai-resolution-button').click();
    await page.getByTestId('ai-resolution-confirm-confirm').click();

    await expect(card.getByTestId('detection-error')).toContainText('limit');
  });
});
