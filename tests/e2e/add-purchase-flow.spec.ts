import { expect, test } from '@playwright/test';

/**
 * Golden path E2E dla S-06 (Flow B — „Dodaj zakup"):
 *   header „Dodaj zakup" → /purchase → ręczny formularz (title+author+data)
 *   → POST /api/books → redirect na „Zakupione" → książka widoczna w gridzie.
 *   Plus: toggle metody „zdjęcie" pokazuje link do /upload?shelf=<Zakupione>.
 *
 * API mockowane przez page.route (zero realnego DB write). Auth: współdzielona
 * sesja storageState. Realny shelf_id „Zakupione" pobierany z UI (SSR strona
 * /shelves/[id] musi dostać istniejący id, inaczej redirect na /shelves).
 */

const BOOK_ID = '00000000-0000-4000-8000-06060606b001';

test.describe('S-06 — add-purchase-flow golden path (mock)', () => {
  let purchasedShelfId = '';

  test.beforeEach(async ({ page }) => {
    // Pobierz realny id „Zakupione" (pierwsza półka na liście — sortowana first)
    await page.goto('/shelves');
    const shelfLink = page.locator('a[href^="/shelves/"]').first();
    const href = await shelfLink.getAttribute('href');
    purchasedShelfId = href?.split('/shelves/')[1] ?? '';

    // Mock /api/shelves — island czyta is_system dla linku zdjęcia
    await page.route('**/api/shelves', (route) => {
      if (route.request().method() === 'GET') {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              shelves: [
                { id: purchasedShelfId, name: 'Zakupione', location: null, position_index: 0, is_system: true, book_count: 0, created_at: '2026-01-01T00:00:00Z' },
              ],
            },
          }),
        });
      } else {
        void route.continue();
      }
    });

    // Mock POST /api/books → 201 z realnym shelf_id (żeby redirect trafił na istniejącą półkę)
    await page.route('**/api/books', (route) => {
      if (route.request().method() === 'POST') {
        void route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: { book_id: BOOK_ID, shelf_id: purchasedShelfId } }),
        });
      } else {
        void route.continue();
      }
    });

    // Mock książek na „Zakupione" po redirekcie
    await page.route(`**/api/shelves/${purchasedShelfId}/books`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            books: [
              { id: BOOK_ID, title: 'Wiedźmin', authors: ['Andrzej Sapkowski'], cover_url: null, published_year: null, position_index: 1, is_read: false },
            ],
          },
        }),
      });
    });
  });

  test('header „Dodaj zakup" prowadzi na /purchase z formularzem', async ({ page }) => {
    await page.goto('/shelves');
    await page.getByTestId('nav-add-purchase').click();
    await page.waitForURL('/purchase');
    await expect(page.getByTestId('add-purchase')).toBeVisible();
    await expect(page.getByTestId('manual-form')).toBeVisible();
  });

  test('toggle „zdjęcie" pokazuje link do upload z shelf=Zakupione', async ({ page }) => {
    await page.goto('/purchase');
    // Czekaj na mount-fetch wyspy (sygnał hydracji) zanim klikniemy
    await page.waitForResponse((r) => r.url().includes('/api/shelves') && r.request().method() === 'GET');
    await page.getByTestId('method-photo').click();
    const link = page.getByTestId('photo-upload-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/upload?shelf=${purchasedShelfId}`);
  });

  test('ręczny zakup → POST /api/books → redirect na Zakupione → książka widoczna', async ({ page }) => {
    await page.goto('/purchase');
    // Czekaj na hydrację wyspy (mount-fetch) — inaczej fill trafia w SSR-input przed React
    await page.waitForResponse((r) => r.url().includes('/api/shelves') && r.request().method() === 'GET');
    await page.getByTestId('purchase-title').fill('Wiedźmin');
    await page.getByTestId('purchase-author').fill('Andrzej Sapkowski');
    // Sanity: wartość przyjęta przez kontrolowany input (potwierdza hydrację)
    await expect(page.getByTestId('purchase-title')).toHaveValue('Wiedźmin');
    await page.getByTestId('purchase-submit').click();

    // redirect na /shelves/<Zakupione>
    await page.waitForURL(`/shelves/${purchasedShelfId}`, { timeout: 10_000 });
    // ShelfBooksIsland renderuje mock-książkę
    await expect(page.getByTestId('shelf-books-grid')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`book-card-${BOOK_ID}`)).toBeVisible();
  });

  test('submit zablokowany przy pustym tytule', async ({ page }) => {
    await page.goto('/purchase');
    await expect(page.getByTestId('purchase-submit')).toBeDisabled();
  });
});
