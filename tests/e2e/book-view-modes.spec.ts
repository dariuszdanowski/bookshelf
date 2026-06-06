import { expect, test, type Page } from '@playwright/test';

/**
 * E2E — S-34: tryby widoku książek (Karty / Lista / Kafelki) na /shelves/[id] i /library.
 * Ryzyko: prezentacja list książek w wielu układach + pełny CRUD musi działać w KAŻDYM
 * układzie (nie tylko kartach), preferencja przeżywa reload. Test weryfikuje przełącznik,
 * kontenery układów (book-row / book-tile), persystencję localStorage i delete w trybie Lista.
 *
 * API mockowane przez page.route — zero realnego DB write. Auth: storageState.
 */

const BOOK_ID = '00000000-0000-4000-8000-340000000050';

const MOCK_BOOK = {
  id: BOOK_ID,
  title: 'Książka widokowa',
  authors: ['Autor V'],
  cover_url: null,
  user_cover_url: null,
  cover_photo_url: null,
  cover_source: 'auto',
  published_year: 2019,
  publisher: 'Wyd. V',
  isbn_13: '9780000000034',
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

test.describe('S-34 tryby widoku — /shelves/[id]', () => {
  test('przełączanie Karty→Lista→Kafelki zmienia układ + persystencja po reload', async ({ page }) => {
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { books: [MOCK_BOOK] } }) });
    });

    const shelfId = await getRealShelfId(page);
    await page.goto(`/shelves/${shelfId}`);
    await expect(page.getByTestId('shelf-books-grid')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('view-mode-switcher')).toBeVisible();

    // Domyślnie cards (desktop): brak book-row / book-tile
    await expect(page.getByTestId(`book-row-${BOOK_ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`book-tile-${BOOK_ID}`)).toHaveCount(0);

    // Lista
    await page.getByTestId('view-mode-list').click();
    await expect(page.getByTestId(`book-row-${BOOK_ID}`)).toBeVisible();

    // Kafelki
    await page.getByTestId('view-mode-tiles').click();
    await expect(page.getByTestId(`book-tile-${BOOK_ID}`)).toBeVisible();
    await expect(page.getByTestId(`book-row-${BOOK_ID}`)).toHaveCount(0);

    // Lista ponownie + reload → preferencja zachowana (localStorage)
    await page.getByTestId('view-mode-list').click();
    await page.reload();
    await expect(page.getByTestId(`book-row-${BOOK_ID}`)).toBeVisible({ timeout: 10000 });
  });

  test('delete działa w trybie Lista (pełny CRUD poza kartami)', async ({ page }) => {
    await page.route('**/api/shelves/*/books', (route) => {
      void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { books: [MOCK_BOOK] } }) });
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
    await expect(page.getByTestId('view-mode-switcher')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('view-mode-list').click();
    await expect(page.getByTestId(`book-row-${BOOK_ID}`)).toBeVisible();

    await page.getByTestId(`delete-book-${BOOK_ID}`).click();
    await page.getByTestId(`delete-book-dialog-${BOOK_ID}-confirm`).click();
    await expect(page.getByTestId(`book-card-${BOOK_ID}`)).not.toBeVisible();
    expect(deleteCalled).toBe(true);
  });
});

test.describe('S-34 tryby widoku — /library', () => {
  test('po wyszukaniu pojawia się przełącznik; Lista pokazuje book-row', async ({ page }) => {
    await page.route('**/api/shelves', (route) => {
      void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { shelves: [] } }) });
    });
    await page.route('**/api/books/search*', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { books: [{ ...MOCK_BOOK, shelf_id: 'sh-x', shelf_name: 'Salon', spine_color: null }], total: 1 } }),
      });
    });

    await page.goto('/library');
    await page.getByTestId('search-input').fill('widok');
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('view-mode-switcher')).toBeVisible();

    await page.getByTestId('view-mode-list').click();
    await expect(page.getByTestId(`book-row-${BOOK_ID}`)).toBeVisible();
  });
});
