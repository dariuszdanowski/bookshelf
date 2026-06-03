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

function mockPhotoList(stage = 'vision_done') {
  return {
    data: {
      photos: [
        {
          id: PHOTO_ID,
          status: 'processed',
          stage,
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
        },
      ],
    },
  };
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
