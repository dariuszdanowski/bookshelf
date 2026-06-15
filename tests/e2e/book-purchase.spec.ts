import { expect, test } from '@playwright/test';

/**
 * E2E dla book-purchase-metadata (Phase 4):
 * 1. PhotoPurchasePanel zapisuje city → PATCH /api/photos/[id]
 * 2. Confirm detekcji → purchase info w odpowiedzi (mock)
 * 3. BookModal edit → wypełnia purchase fields → PATCH /api/books/[id]
 * 4. Library filter Wydarzenie → search request ma purchase_event
 * 5. Library filter Cena min/max → search request ma purchase_price_min/max
 *
 * Wszystkie API mockowane przez page.route — zero realnego DB.
 * UUIDs: tylko znaki hex 0-9, a-f (parseUuidParam wymaga poprawnego formatu).
 */

const PHOTO_ID = '00000000-0000-4000-8000-cc0000000099';
const DET_ID = '00000000-0000-4000-8000-cc0000000010';
const CAND_ID = '00000000-0000-4000-8000-cc0000000020';
const BOOK_ID = '00000000-0000-4000-8000-cc0000000050';

const MOCK_PHOTO_RESPONSE = {
  data: {
    photo: {
      id: PHOTO_ID,
      shelf_id: null,
      status: 'processed',
      detected_count: 1,
      error_message: null,
      vision_cost_usd: 0.005,
      vision_latency_ms: 2000,
      created_at: '2026-01-01T00:00:00Z',
    },
    photo_url: null,
    vision_run: {
      id: 'vr-bp',
      model: 'claude-sonnet-4-6',
      created_at: '2026-01-01T00:00:00Z',
      cost_usd: 0.005,
      latency_ms: 2000,
    },
    detections: [
      {
        id: DET_ID,
        photo_id: PHOTO_ID,
        position_index: 1,
        raw_title: 'Wiedźmin',
        raw_author: 'Andrzej Sapkowski',
        vision_confidence: 0.9,
        spine_color: null,
        bbox: null,
        status: 'matched',
        duplicate: null,
        candidates: [
          {
            id: CAND_ID,
            detection_id: DET_ID,
            source: 'google_books',
            externalId: 'gb-bp',
            title: 'Wiedźmin',
            authors: ['Andrzej Sapkowski'],
            isbn13: '9788375780635',
            isbn10: null,
            publisher: 'SuperNOWA',
            publishedYear: 1990,
            coverUrl: null,
            matchScore: 0.95,
            rank: 1,
          },
        ],
      },
    ],
  },
};

const MOCK_BOOK = {
  id: BOOK_ID,
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  cover_url: null,
  user_cover_url: null,
  cover_photo_url: null,
  cover_source: 'auto',
  published_year: 1961,
  publisher: null,
  isbn_13: null,
  isbn_10: null,
  position_index: 1,
  is_read: false,
  photo_id: null,
  purchase_date: null,
  purchase_price: null,
  purchase_city: null,
  purchase_event: null,
};

// ---------------------------------------------------------------------------
// 1. PhotoPurchasePanel — zapisuje city → PATCH /api/photos/[id]
// ---------------------------------------------------------------------------

test('PhotoPurchasePanel: wpisanie miasta → PATCH /api/photos z purchase_city', async ({
  page,
}) => {
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PHOTO_RESPONSE),
      });
    } else if (route.request().method() === 'PATCH') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { photo: null } }),
      });
    } else {
      void route.continue();
    }
  });

  await page.route('**/api/books/purchase-hints**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { hints: ['Kraków', 'Warszawa'] } }),
    });
  });

  // Zarejestruj waiter PRZED goto — hints fetch = sygnał hydracji komponentu
  const hintsReady = page.waitForResponse((r) => r.url().includes('/api/books/purchase-hints'), {
    timeout: 10_000,
  });

  await page.goto(`/photos/${PHOTO_ID}`);

  // Poczekaj na hydrację PhotoPurchasePanel (hints fetch = komponent zamontowany)
  await hintsReady;

  // Otwórz <details> klikając <summary>
  await page.locator('[data-testid="photo-purchase-panel"] summary').click();

  // Czekaj aż input będzie widoczny po rozwinięciu
  const cityInput = page.getByTestId('panel-purchase-city');
  await expect(cityInput).toBeVisible({ timeout: 5_000 });

  // Wpisz miasto i poczekaj na PATCH (debounce 600ms)
  const patchReq = page.waitForRequest(
    (r) => r.url().includes(`/api/photos/${PHOTO_ID}`) && r.method() === 'PATCH',
    { timeout: 3_000 },
  );
  await cityInput.fill('Kraków');
  const req = await patchReq;
  const body = req.postDataJSON() as { purchase_city?: string };
  expect(body.purchase_city).toBe('Kraków');
});

