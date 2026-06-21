import { expect, test } from '@playwright/test';

/**
 * Golden path E2E dla S-07 (przenoszenie książki między półkami):
 *   /library → wynik wyszukiwania z półką „Salon" → picker „Przenieś na półkę…"
 *   → wybór „Sypialnia" → POST /api/books/:id/move → optimistic: badge półki = „Sypialnia".
 *   Plus: błąd move (500) → rollback badge do „Salon".
 *
 * API mockowane przez page.route (zero realnego DB write) — zgodnie z konwencją
 * pozostałych speców (CLAUDE.md). Adaptacja vs plan: zamiast seedować książkę
 * ścieżką ręcznego zakupu, mockujemy /library — deterministyczniej i bez zależności
 * od UI add-purchase (plan dopuszczał oparcie o minimalny stan). Auth: storageState.
 */

const SHELF_A = '00000000-0000-4000-8000-07070707a001';
const SHELF_B = '00000000-0000-4000-8000-07070707a002';
const BOOK_1 = '00000000-0000-4000-8000-07070707b001';

const shelvesBody = {
  data: {
    shelves: [
      {
        id: SHELF_A,
        name: 'Salon',
        location: null,
        position_index: 0,
        is_system: false,
        book_count: 1,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: SHELF_B,
        name: 'Sypialnia',
        location: null,
        position_index: 1,
        is_system: false,
        book_count: 0,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
  },
};

const book1 = {
  id: BOOK_1,
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  cover_url: null,
  published_year: 1961,
  position_index: 1,
  is_read: false,
  shelf_id: SHELF_A,
  shelf_name: 'Salon',
  spine_color: 'niebieski',
};

test.describe('S-07 — move-book golden path (mock)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/shelves', (route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(shelvesBody),
        });
      } else {
        void route.continue();
      }
    });
    await page.route('**/api/books/search**', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [book1], total: 1 } }),
      });
    });
  });

  test('picker przenosi książkę → POST move + optimistic badge na docelową półkę', async ({
    page,
  }) => {
    await page.route(`**/api/books/${BOOK_1}/move`, (route) => {
      if (route.request().method() === 'POST') {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { book_id: BOOK_1, shelf_id: SHELF_B } }),
        });
      } else {
        void route.continue();
      }
    });

    await page.goto('/library');
    await page.waitForResponse(
      (r) => r.url().includes('/api/shelves') && r.request().method() === 'GET',
    );
    await page.getByTestId('search-input').fill('solaris');
    await expect(page.getByTestId(`book-card-${BOOK_1}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`shelf-badge-${BOOK_1}`)).toHaveText('Salon');

    const moveReq = page.waitForRequest(
      (r) => r.url().includes(`/api/books/${BOOK_1}/move`) && r.method() === 'POST',
    );
    await page.getByTestId(`move-book-${BOOK_1}`).selectOption(SHELF_B);
    await page.getByTestId(`move-book-dialog-${BOOK_1}-confirm`).click();
    const req = await moveReq;
    expect(req.postDataJSON()).toEqual({ shelf_id: SHELF_B });

    await expect(page.getByTestId(`shelf-badge-${BOOK_1}`)).toHaveText('Sypialnia');
  });

  test('błąd move (500) → rollback badge do „Salon"', async ({ page }) => {
    await page.route(`**/api/books/${BOOK_1}/move`, (route) => {
      if (route.request().method() === 'POST') {
        void route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }),
        });
      } else {
        void route.continue();
      }
    });

    await page.goto('/library');
    await page.waitForResponse(
      (r) => r.url().includes('/api/shelves') && r.request().method() === 'GET',
    );
    await page.getByTestId('search-input').fill('solaris');
    await expect(page.getByTestId(`shelf-badge-${BOOK_1}`)).toHaveText('Salon', {
      timeout: 10_000,
    });

    await page.getByTestId(`move-book-${BOOK_1}`).selectOption(SHELF_B);
    // Po rollbacku badge wraca do „Salon"
    await expect(page.getByTestId(`shelf-badge-${BOOK_1}`)).toHaveText('Salon');
  });

  test('picker pomija bieżącą półkę (tylko „Sypialnia" jako opcja docelowa)', async ({ page }) => {
    await page.goto('/library');
    await page.waitForResponse(
      (r) => r.url().includes('/api/shelves') && r.request().method() === 'GET',
    );
    await page.getByTestId('search-input').fill('solaris');
    const select = page.getByTestId(`move-book-${BOOK_1}`);
    await expect(select).toBeVisible({ timeout: 10_000 });
    // Opcje: placeholder + Sypialnia (Salon = bieżąca, wykluczona)
    await expect(select.locator('option')).toHaveCount(2);
    await expect(select.locator('option', { hasText: 'Sypialnia' })).toHaveCount(1);
    await expect(select.locator('option', { hasText: 'Salon' })).toHaveCount(0);
  });
});
