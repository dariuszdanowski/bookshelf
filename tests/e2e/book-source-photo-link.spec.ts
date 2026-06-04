import { expect, test } from '@playwright/test';

/**
 * E2E spec dla S-15: link „Źródłowe zdjęcie" na karcie książki.
 *
 * Ryzyka pokryte:
 *  - link prowadzi do właściwego /photos/[photo_id] i nawiguje (golden path, /shelves/[id])
 *  - link nieobecny dla wpisu ręcznego (photo_id=null, /library)
 *  - link znika po usunięciu źródłowego zdjęcia (shelf_entries.photo_id→NULL, S-29 closure)
 *
 * API mockowane przez page.route — zero realnego vision/Storage/DB write.
 * Auth: współdzielona sesja storageState (auth.setup.ts).
 * Real shelf ID pobierany z UI (SSR wymaga istniejącego shelf_id w DB).
 */

const PHOTO_ID = '00000000-0000-4000-8000-151515151515';
const BOOK_ID = '00000000-0000-4000-8000-151515b00001';

function makeBook(photoId: string | null) {
  return {
    id: BOOK_ID,
    title: 'Solaris',
    authors: ['Stanisław Lem'],
    cover_url: null,
    published_year: 1961,
    position_index: 1,
    is_read: false,
    photo_id: photoId,
  };
}

/** Pobiera real shelf ID z /shelves i mockuje endpoint books dla tego ID. */
async function getShelfIdWithBooksMocked(
  page: import('@playwright/test').Page,
  photoId: string | null
): Promise<string> {
  await page.goto('/shelves');
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });
  const shelfLink = page.getByTestId(/^shelf-item-photos-link$/).first();
  const href = await shelfLink.getAttribute('href');
  const shelfId = href!.split('/').pop()!;

  await page.route(`**/api/shelves/${shelfId}/books`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: [makeBook(photoId)] } }),
    })
  );
  await page.route(`**/api/shelves/${shelfId}/photos`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { photos: [] } }) })
  );
  await page.route('**/api/shelves', (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { shelves: [] } }) });
    } else {
      void route.continue();
    }
  });

  return shelfId;
}

test('S-15: link obecny dla książki ze zdjęcia i nawiguje do /photos/[id]', async ({ page }) => {
  const shelfId = await getShelfIdWithBooksMocked(page, PHOTO_ID);

  await page.goto(`/shelves/${shelfId}`);
  const link = page.getByRole('link', { name: /źródłowe zdjęcie/i });
  await expect(link).toBeVisible({ timeout: 10_000 });
  await expect(link).toHaveAttribute('href', `/photos/${PHOTO_ID}`);

  await link.click();
  await page.waitForURL(`**/photos/${PHOTO_ID}`, { timeout: 10_000 });
});

test('S-15: link nieobecny dla wpisu ręcznego (photo_id=null, /library)', async ({ page }) => {
  const bookWithoutPhoto = {
    ...makeBook(null),
    shelf_id: '00000000-0000-4000-8000-151515a00001',
    shelf_name: 'Salon',
    spine_color: null,
  };

  await page.route('**/api/shelves', (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            shelves: [{ id: '00000000-0000-4000-8000-151515a00001', name: 'Salon', location: null, position_index: 0, is_system: false, book_count: 1, created_at: '2026-01-01T00:00:00Z' }],
          },
        }),
      });
    } else {
      void route.continue();
    }
  });
  await page.route('**/api/books/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: [bookWithoutPhoto], total: 1 } }),
    })
  );

  await page.goto('/library');
  await page.waitForResponse((r) => r.url().includes('/api/shelves') && r.request().method() === 'GET');
  await expect(page.getByTestId(`book-card-${BOOK_ID}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`source-photo-link-${BOOK_ID}`)).not.toBeAttached();
});

test('S-15: link znika po usunięciu źródłowego zdjęcia (S-29 closure)', async ({ page }) => {
  const shelfId = await getShelfIdWithBooksMocked(page, PHOTO_ID);

  // Etap 1: photo_id ustawiony → link widoczny
  await page.goto(`/shelves/${shelfId}`);
  await expect(page.getByTestId(`source-photo-link-${BOOK_ID}`)).toBeVisible({ timeout: 10_000 });

  // Etap 2: symulacja kasacji zdjęcia → shelf_entries.photo_id=NULL (ON DELETE SET NULL)
  await page.unroute(`**/api/shelves/${shelfId}/books`);
  await page.route(`**/api/shelves/${shelfId}/books`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: [makeBook(null)] } }),
    })
  );

  await page.reload();
  await expect(page.getByTestId(`book-card-${BOOK_ID}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`source-photo-link-${BOOK_ID}`)).not.toBeAttached();
});