// ---------------------------------------------------------------------------
// 2. Confirm detekcji → purchase info propagowane (mock confirm response)
// ---------------------------------------------------------------------------

test('Confirm detekcji: odpowiedź confirm zawiera purchase_city z mock', async ({ page }) => {
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PHOTO_RESPONSE),
      });
    } else {
      void route.continue();
    }
  });

  await page.route(`**/api/detections/${DET_ID}/confirm`, (route) => {
    if (route.request().method() === 'POST') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            book_id: BOOK_ID,
            shelf_entry_id: '00000000-0000-4000-8000-cc0000000099',
            purchase_city: 'Kraków',
          },
        }),
      });
    } else {
      void route.continue();
    }
  });

  await page.route('**/api/books/purchase-hints**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { hints: [] } }),
    });
  });

  await page.goto(`/photos/${PHOTO_ID}`);
  // Poczekaj aż DetectionReview załaduje kandydata i pokaże confirm-button
  const confirmBtn = page.getByTestId('confirm-button').first();
  await expect(confirmBtn).toBeVisible({ timeout: 10_000 });

  const confirmRes = page.waitForResponse(
    (r) => r.url().includes(`/api/detections/${DET_ID}/confirm`) && r.request().method() === 'POST',
  );
  await confirmBtn.click();
  const res = await confirmRes;
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { data?: { purchase_city?: string } };
  expect(json.data?.purchase_city).toBe('Kraków');
});

// ---------------------------------------------------------------------------
// 3. BookModal edit: wypełnia purchase fields → PATCH /api/books/[id]
// ---------------------------------------------------------------------------

test('BookModal edit: wypełnienie ceny/miasta → PATCH /api/books z polami zakupu', async ({
  page,
}) => {
  // Krok 1: Pobierz realny shelf ID BEZ mockowania /api/shelves
  // (ShelvesIsland używa /api/shelves do renderowania linków do półek)
  await page.goto('/shelves');
  const shelfLink = page.locator('a[href^="/shelves/"]').first();
  await expect(shelfLink).toBeVisible({ timeout: 10_000 });
  const href = (await shelfLink.getAttribute('href')) ?? '';
  const shelfId = href.split('/shelves/')[1] ?? '';

  // Krok 2: Ustaw mocki i nawiguj na stronę półki
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

  await page.route('**/api/books/purchase-hints**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { hints: [] } }),
    });
  });

  await page.goto(`/shelves/${shelfId}`);
  await expect(page.getByTestId('shelf-books-grid')).toBeVisible({ timeout: 10_000 });

  // Otwórz modal edycji klikając w okładkę
  await page.getByTestId(`book-cover-button-${BOOK_ID}`).click();
  await expect(page.getByTestId('book-modal')).toBeVisible();

  // Rozwiń sekcję zakupu
  const purchaseSummary = page.locator('[data-testid="book-modal"] details summary', {
    hasText: 'Informacje o zakupie',
  });
  await expect(purchaseSummary).toBeVisible({ timeout: 5_000 });
  await purchaseSummary.click();

  // Wypełnij pola zakupu
  await page.getByTestId('purchase-price').fill('49.99');
  await page.getByTestId('purchase-city').fill('Kraków');

  // Zapisz i sprawdź PATCH
  const patchReq = page.waitForRequest(
    (r) => r.url().includes(`/api/books/${BOOK_ID}`) && r.method() === 'PATCH',
  );
  await page.getByTestId('book-modal-save').click();
  const req = await patchReq;
  const body = req.postDataJSON() as { purchase_price?: number; purchase_city?: string };
  expect(body.purchase_price).toBe(49.99);
  expect(body.purchase_city).toBe('Kraków');

  await expect(page.getByTestId('book-modal')).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 4. Library filter Wydarzenie → search request ma purchase_event param
