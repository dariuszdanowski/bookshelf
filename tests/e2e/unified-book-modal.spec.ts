import { expect, test, type Page } from '@playwright/test';

/**
 * E2E — S-36 unified BookModal: tryby add / edit / propose.
 * Ryzyko: rozproszony kod dodawania/edycji książek (ManualAddBook + BookDetailModal)
 * zastąpiony jednym BookModal(mode); test weryfikuje integrację z ShelfBooksIsland
 * (add/edit) i DetectionReview (propose) przez prawdziwy routing + mockowane API.
 *
 * API mockowane przez page.route — zero realnego DB write.
 * Auth: współdzielona sesja storageState.
 *
 * UWAGA: shelf-mode tests use wildcard '*\/api\/shelves\/*\/books' set up BEFORE any
 * navigation, then navigate to /shelves to get a real shelf ID (server-side
 * /shelves/[id].astro validates the shelf exists, so fake UUIDs redirect).
 * Pattern from proposal-accept-to-catalog.spec.ts.
 */

const BOOK_ID  = '00000000-0000-4000-8000-360000000050';
const PHOTO_ID = '00000000-0000-4000-8000-360000000099';
const DET_ID   = '00000000-0000-4000-8000-360000000010';
const CAND_ID  = '00000000-0000-4000-8000-360000000020';

const MOCK_BOOK = {
  id: BOOK_ID,
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  cover_url: null,
  user_cover_url: null,
  cover_photo_url: null,
  cover_source: 'auto',
  published_year: 1961,
  publisher: 'Solaris Press',
  isbn_13: '9780156027601',
  isbn_10: null,
  position_index: 1,
  is_read: false,
  photo_id: null,
};

/**
 * Navigate to /shelves list and return the first real shelf ID from the DOM.
 * Must be called AFTER setting up route mocks (so the mock is active during
 * the shelf page navigation that follows).
 */
async function getRealShelfId(page: Page): Promise<string> {
  await page.goto('/shelves');
  const link = page.locator('a[href^="/shelves/"]').first();
  await expect(link).toBeVisible({ timeout: 10000 });
  const href = (await link.getAttribute('href')) ?? '';
  return href.split('/shelves/')[1] ?? '';
}

// ---------------------------------------------------------------------------
// add mode
// ---------------------------------------------------------------------------

test.describe('S-36 BookModal — tryb add', () => {
  test('otwieranie modala, walidacja (disabled przy pustym tytule), zamknięcie', async ({ page }) => {
    // Wildcard mock set up BEFORE any navigation — intercepts /api/shelves/<any>/books
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [] } }),
      });
    });

    const shelfId = await getRealShelfId(page);
    await page.goto(`/shelves/${shelfId}`);
    await expect(page.getByTestId('add-book-button')).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('book-modal')).not.toBeVisible();
    await page.getByTestId('add-book-button').click();
    await expect(page.getByTestId('book-modal')).toBeVisible();

    // Przycisk zapisu disabled gdy tytuł pusty
    await expect(page.getByTestId('book-modal-save')).toBeDisabled();

    // Zamknięcie przez X
    await page.getByTestId('book-modal-close').click();
    await expect(page.getByTestId('book-modal')).not.toBeVisible();
  });

  test('wypełnienie tytułu → aktywny przycisk → POST /api/books → modal zamknięty', async ({ page }) => {
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [] } }),
      });
    });

    await page.route('**/api/books', (route) => {
      if (route.request().method() === 'POST') {
        void route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: { id: BOOK_ID } }),
        });
      } else {
        void route.continue();
      }
    });

    const shelfId = await getRealShelfId(page);
    await page.goto(`/shelves/${shelfId}`);
    await expect(page.getByTestId('add-book-button')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('add-book-button').click();
    await expect(page.getByTestId('book-modal')).toBeVisible();

    await page.getByTestId('book-field-title').fill('Solaris');
    await expect(page.getByTestId('book-modal-save')).toBeEnabled();
    await page.getByTestId('book-modal-save').click();

    await expect(page.getByTestId('book-modal')).not.toBeVisible();
  });

  test('Wyszukaj po danych → wybór kandydata prefilluje pola', async ({ page }) => {
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [] } }),
      });
    });

    await page.route('**/api/books/candidates', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            candidates: [{
              externalId: 'gb-test',
              source: 'google_books',
              title: 'Solaris',
              authors: ['Stanisław Lem'],
              isbn13: '9780156027601',
              isbn10: null,
              publisher: 'Solaris Press',
              publishedYear: 1961,
              coverUrl: null,
              matchScore: 0.92,
            }],
          },
        }),
      });
    });

    const shelfId = await getRealShelfId(page);
    await page.goto(`/shelves/${shelfId}`);
    await expect(page.getByTestId('add-book-button')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('add-book-button').click();
    await expect(page.getByTestId('book-modal')).toBeVisible();

    // W trybie add: wpisz tytuł w głównym formularzu, kliknij toggle — auto-szuka bez dodatkowego formularza
    await page.getByTestId('book-field-title').fill('Solaris');
    await page.getByTestId('search-candidates-toggle').click();

    await expect(page.getByTestId('candidates-use-0')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('candidates-use-0').click();

    await expect(page.getByTestId('book-field-title')).toHaveValue('Solaris');
    await expect(page.getByTestId('book-field-isbn13')).toHaveValue('9780156027601');
  });
});

