import { expect, test } from '@playwright/test';

/**
 * E2E spec dla S-29 photos-crud.
 *
 * Phase 2: zakładki „Książki / Zdjęcia" na /shelves/[id] + persystencja wyboru.
 *
 * Auth: współdzielona sesja z auth.setup.ts (storageState). Wszystkie API mockowane
 * przez page.route() — zero realnego vision/Storage.
 */

const PHOTO_ID = '00000000-0000-4000-8000-aaaaaaaaaaaa';

function mockPhotoItem(overrides: Record<string, unknown> = {}) {
  return {
    id: PHOTO_ID,
    status: 'processed',
    stage: 'vision_done',
    created_at: new Date().toISOString(),
    thumbnail_url: null,
    detected_count: 2,
    matched_count: 0,
    confirmed_count: 0,
    latest_vision_run: {
      id: '00000000-0000-4000-8000-bbbbbbbbbbbb',
      model: 'claude-sonnet-4-6',
      created_at: new Date().toISOString(),
      cost_usd: 0.0042,
    },
    has_running_run: false,
    legacy_no_hash: false,
    ...overrides,
  };
}

function mockPhotoList(stage = 'vision_done') {
  return { data: { photos: [mockPhotoItem({ stage })] } };
}

/**
 * Klik zakładki „Zdjęcia" odporny na hydration race (`client:load` SSR-uje
 * przycisk zanim React podepnie handler) — retry-click aż `aria-selected` flip.
 */
async function revealPhotosTab(page: import('@playwright/test').Page) {
  await expect(async () => {
    await page.getByTestId('shelf-tab-photos').click();
    await expect(page.getByTestId('shelf-tab-photos')).toHaveAttribute('aria-selected', 'true', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 10_000 });
}

async function gotoShelfWithMocks(page: import('@playwright/test').Page) {
  await page.goto('/shelves');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });
  const link = page.getByTestId(/^shelf-item-photos-link$/).first();
  const href = await link.getAttribute('href');
  const shelfId = href!.split('/').pop()!;

  await page.route(`**/api/shelves/${shelfId}/photos`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockPhotoList()) })
  );
  await page.route(`**/api/shelves/${shelfId}/books`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { books: [] } }) })
  );
  await page.route('**/api/shelves', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { shelves: [] } }) })
  );

  await page.goto(`/shelves/${shelfId}`);
  return shelfId;
}

test('S-29 P2: domyślnie aktywna zakładka „Książki"', async ({ page }) => {
  await gotoShelfWithMocks(page);
  await expect(page.getByTestId('shelf-tab-books')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  await expect(page.getByTestId('shelf-tab-panel-photos')).toHaveClass(/hidden/);
});

test('S-29 P2: klik „Zdjęcia" pokazuje listę zdjęć', async ({ page }) => {
  await gotoShelfWithMocks(page);
  await revealPhotosTab(page);
  await expect(page.getByTestId('photo-list')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`photo-item-${PHOTO_ID}`)).toBeVisible();
});

test('S-29 P2: wybór zakładki przeżywa reload (persystencja localStorage)', async ({ page }) => {
  await gotoShelfWithMocks(page);
  await revealPhotosTab(page);
  await expect(page.getByTestId('photo-list')).toBeVisible({ timeout: 10_000 });

  await page.reload();

  // Po reloadzie zakładka „Zdjęcia" nadal aktywna (odczyt z localStorage po mount).
  await expect(page.getByTestId('shelf-tab-photos')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  await expect(page.getByTestId('photo-list')).toBeVisible({ timeout: 10_000 });
});

test('S-29 P3: usunięcie zdjęcia — modal potwierdzenia → DELETE → wiersz znika', async ({ page }) => {
  await page.goto('/shelves');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });
  const href = await page.getByTestId(/^shelf-item-photos-link$/).first().getAttribute('href');
  const shelfId = href!.split('/').pop()!;

  await page.route(`**/api/shelves/${shelfId}/photos`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockPhotoList()) })
  );
  await page.route(`**/api/shelves/${shelfId}/books`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { books: [] } }) })
  );
  await page.route('**/api/shelves', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { shelves: [] } }) })
  );
  let deleteCalled = false;
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() === 'DELETE') {
      deleteCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { deleted: true } }) });
    }
    return route.continue();
  });

  await page.goto(`/shelves/${shelfId}`);
  await revealPhotosTab(page);
  await expect(page.getByTestId(`photo-item-${PHOTO_ID}`)).toBeVisible({ timeout: 10_000 });

  await page.getByTestId(`delete-photo-${PHOTO_ID}`).click();
  await expect(page.getByTestId('photo-delete-confirm')).toBeVisible();
  await page.getByTestId('photo-delete-confirm-confirm').click();

  await expect(page.getByTestId(`photo-item-${PHOTO_ID}`)).toHaveCount(0, { timeout: 10_000 });
  expect(deleteCalled).toBe(true);
});

test('S-29 P3: badge „Bez hash" widoczny dla zdjęcia z legacy_no_hash', async ({ page }) => {
  await page.goto('/shelves');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });
  const href = await page.getByTestId(/^shelf-item-photos-link$/).first().getAttribute('href');
  const shelfId = href!.split('/').pop()!;

  await page.route(`**/api/shelves/${shelfId}/photos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { photos: [mockPhotoItem({ legacy_no_hash: true })] } }),
    })
  );
  await page.route(`**/api/shelves/${shelfId}/books`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { books: [] } }) })
  );
  await page.route('**/api/shelves', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { shelves: [] } }) })
  );

  await page.goto(`/shelves/${shelfId}`);
  await revealPhotosTab(page);
  await expect(page.getByTestId(`legacy-hash-badge-${PHOTO_ID}`)).toBeVisible({ timeout: 10_000 });
});
