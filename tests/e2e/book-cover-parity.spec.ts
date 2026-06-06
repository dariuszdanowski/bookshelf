import { expect, test, type Page } from '@playwright/test';

/**
 * E2E — unify-add-cover: parzystość edytora okładki add vs edit.
 * Ryzyko: dodawanie książki miało uboższy edytor okładki niż edycja. Test weryfikuje,
 * że tryb add renderuje ten sam CoverEditor (3 sloty + flaga źródła) i że wybór
 * źródła „URL" + wklejony URL trafia do POST jako user_cover_url + cover_source.
 *
 * API mockowane przez page.route — zero realnego DB write. Auth: storageState.
 */

const BOOK_ID = '00000000-0000-4000-8000-380000000050';

async function getRealShelfId(page: Page): Promise<string> {
  await page.goto('/shelves');
  const link = page.locator('a[href^="/shelves/"]').first();
  await expect(link).toBeVisible({ timeout: 10000 });
  const href = (await link.getAttribute('href')) ?? '';
  return href.split('/shelves/')[1] ?? '';
}

test('add: CoverEditor 3-slot + URL/źródło → POST user_cover_url + cover_source', async ({ page }) => {
  await page.route('**/api/shelves/*/books', (route) => {
    void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { books: [] } }) });
  });

  let postBody: Record<string, unknown> | null = null;
  await page.route('**/api/books', (route) => {
    if (route.request().method() === 'POST') {
      postBody = route.request().postDataJSON() as Record<string, unknown>;
      void route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { book_id: BOOK_ID, shelf_id: 'sh' } }) });
    } else {
      void route.continue();
    }
  });

  const shelfId = await getRealShelfId(page);
  await page.goto(`/shelves/${shelfId}`);
  await page.getByTestId('add-book-button').click();
  await expect(page.getByTestId('book-modal')).toBeVisible();

  // Parzystość: ten sam edytor 3-slotowy co w edit
  await expect(page.getByTestId('add-cover-section')).toBeVisible();
  await expect(page.getByTestId('add-cover-source-auto')).toBeVisible();
  await expect(page.getByTestId('add-cover-source-url')).toBeVisible();
  await expect(page.getByTestId('add-cover-source-photo')).toBeVisible();

  await page.getByTestId('book-field-title').fill('Książka z okładką');
  await page.getByTestId('add-cover-url-input').fill('https://example.com/moja.jpg');
  await page.getByTestId('add-cover-source-url').click();
  await page.getByTestId('book-modal-save').click();

  await expect(page.getByTestId('book-modal')).not.toBeVisible();
  expect(postBody).not.toBeNull();
  expect(postBody!.user_cover_url).toBe('https://example.com/moja.jpg');
  expect(postBody!.cover_source).toBe('url');
});
