import { test, expect } from '@playwright/test';

/**
 * unify-detection-edit-entrypoint — jeden punkt wejścia do edycji detekcji.
 *
 * Zastępuje dawny manual-rematch.spec.ts (RematchForm/CorrectForm usunięte
 * w Fazie 5). Klik okładki (dopasowanej) lub placeholdera (bez matcha) otwiera
 * ten sam BookModal mode="propose" — pełna edycja, „Wyszukaj po danych",
 * „Oryginalny odczyt OCR", zapis dwuetapowy (Zapisz = PATCH draft, Zatwierdź =
 * POST confirm). Zachowuje pokrycie przypadków brzegowych z dawnego pliku:
 * S-19 (istniejący kandydat), ISBN-only search, brak wyników.
 *
 * Vision/match/external API ZAWSZE mockowane — zero kosztu LLM.
 */

const PHOTO_ID = 'cf42bf3a-0000-4000-8000-000000000001';
const DET_ID = '00000000-0000-4000-8000-000000000020';
const DRAFT_CANDIDATE_ID = '00000000-0000-4000-8000-000000000099';

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

// Druga, nierozstrzygnięta detekcja w każdym mocku zdjęcia — bez niej confirm
// jedynej detekcji na stronie robi `detections.every(decided)` = true i
// DetectionReview auto-redirectuje na /shelves/:id (M20), zabijając asercje na
// karcie po Zatwierdź. Nigdy nie decydowana w testach, więc redirect nie strzela.
const MOCK_DETECTION_OTHER = {
  id: '00000000-0000-4000-8000-000000000021',
  position_index: 2,
  raw_title: 'Inna książka na półce',
  raw_author: null,
  vision_confidence: 0.8,
  spine_color: null,
  bbox: { x1: 0.4, y1: 0.1, x2: 0.6, y2: 0.9 },
  status: 'matched',
  candidates: [
    {
      id: '00000000-0000-4000-8000-000000000022',
      source: 'google_books',
      externalId: 'gb-other',
      title: 'Inna książka na półce',
      authors: [],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      coverUrl: null,
      matchScore: 0.8,
      rank: 1,
    },
  ],
  duplicate: null,
};

function mockPhotoResponse(detections: unknown[]) {
  return {
    data: {
      photo: {
        id: PHOTO_ID,
        shelf_id: 'shelf-1',
        status: 'processed',
        detected_count: detections.length,
        error_message: null,
        vision_cost_usd: 0.005,
        vision_latency_ms: 3000,
        created_at: new Date().toISOString(),
      },
      photo_url: 'https://example.com/shelf.jpg',
      detections,
      vision_run: {
        id: 'vr-1',
        model: 'claude-sonnet-4-6',
        created_at: new Date().toISOString(),
        cost_usd: 0.005,
        latency_ms: 3000,
      },
    },
  };
}