// ---------------------------------------------------------------------------
// edit mode
// ---------------------------------------------------------------------------

test.describe('S-36 BookModal — tryb edit', () => {
  test('klik w okładkę otwiera modal z danymi → Escape zamyka', async ({ page }) => {
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [MOCK_BOOK] } }),
      });
    });

    const shelfId = await getRealShelfId(page);
    await page.goto(`/shelves/${shelfId}`);
    await expect(page.getByTestId('shelf-books-grid')).toBeVisible({ timeout: 10000 });

    await page.getByTestId(`book-cover-button-${BOOK_ID}`).click();
    await expect(page.getByTestId('book-modal')).toBeVisible();

    // Dane prefillowane
    await expect(page.getByTestId('book-field-title')).toHaveValue('Solaris');
    await expect(page.getByTestId('book-field-isbn13')).toHaveValue('9780156027601');

    // Przycisk zapisu jest dostępny (edit mode ma zapis)
    await expect(page.getByTestId('book-modal-save')).toBeVisible();
    await expect(page.getByTestId('book-modal-save')).toBeEnabled();

    // Pola EDYTOWALNE (nie readOnly)
    await expect(page.getByTestId('book-field-title')).not.toHaveAttribute('readonly');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('book-modal')).not.toBeVisible();
  });

  test('zmiana tytułu → PATCH /api/books/:id → modal zamknięty', async ({ page }) => {
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [MOCK_BOOK] } }),
      });
    });

    await page.route(`**/api/books/${BOOK_ID}`, (route) => {
      if (route.request().method() === 'PATCH') {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { id: BOOK_ID } }),
        });
      } else {
        void route.continue();
      }
    });

    const shelfId = await getRealShelfId(page);
    await page.goto(`/shelves/${shelfId}`);
    await expect(page.getByTestId('shelf-books-grid')).toBeVisible({ timeout: 10000 });
    await page.getByTestId(`book-cover-button-${BOOK_ID}`).click();
    await expect(page.getByTestId('book-modal')).toBeVisible();

    await page.getByTestId('book-field-title').fill('Solaris (nowe wydanie)');
    await page.getByTestId('book-modal-save').click();

    await expect(page.getByTestId('book-modal')).not.toBeVisible();
  });

  test('Wyszukaj po danych w edit → brak zdublowanych pól, szuka po danych książki', async ({ page }) => {
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [MOCK_BOOK] } }),
      });
    });

    await page.route('**/api/books/candidates', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            candidates: [{
              externalId: 'gb-edit',
              source: 'google_books',
              title: 'Solaris',
              authors: ['Stanisław Lem'],
              isbn13: '9788308062803',
              isbn10: null,
              publisher: 'Wydawnictwo Literackie',
              publishedYear: 2016,
              coverUrl: null,
              matchScore: 0.95,
            }],
          },
        }),
      });
    });

    const shelfId = await getRealShelfId(page);
    await page.goto(`/shelves/${shelfId}`);
    await expect(page.getByTestId('shelf-books-grid')).toBeVisible({ timeout: 10000 });
    await page.getByTestId(`book-cover-button-${BOOK_ID}`).click();
    await expect(page.getByTestId('book-modal')).toBeVisible();

    // Toggle „Wyszukaj po danych" — auto-szuka po danych już wpisanych w głównym formularzu
    await page.getByTestId('search-candidates-toggle').click();

    // REGRESJA (bug zdublowanych pól): w edit, tak jak w add, NIE renderujemy
    // formularza tytuł/ISBN/autor w panelu — pola są już w głównym formularzu.
    await expect(page.getByTestId('candidates-title')).toHaveCount(0);

    // Auto-search po danych książki zwraca kandydata
    await expect(page.getByTestId('candidates-use-0')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('candidates-use-0').click();

    // Wybór kandydata nadpisuje pola w głównym formularzu
    await expect(page.getByTestId('book-field-isbn13')).toHaveValue('9788308062803');
  });
});