// ---------------------------------------------------------------------------

test('Library filter Wydarzenie: dropdown → search z purchase_event param', async ({ page }) => {
  await page.route('**/api/shelves', (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { shelves: [] } }),
      });
    } else {
      void route.continue();
    }
  });

  await page.route('**/api/books/search**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: [], total: 0 } }),
    });
  });

  // Hints z konkretnym wydarzeniem — zarejestruj PRZED goto (może zadziałać na mount)
  await page.route('**/api/books/purchase-hints**', (route) => {
    const url = route.request().url();
    if (url.includes('type=event')) {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { hints: ['Targi Książki Warszawa'] } }),
      });
    } else {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { hints: [] } }),
      });
    }
  });

  // Rejestruj waitForResponse PRZED nawigacją — hints może zadziałać na mount
  const hintsPromise = page.waitForResponse(
    (r) => r.url().includes('/api/books/purchase-hints') && r.url().includes('type=event'),
    { timeout: 10_000 },
  );

  await page.goto('/library');
  await page.waitForResponse(
    (r) => r.url().includes('/api/shelves') && r.request().method() === 'GET',
  );

  // Poczekaj aż hints się załadują
  await hintsPromise;

  // Rozwiń filtr zakupu
  await page.locator('details summary', { hasText: 'Filtruj po zakupie' }).click();
  await expect(page.getByTestId('filter-purchase-event')).toBeVisible({ timeout: 5_000 });

  // Wybierz wydarzenie i sprawdź request do search
  const searchReq = page.waitForRequest(
    (r) => r.url().includes('/api/books/search') && r.url().includes('purchase_event='),
    { timeout: 5_000 },
  );
  await page.getByTestId('filter-purchase-event').selectOption('Targi Książki Warszawa');
  const req = await searchReq;
  // URL.searchParams.get dekoduje + → spacja i %XX → znak; toContain szuka podciągu
  const searchUrl = new URL(req.url());
  expect(searchUrl.searchParams.get('purchase_event')).toBe('Targi Książki Warszawa');
});

// ---------------------------------------------------------------------------
// 5. Library filter Cena min/max → search request ma purchase_price_min/max
// ---------------------------------------------------------------------------

test('Library filter Cena: min/max → search z purchase_price_min/max params', async ({ page }) => {
  await page.route('**/api/shelves', (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { shelves: [] } }),
      });
    } else {
      void route.continue();
    }
  });

  await page.route('**/api/books/search**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: [], total: 0 } }),
    });
  });

  await page.route('**/api/books/purchase-hints**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { hints: [] } }),
    });
  });

  await page.goto('/library');
  await page.waitForResponse(
    (r) => r.url().includes('/api/shelves') && r.request().method() === 'GET',
  );

  // Rozwiń filtr zakupu
  await page.locator('details summary', { hasText: 'Filtruj po zakupie' }).click();
  await expect(page.getByTestId('filter-purchase-price-min')).toBeVisible({ timeout: 5_000 });

  // Wpisz zakres ceny — czekaj na oba params w jednym request
  const searchReq = page.waitForRequest(
    (r) =>
      r.url().includes('/api/books/search') &&
      r.url().includes('purchase_price_min=') &&
      r.url().includes('purchase_price_max='),
    { timeout: 5_000 },
  );
  await page.getByTestId('filter-purchase-price-min').fill('20');
  await page.getByTestId('filter-purchase-price-max').fill('80');
  const req = await searchReq;
  expect(req.url()).toContain('purchase_price_min=20');
  expect(req.url()).toContain('purchase_price_max=80');
});