test.describe('placeholder okładki (no-match) → BookModal', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
      if (route.request().method() !== 'GET') return void route.continue();
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          mockPhotoResponse([MOCK_DETECTION_NO_CANDIDATES, MOCK_DETECTION_OTHER]),
        ),
      });
    });
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.waitForSelector('[data-testid="candidate-cover-button"]');
  });

  test('placeholder okładki widoczny dla detekcji bez kandydatów', async ({ page }) => {
    await expect(page.getByTestId('candidate-cover-button').first()).toBeVisible();
    await expect(page.getByTestId('book-modal')).not.toBeVisible();
  });

  test('klik placeholdera tworzy draft (POST /candidate) i otwiera BookModal z tytułem z raw_title', async ({
    page,
  }) => {
    const draftRequest = page.waitForRequest(
      (req) => req.url().includes(`/api/detections/${DET_ID}/candidate`) && req.method() === 'POST',
    );
    await page.route(`**/api/detections/${DET_ID}/candidate`, (route) => {
      if (route.request().method() !== 'POST') return void route.continue();
      void route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            candidate_id: DRAFT_CANDIDATE_ID,
            title: MOCK_DETECTION_NO_CANDIDATES.raw_title,
            authors: [],
            isbn_13: null,
            isbn_10: null,
            publisher: null,
            published_year: null,
            cover_url: null,
          },
        }),
      });
    });

    await page.getByTestId('candidate-cover-button').first().click();
    await draftRequest;

    const modal = page.getByTestId('book-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('book-field-title')).toHaveValue(
      MOCK_DETECTION_NO_CANDIDATES.raw_title,
    );
  });

  test('zamknięcie BookModal bez zapisu usuwa draft (DELETE /candidate)', async ({ page }) => {
    await page.route(`**/api/detections/${DET_ID}/candidate`, (route) => {
      if (route.request().method() === 'POST') {
        return void route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              candidate_id: DRAFT_CANDIDATE_ID,
              title: MOCK_DETECTION_NO_CANDIDATES.raw_title,
              authors: [],
              isbn_13: null,
              isbn_10: null,
              publisher: null,
              published_year: null,
              cover_url: null,
            },
          }),
        });
      }
      return void route.continue();
    });

    await page.getByTestId('candidate-cover-button').first().click();
    await expect(page.getByTestId('book-modal')).toBeVisible();

    const deleteRequest = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/detections/${DET_ID}/candidate`) && req.method() === 'DELETE',
    );
    await page.getByTestId('book-modal-cancel').click();
    const req = await deleteRequest;
    expect((req.postDataJSON() as { candidate_id: string }).candidate_id).toBe(DRAFT_CANDIDATE_ID);
    await expect(page.getByTestId('book-modal')).not.toBeVisible();
  });

  test('„Oryginalny odczyt OCR" wypełnia pola z historii korekt, czyści publisher/rok/isbn', async ({
    page,
  }) => {
    await page.route(`**/api/detections/${DET_ID}/candidate`, (route) => {
      if (route.request().method() !== 'POST') return void route.continue();
      void route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            candidate_id: DRAFT_CANDIDATE_ID,
            title: MOCK_DETECTION_NO_CANDIDATES.raw_title,
            authors: [],
            isbn_13: null,
            isbn_10: null,
            publisher: null,
            published_year: null,
            cover_url: null,
          },
        }),
      });
    });
    await page.route(`**/api/detections/${DET_ID}/history`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            corrections: [
              {
                id: 'corr-1',
                correction_type: 'rematch',
                original_raw_title: 'Prawdziwy Oryginalny Tytuł',
                original_raw_author: 'Prawdziwy Oryginalny Autor',
                corrected_title: 'Poraniona blyskawica',
                corrected_authors: null,
                created_at: '2026-07-13T09:00:00.000Z',
              },
            ],
          },
        }),
      }),
    );

    await page.getByTestId('candidate-cover-button').first().click();
    const modal = page.getByTestId('book-modal');
    await expect(modal).toBeVisible();

    await modal.getByTestId('book-modal-use-original').click();
    await expect(modal.getByTestId('book-field-title')).toHaveValue('Prawdziwy Oryginalny Tytuł');
    await expect(modal.getByTestId('book-field-authors')).toHaveValue('Prawdziwy Oryginalny Autor');
    await expect(modal.getByTestId('book-field-publisher')).toHaveValue('');
    await expect(modal.getByTestId('book-field-year')).toHaveValue('');
    await expect(modal.getByTestId('book-field-isbn13')).toHaveValue('');
  });

  test('„Wyszukaj po danych" + wybór kandydata + Zapisz + Zatwierdź → detekcja potwierdzona', async ({
    page,
  }) => {
    await page.route(`**/api/detections/${DET_ID}/candidate`, (route) => {
      if (route.request().method() === 'POST') {
        return void route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              candidate_id: DRAFT_CANDIDATE_ID,
              title: MOCK_DETECTION_NO_CANDIDATES.raw_title,
              authors: [],
              isbn_13: null,
              isbn_10: null,
              publisher: null,
              published_year: null,
              cover_url: null,
            },
          }),
        });
      }
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        return void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { candidate_id: DRAFT_CANDIDATE_ID, ...body } }),
        });
      }
      return void route.continue();
    });
    await page.route('**/api/books/candidates', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            candidates: [
              {
                externalId: 'gb-1',
                source: 'google_books',
                title: 'Przerwana kołysanka',
                authors: ['Natasza Socha'],
                isbn13: '9788383100012',
                isbn10: null,
                publisher: null,
                publishedYear: 2022,
                coverUrl: null,
                matchScore: 0.95,
              },
            ],
          },
        }),
      }),
    );
    await page.route(`**/api/detections/${DET_ID}/confirm`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { book_id: 'book-1', shelf_id: 'shelf-1' } }),
      }),
    );

    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('candidate-cover-button').click();
    const modal = page.getByTestId('book-modal');
    await expect(modal).toBeVisible();

    await modal.getByTestId('search-candidates-toggle').click();
    await expect(modal.getByTestId('candidates-use-0')).toBeVisible({ timeout: 5000 });
    await modal.getByTestId('candidates-use-0').click();
    await expect(modal.getByTestId('book-field-title')).toHaveValue('Przerwana kołysanka');

    await modal.getByTestId('book-modal-save').click();
    await expect(modal.getByTestId('propose-saved')).toBeVisible();

    await modal.getByTestId('book-modal-confirm').click();
    await expect(modal).not.toBeVisible();
    await expect(card.getByTestId('undo-confirm-button')).toBeVisible();
  });

  test('S-153: wyszukiwanie po samym ISBN (bez tytułu) w „Wyszukaj po danych"', async ({
    page,
  }) => {
    await page.route(`**/api/detections/${DET_ID}/candidate`, (route) => {
      if (route.request().method() !== 'POST') return void route.continue();
      void route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            candidate_id: DRAFT_CANDIDATE_ID,
            title: MOCK_DETECTION_NO_CANDIDATES.raw_title,
            authors: [],
            isbn_13: null,
            isbn_10: null,
            publisher: null,
            published_year: null,
            cover_url: null,
          },
        }),
      });
    });
    let searchBody: { title?: string; isbn?: string } | null = null;
    await page.route('**/api/books/candidates', (route) => {
      searchBody = route.request().postDataJSON() as { title?: string; isbn?: string };
      return void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            candidates: [
              {
                externalId: 'gb-isbn',
                source: 'google_books',
                title: 'Przerwana kołysanka',
                authors: ['Natasza Socha'],
                isbn13: '9788383100012',
                isbn10: null,
                publisher: null,
                publishedYear: 2022,
                coverUrl: null,
                matchScore: 0.9,
              },
            ],
          },
        }),
      });
    });

    await page.getByTestId('candidate-cover-button').first().click();
    const modal = page.getByTestId('book-modal');
    await expect(modal).toBeVisible();

    // Formularz startuje z pre-wypełnionym tytułem (raw_title) — czyścimy dla ISBN-only.
    await modal.getByTestId('book-field-title').fill('');
    await modal.getByTestId('book-field-isbn13').fill('9788383100012');
    await expect(modal.getByTestId('search-candidates-toggle')).toBeEnabled();
    await modal.getByTestId('search-candidates-toggle').click();

    await expect(modal.getByTestId('candidates-use-0')).toBeVisible({ timeout: 5000 });
    expect(searchBody).toEqual(expect.objectContaining({ isbn: '9788383100012' }));
  });

  test('brak wyników w „Wyszukaj po danych" pokazuje komunikat', async ({ page }) => {
    await page.route(`**/api/detections/${DET_ID}/candidate`, (route) => {
      if (route.request().method() !== 'POST') return void route.continue();
      void route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            candidate_id: DRAFT_CANDIDATE_ID,
            title: MOCK_DETECTION_NO_CANDIDATES.raw_title,
            authors: [],
            isbn_13: null,
            isbn_10: null,
            publisher: null,
            published_year: null,
            cover_url: null,
          },
        }),
      });
    });
    await page.route('**/api/books/candidates', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidates: [] } }),
      }),
    );

    await page.getByTestId('candidate-cover-button').first().click();
    const modal = page.getByTestId('book-modal');
    await expect(modal).toBeVisible();

    await modal.getByTestId('search-candidates-toggle').click();
    await expect(modal.getByTestId('candidates-no-results')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// S-19 (manual-cover-match): edycja gdy detekcja MA już kandydata — auto-match
// pudłuje, user szuka właściwej książki przez ten sam BookModal, nowy wynik
// zastępuje dotychczasowego kandydata.
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

test.describe('S-19: edycja przy ISTNIEJĄCYM kandydacie (zły auto-match)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
      if (route.request().method() !== 'GET') return void route.continue();
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          mockPhotoResponse([
            { ...MOCK_DETECTION_NO_CANDIDATES, status: 'matched', candidates: [WRONG_CANDIDATE] },
            MOCK_DETECTION_OTHER,
          ]),
        ),
      });
    });
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.waitForSelector('[data-testid="detection-card-1"]');
  });

  test('klik okładki otwiera BookModal ze złym kandydatem prefillowanym', async ({ page }) => {
    await expect(page.getByText('Zupełnie inna książka').first()).toBeVisible();
    await page.getByTestId('detection-card-1').getByTestId('candidate-cover-button').click();
    const modal = page.getByTestId('book-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('book-field-title')).toHaveValue('Zupełnie inna książka');
    await expect(modal.getByTestId('book-field-isbn13')).toHaveValue('9788300000001');
  });

  test('„Wyszukaj po danych" + Zapisz + Zatwierdź zastępuje złego kandydata właściwym', async ({
    page,
  }) => {
    await page.route(`**/api/detections/${DET_ID}/candidate`, (route) => {
      if (route.request().method() !== 'PATCH') return void route.continue();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { candidate_id: WRONG_CANDIDATE.id, ...body } }),
      });
    });
    await page.route('**/api/books/candidates', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            candidates: [
              {
                externalId: 'gb-right',
                source: 'google_books',
                title: 'Solaris',
                authors: ['Stanisław Lem'],
                isbn13: '9780156027601',
                isbn10: null,
                publisher: 'Harvest',
                publishedYear: 1961,
                coverUrl: null,
                matchScore: 0.95,
              },
            ],
          },
        }),
      }),
    );
    await page.route(`**/api/detections/${DET_ID}/confirm`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { book_id: 'book-2', shelf_id: 'shelf-1' } }),
      }),
    );

    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('candidate-cover-button').click();
    const modal = page.getByTestId('book-modal');
    await expect(modal).toBeVisible();

    await modal.getByTestId('search-candidates-toggle').click();
    await expect(modal.getByTestId('candidates-use-0')).toBeVisible({ timeout: 5000 });
    await modal.getByTestId('candidates-use-0').click();
    await expect(modal.getByTestId('book-field-title')).toHaveValue('Solaris');

    await modal.getByTestId('book-modal-save').click();
    await expect(modal.getByTestId('propose-saved')).toBeVisible();
    await modal.getByTestId('book-modal-confirm').click();
    await expect(modal).not.toBeVisible();

    // Business outcome: zły kandydat zniknął, karta pokazuje potwierdzoną Solaris.
    await expect(card.getByTestId('undo-confirm-button')).toBeVisible();
    await expect(card).toContainText('Solaris');
    await expect(
      card.getByTestId('candidate-title').filter({ hasText: 'Zupełnie inna książka' }),
    ).not.toBeVisible();
  });
});
