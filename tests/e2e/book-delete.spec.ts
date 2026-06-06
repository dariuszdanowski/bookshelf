import { expect, test, type Page } from '@playwright/test';

/**
 * E2E — book-delete: usunięcie książki z katalogu (CRUD „D").
 * Ryzyko: brak DELETE w CRUD książek (user nie mógł usunąć). Test weryfikuje
 * przycisk „Usuń" w BookCard → ConfirmDialog → DELETE /api/books/[id] →
 * książka znika z listy (optimistic). Pokrywa półkę i katalog.
 *
 * API mockowane przez page.route — zero realnego DB write.
 * Auth: współdzielona sesja storageState.
 */

const BOOK_ID = '00000000-0000-4000-8000-370000000050';

const MOCK_BOOK = {
  id: BOOK_ID,
  title: 'Książka do usunięcia',
  authors: ['Autor Testowy'],
  cover_url: null,
  user_cover_url: null,
  cover_photo_url: null,
  cover_source: 'auto',
  published_year: 2020,
  publisher: 'Wyd. Test',
  isbn_13: '9780000000001',
  isbn_10: null,
  position_index: 1,
  is_read: false,
  photo_id: null,
};

async function getRealShelfId(page: Page): Promise<string> {
  await page.goto('/shelves');
  const link = page.locator('a[href^="/shelves/"]').first();
  await expect(link).toBeVisible({ timeout: 10000 });
  const href = (await link.getAttribute('href')) ?? '';
  return href.split('/shelves/')[1] ?? '';
}

test.describe('book-delete — usunięcie z półki', () => {
  test('przycisk Usuń → potwierdzenie → DELETE → karta znika', async ({ page }) => {
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [MOCK_BOOK] } }),
      });
    });

    let deleteCalled = false;
    await page.route(`**/api/books/${BOOK_ID}`, (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { deleted: true } }),
        });
      } else {
        void route.continue();
      }
    });

    const shelfId = await getRealShelfId(page);
    await page.goto(`/shelves/${shelfId}`);
    await expect(page.getByTestId('shelf-books-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId(`book-card-${BOOK_ID}`)).toBeVisible();

    // Klik „Usuń" otwiera dialog (nie usuwa od razu)
    await page.getByTestId(`delete-book-${BOOK_ID}`).click();
    await expect(page.getByTestId(`delete-book-dialog-${BOOK_ID}`)).toBeVisible();

    // Potwierdzenie → DELETE + karta znika
    await page.getByTestId(`delete-book-dialog-${BOOK_ID}-confirm`).click();
    await expect(page.getByTestId(`book-card-${BOOK_ID}`)).not.toBeVisible();
    expect(deleteCalled).toBe(true);
  });

  test('anulowanie potwierdzenia NIE usuwa książki', async ({ page }) => {
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [MOCK_BOOK] } }),
      });
    });

    let deleteCalled = false;
    await page.route(`**/api/books/${BOOK_ID}`, (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { deleted: true } }) });
      } else {
        void route.continue();
      }
    });

    const shelfId = await getRealShelfId(page);
    await page.goto(`/shelves/${shelfId}`);
    await expect(page.getByTestId(`book-card-${BOOK_ID}`)).toBeVisible({ timeout: 10000 });

    await page.getByTestId(`delete-book-${BOOK_ID}`).click();
    await page.getByTestId(`delete-book-dialog-${BOOK_ID}-cancel`).click();

    await expect(page.getByTestId(`delete-book-dialog-${BOOK_ID}`)).not.toBeVisible();
    await expect(page.getByTestId(`book-card-${BOOK_ID}`)).toBeVisible();
    expect(deleteCalled).toBe(false);
  });
});