// ---------------------------------------------------------------------------
// propose mode (podgląd kandydata w DetectionReview — read-only)
// /photos/[id].astro degrades gracefully for missing photos (no redirect),
// so a fake PHOTO_ID is safe here. Wait for UI element instead of
// waitForResponse (which may fire during page.goto before the listener is set).
// ---------------------------------------------------------------------------

test.describe('S-36 BookModal — tryb propose', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              photo: {
                id: PHOTO_ID,
                shelf_id: null,
                status: 'processed',
                detected_count: 1,
                error_message: null,
                vision_cost_usd: 0.005,
                vision_latency_ms: 3000,
                created_at: new Date().toISOString(),
              },
              photo_url: null,
              vision_run: {
                id: 'vr-s36',
                model: 'claude-sonnet-4-6',
                created_at: new Date().toISOString(),
                cost_usd: 0.005,
                latency_ms: 3000,
              },
              detections: [{
                id: DET_ID,
                photo_id: PHOTO_ID,
                position_index: 1,
                raw_title: 'Solaris',
                raw_author: 'Stanisław Lem',
                vision_confidence: 0.95,
                spine_color: null,
                bbox: null,
                status: 'matched',
                duplicate: null,
                candidates: [{
                  id: CAND_ID,
                  detection_id: DET_ID,
                  source: 'google_books',
                  externalId: 'gb-s36',
                  title: 'Solaris',
                  authors: ['Stanisław Lem'],
                  isbn13: '9780156027601',
                  isbn10: null,
                  publisher: 'Solaris Press',
                  publishedYear: 1961,
                  coverUrl: null,
                  matchScore: 0.92,
                  rank: 1,
                }],
              }],
            },
          }),
        });
      } else {
        void route.continue();
      }
    });
  });

  test('klik w okładkę kandydata → read-only modal, brak Zapisz, Szukaj w sieci widoczny, Escape zamyka', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    // Wait for candidate to appear (DetectionReview fetches /api/photos/${PHOTO_ID})
    await expect(page.getByTestId('candidate-cover-button').first()).toBeVisible({ timeout: 10000 });

    await page.getByTestId('candidate-cover-button').first().click();
    await expect(page.getByTestId('book-modal')).toBeVisible();

    // Pola read-only
    await expect(page.getByTestId('book-field-title')).toHaveValue('Solaris');
    await expect(page.getByTestId('book-field-title')).toHaveAttribute('readonly', '');

    // ISBN widoczny w polu
    await expect(page.getByTestId('book-field-isbn13')).toHaveValue('9780156027601');

    // Brak przycisku zapisu w propose mode
    await expect(page.getByTestId('book-modal-save')).not.toBeVisible();

    // Link „Szukaj w sieci" widoczny
    await expect(page.getByTestId('book-modal-web-search')).toBeVisible();

    // Escape zamyka
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('book-modal')).not.toBeVisible();
  });
});
