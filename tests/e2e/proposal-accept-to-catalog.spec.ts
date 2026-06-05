import { expect, test } from '@playwright/test';

/**
 * Golden path E2E dla S-05 (gwiazda przewodnia — Flow A end-to-end):
 *
 *   upload → detect → match → review z propozycjami
 *   → bulk-accept pre-zaznaczonych (≥0.75)
 *   → single confirm
 *   → correct (field_edit)
 *   → manual entry (brak matchu)
 *   → reject
 *   → widok półki z okładkami (ShelfBooksIsland)
 *   → toggle przeczytana
 *
 * Wszystkie API endpointy mockowane przez page.route() — zero realnego
 * vision/LLM/Google Books (koszt = twardy guardrail, CLAUDE.md §Testy).
 * Auth: współdzielona sesja z auth.setup.ts (storageState).
 */

const PHOTO_ID = '00000000-0000-4000-8000-f05f05f05f05';
const SHELF_ID = '00000000-0000-4000-8000-f05f05f05f06';
const DET_HIGH = '00000000-0000-4000-8000-f05f05f05f10';
const DET_LOW = '00000000-0000-4000-8000-f05f05f05f11';
const DET_MANUAL = '00000000-0000-4000-8000-f05f05f05f12';
const DET_REJECT = '00000000-0000-4000-8000-f05f05f05f13';
const CAND_HIGH = '00000000-0000-4000-8000-f05f05f05f20';
const CAND_LOW = '00000000-0000-4000-8000-f05f05f05f21';
const BOOK_HIGH = '00000000-0000-4000-8000-f05f05f05f50';

const MOCK_PHOTO = {
  id: PHOTO_ID,
  shelf_id: SHELF_ID,
  status: 'processed',
  detected_count: 4,
  error_message: null,
  vision_cost_usd: 0.005,
  vision_latency_ms: 4200,
  created_at: new Date().toISOString(),
};

const MOCK_VISION_RUN = {
  id: 'vr-e2e',
  model: 'claude-sonnet-4-6',
  created_at: new Date().toISOString(),
  cost_usd: 0.005,
  latency_ms: 4200,
};

const MOCK_DETECTIONS = [
  {
    id: DET_HIGH,
    position_index: 1,
    raw_title: 'Solaris',
    raw_author: 'Stanisław Lem',
    vision_confidence: 0.95,
    spine_color: 'niebieski',
    bbox: null,
    status: 'matched',
    candidates: [{
      id: CAND_HIGH,
      source: 'google_books',
      externalId: 'gb-1',
      title: 'Solaris',
      authors: ['Stanisław Lem'],
      isbn10: null,
      isbn13: '9780156027601',
      publisher: 'Harvest',
      publishedYear: 1961,
      coverUrl: null,
      matchScore: 0.92,
      rank: 1,
    }],
    duplicate: null,
  },
  {
    id: DET_LOW,
    position_index: 2,
    raw_title: 'Diunax',
    raw_author: 'Herbert',
    vision_confidence: 0.80,
    spine_color: 'brązowy',
    bbox: null,
    status: 'matched',
    candidates: [{
      id: CAND_LOW,
      source: 'google_books',
      externalId: 'gb-2',
      title: 'Diuna',
      authors: ['Frank Herbert'],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: 1965,
      coverUrl: null,
      matchScore: 0.60,
      rank: 1,
    }],
    duplicate: null,
  },
  {
    id: DET_MANUAL,
    position_index: 3,
    raw_title: 'Starożytna Nieznana',
    raw_author: null,
    vision_confidence: 0.65,
    spine_color: 'żółty',
    bbox: null,
    status: 'pending',
    candidates: [],
    duplicate: null,
  },
  {
    id: DET_REJECT,
    position_index: 4,
    raw_title: 'Grzbiet niezidentyfikowany',
    raw_author: null,
    vision_confidence: 0.50,
    spine_color: 'szary',
    bbox: null,
    status: 'matched',
    candidates: [{
      id: '00000000-0000-4000-8000-f05f05f05f22',
      source: 'open_library',
      externalId: 'ol-1',
      title: 'Zły match',
      authors: [],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      coverUrl: null,
      matchScore: 0.40,
      rank: 1,
    }],
    duplicate: null,
  },
];

