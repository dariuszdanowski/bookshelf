import { expect, test } from '@playwright/test';

/**
 * Golden path E2E dla S-08 (wyszukiwarka katalogu):
 *   header „Biblioteka" → /library → wpisanie frazy → wyniki z nazwą półki+kolorem;
 *   filtr koloru zawęża; brak wyników → „Nie masz tej książki"; toggle read.
 *
 * API mockowane przez page.route. Auth: storageState. Wait na mount-fetch
 * /api/shelves jako gate hydracji wyspy (lekcja S-06).
 */

const SHELF_A = '00000000-0000-4000-8000-08080808a001';
const BOOK_1 = '00000000-0000-4000-8000-08080808b001';

const shelvesBody = {
  data: { shelves: [{ id: SHELF_A, name: 'Salon', location: null, position_index: 0, is_system: false, book_count: 1, created_at: '2026-01-01T00:00:00Z' }] },
};

const book1 = {
  id: BOOK_1, title: 'Solaris', authors: ['Stanisław Lem'], cover_url: null, published_year: 1961,
  position_index: 1, is_read: false, shelf_id: SHELF_A, shelf_name: 'Salon', spine_color: 'niebieski',
};

test.describe('S-08 — catalog-search golden path (mock)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/shelves', (route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shelvesBody) });
      } else {
        void route.continue();
      }
    });
    // Domyślnie: search zwraca 1 książkę (override w teście empty)
    await page.route('**/api/books/search**', (route) => {
      void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { books: [book1], total: 1 } }) });
    });
    await page.route(`**/api/books/${BOOK_1}`, (route) => {
      if (route.request().method() === 'PATCH') {
        void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: BOOK_1, is_read: true } }) });
      } else {
        void route.continue();
      }
    });
  });

  test('header „Biblioteka" prowadzi na /library z wyszukiwarką', async ({ page }) => {
    await page.goto('/shelves');
    await page.getByTestId('nav-library').click();
    await page.waitForURL('/library');
    await expect(page.getByTestId('catalog-search')).toBeVisible();
    await expect(page.getByTestId('search-input')).toBeVisible();
  });

  test('wpisanie frazy → wyniki z nazwą półki i swatch koloru', async ({ page }) => {
    await page.goto('/library');
    await page.waitForResponse((r) => r.url().includes('/api/shelves') && r.request().method() === 'GET');
    await page.getByTestId('search-input').fill('solaris');
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`book-card-${BOOK_1}`)).toBeVisible();
    await expect(page.getByTestId(`shelf-badge-${BOOK_1}`)).toHaveText('Salon');
    await expect(page.getByTestId(`spine-swatch-${BOOK_1}`)).toBeVisible();
  });

  test('filtr koloru wysyła zapytanie z color i pokazuje wyniki', async ({ page }) => {
    await page.goto('/library');
    await page.waitForResponse((r) => r.url().includes('/api/shelves') && r.request().method() === 'GET');
    const searchReq = page.waitForRequest((r) => r.url().includes('/api/books/search') && r.url().includes('color=czerwony'));
    await page.getByTestId('filter-color').selectOption('czerwony');
    await searchReq;
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 10_000 });
  });

  test('brak wyników → „Nie masz tej książki"', async ({ page }) => {
    // override: search zwraca pustą listę
    await page.route('**/api/books/search**', (route) => {
      void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { books: [], total: 0 } }) });
    });
    await page.goto('/library');
    await page.waitForResponse((r) => r.url().includes('/api/shelves') && r.request().method() === 'GET');
    await page.getByTestId('search-input').fill('czegoś-nie-ma');
    await expect(page.getByTestId('search-empty')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('search-empty')).toContainText('Nie masz tej książki');
  });

  test('toggle read na wyniku → PATCH + optimistic flip', async ({ page }) => {
    await page.goto('/library');
    await page.waitForResponse((r) => r.url().includes('/api/shelves') && r.request().method() === 'GET');
    await page.getByTestId('search-input').fill('solaris');
    const toggle = page.getByTestId(`toggle-read-${BOOK_1}`);
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});