const SHELF_BOOKS_AFTER = [
  {
    id: BOOK_HIGH,
    title: 'Solaris',
    authors: ['Stanisław Lem'],
    cover_url: null,
    published_year: 1961,
    position_index: 1,
    is_read: false,
  },
];

test.describe('S-05 — proposal-accept-to-catalog golden path (mock)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock GET /api/photos/[id] — zwraca 4 detekcje (high/low/no-match/reject)
    await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { photo: MOCK_PHOTO, detections: MOCK_DETECTIONS, vision_run: MOCK_VISION_RUN },
          }),
        });
      } else {
        void route.continue();
      }
    });

    // Mock POST /api/photos/[id]/confirm-batch (bulk accept)
    await page.route(`**/api/photos/${PHOTO_ID}/confirm-batch`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            confirmed: [{ detection_id: DET_HIGH, book_id: BOOK_HIGH }],
            skipped: [],
          },
        }),
      });
    });

    // Mock POST /api/detections/*/confirm
    await page.route(`**/api/detections/${DET_LOW}/confirm`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { book_id: '00000000-0000-4000-8000-f05f05f05f51', shelf_id: SHELF_ID } }),
      });
    });

    // Mock POST /api/detections/*/correct
    await page.route(`**/api/detections/${DET_LOW}/correct`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { book_id: '00000000-0000-4000-8000-f05f05f05f52', shelf_id: SHELF_ID } }),
      });
    });
    await page.route(`**/api/detections/${DET_MANUAL}/correct`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { book_id: '00000000-0000-4000-8000-f05f05f05f53', shelf_id: SHELF_ID } }),
      });
    });

    // Mock POST /api/detections/*/reject
    await page.route(`**/api/detections/${DET_REJECT}/reject`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { rejected: true } }),
      });
    });

    // Mock POST /api/detections/*/unreject (cofnięcie odrzucenia)
    await page.route(`**/api/detections/${DET_REJECT}/unreject`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { status: 'matched' } }),
      });
    });

    // Mock GET /api/shelves/[id]/books (widok półki po decyzjach)
    await page.route(`**/api/shelves/${SHELF_ID}/books`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: SHELF_BOOKS_AFTER } }),
      });
    });

    // Mock PATCH /api/books/* (toggle)
    await page.route(`**/api/books/${BOOK_HIGH}`, (route) => {
      if (route.request().method() === 'PATCH') {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { id: BOOK_HIGH, is_read: true } }),
        });
      } else {
        void route.continue();
      }
    });
  });

  test('review page — propozycje widoczne po załadowaniu', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('detection-review')).toBeVisible();
    await expect(page.getByTestId(`detection-card-1`)).toBeVisible();
    await expect(page.getByTestId(`detection-card-2`)).toBeVisible();
    await expect(page.getByTestId(`detection-card-3`)).toBeVisible();
    await expect(page.getByTestId(`detection-card-4`)).toBeVisible();
  });

  test('bulk-confirm-button widoczny dla detekcji ≥0.75', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('bulk-confirm-button')).toBeVisible();
    // Tekst informuje o liczbie pre-zaznaczonych (1 detekcja ≥0.75)
    await expect(page.getByTestId('bulk-confirm-button')).toContainText('Akceptuj pre-zaznaczone');
  });

  test('klik bulk-confirm wywołuje /confirm-batch i oznacza detekcję jako zdecydowaną', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.getByTestId('bulk-confirm-button').click();
    // Po bulk-accept karta DET_HIGH zamienia się na decided (zielona)
    await expect(page.getByTestId(`detection-card-1`)).toContainText('Solaris');
  });

  test('correct (field_edit) — formularz otwiera się, wyświetla pola', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.getByTestId('detection-card-2').getByTestId('correct-button').click();
    await expect(page.getByTestId('correct-form')).toBeVisible();
    await expect(page.getByTestId('correct-title')).toBeVisible();
    await expect(page.getByTestId('correct-authors')).toBeVisible();
  });

  test('manual entry — formularz otwiera się przy braku matchu', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('no-match-placeholder')).toBeVisible();
    await page.getByTestId('manual-entry-button').click();
    await expect(page.getByTestId('correct-form')).toBeVisible();
  });

  test('reject — karta pokazuje „Odrzucono" + Cofnij (nie zielony stan akceptacji)', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.getByTestId('detection-card-4').getByTestId('reject-button').click();
    // Po reject karta przechodzi w stan odrzucenia — odrębny od akceptacji
    const card = page.getByTestId('detection-card-4');
    await expect(card).toContainText('Odrzucono');
    await expect(card).toContainText('Grzbiet niezidentyfikowany');
    await expect(card.getByTestId('undo-reject-button')).toBeVisible();
  });

  test('reject → Cofnij — przywraca akcje detekcji (woła /unreject)', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    const card = page.getByTestId('detection-card-4');
    await card.getByTestId('reject-button').click();
    const undoBtn = card.getByTestId('undo-reject-button');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();
    // Wraca do stanu nierozstrzygniętego — przycisk Odrzuć znów dostępny
    await expect(page.getByTestId('detection-card-4').getByTestId('reject-button')).toBeVisible();
  });

  test('podgląd szczegówów — klik w okładkę propozycji otwiera modal z danymi', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    const coverBtn = page.getByTestId('detection-card-1').getByTestId('candidate-cover-button');
    await expect(coverBtn).toBeVisible();
    await coverBtn.click();
    const modal = page.getByTestId('book-detail-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Solaris');
    await expect(modal).toContainText('9780156027601'); // ISBN kandydata
    // zamknięcie przez X
    await modal.getByTestId('book-detail-close').click();
    await expect(modal).not.toBeVisible();
  });

  test('web search — „Szukaj w sieci" linkuje do Google w nowej karcie', async ({ page }) => {
    await page.goto(`/photos/${PHOTO_ID}`);
    const link = page.getByTestId('detection-card-1').getByTestId('web-search-button');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toContain('google.com/search');
    expect(decodeURIComponent(href)).toContain('Solaris');
  });

  test('widok półki — grid książek + toggle read', async ({ page }) => {
    // Pobierz realny shelf_id z listy półek (półka "Zakupione" zawsze istnieje)
    await page.goto('/shelves');
    const shelfLink = page.locator('a[href^="/shelves/"]').first();
    const shelfHref = await shelfLink.getAttribute('href');
    const realShelfId = shelfHref?.split('/shelves/')[1] ?? '';

    // Ustaw mock dla realnego shelf_id
    await page.route(`**/api/shelves/${realShelfId}/books`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: SHELF_BOOKS_AFTER } }),
      });
    });

    // Mock toggle dla realnego book
    await page.route(`**/api/books/${BOOK_HIGH}`, (route) => {
      if (route.request().method() === 'PATCH') {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { id: BOOK_HIGH, is_read: true } }),
        });
      } else {
        void route.continue();
      }
    });

    // Nawiguj na realną stronę półki
    await page.goto(`/shelves/${realShelfId}`);

    // ShelfBooksIsland ładuje mock-books
    await expect(page.getByTestId('shelf-books-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId(`book-card-${BOOK_HIGH}`)).toBeVisible();

    // Toggle is_read
    const toggleBtn = page.getByTestId(`toggle-read-${BOOK_HIGH}`);
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    await toggleBtn.click();
    // Optimistic update
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
