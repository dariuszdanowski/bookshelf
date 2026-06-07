import { expect, test } from '@playwright/test';

/**
 * E2E dla Pakietu B2 (media, M15+M16):
 *
 *  - M15a: upload wysyła do Storage DWA obiekty — oryginał + miniaturę
 *    `<path>.thumb.jpg` (canvas browser-side; best-effort, ale w chromium
 *    na realnym JPEG zawsze się udaje)
 *  - M15b: lista zdjęć renderuje <img loading="lazy">
 *  - M16: desktop (sm+) pokazuje podgląd bez kadrowania (object-contain),
 *    mobile zostaje przy object-cover pełnej szerokości (S-28)
 *
 * Storage + API mockowane przez page.route — zero realnego bucketa/vision.
 * Strona /shelves/[id] jest SSR — wymaga REALNEJ półki (wzorzec photos-crud):
 * bierzemy istniejącą półkę usera z /shelves i mockujemy tylko browser-fetch.
 */

const PHOTO_ID = '00000000-0000-4000-8000-181818181818';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('M15a: upload wgrywa oryginał + miniaturę .thumb.jpg do Storage', async ({ page }) => {
  await page.goto('/upload');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('photo-uploader')).toBeVisible();
  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 10_000 });

  // Zarejestruj KAŻDY storage upload (oryginał + thumb)
  const storageUploads: string[] = [];
  await page.route('**/storage/v1/object/shelf-photos/**', (route) => {
    storageUploads.push(route.request().url());
    void route.fulfill({ status: 200, body: JSON.stringify({ Key: 'shelf-photos/mock.jpg' }) });
  });

  let recordedShelfId = '';
  await page.route('**/api/photos', (route) => {
    if (route.request().method() === 'POST') {
      recordedShelfId = (route.request().postDataJSON() as { shelf_id: string }).shelf_id;
      void route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            photo: {
              id: PHOTO_ID,
              shelf_id: recordedShelfId,
              status: 'uploaded',
              detected_count: null,
              error_message: null,
              vision_cost_usd: null,
              vision_latency_ms: null,
              created_at: '2026-06-07T10:00:00Z',
            },
          },
        }),
      });
    } else {
      void route.continue();
    }
  });

  // S-36: wyłącz auto-process — flow kończy się na redirect do tabu Zdjęcia,
  // bez mocków process/match (nie są przedmiotem tego testu)
  const autoProcess = page.getByTestId('auto-process-checkbox');
  if (await autoProcess.isChecked()) await autoProcess.uncheck();

  // test-shelf.jpg (1×1 grayscale, 1-komponentowy) NIE dekoduje się przez
  // createImageBitmap w chromium (InvalidStateError) — używamy zwykłego RGB
  // JPEG, bo to ścieżka happy-path miniatury; null-fallback pokrywa unit.
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/test-shelf-rgb.jpg');

  await page.waitForURL('**/shelves/*?tab=photos', { timeout: 15_000 });

  // Dwa uploady: najpierw oryginał, potem miniatura z suffixem .thumb.jpg
  expect(storageUploads).toHaveLength(2);
  expect(storageUploads[0]).not.toContain('.thumb.jpg');
  expect(storageUploads[1]).toContain('.thumb.jpg');
});

function mockPhotoList() {
  return {
    data: {
      photos: [
        {
          id: PHOTO_ID,
          status: 'processed',
          stage: 'vision_done',
          created_at: '2026-06-07T10:00:00Z',
          thumbnail_url: '/mock-storage/thumb-18.jpg',
          detected_count: 3,
          matched_count: 0,
          confirmed_count: 0,
          latest_vision_run: {
            id: '00000000-0000-4000-8000-181818180001',
            model: 'claude-sonnet-4-6',
            created_at: '2026-06-07T10:01:00Z',
            cost_usd: 0.004,
          },
          has_running_run: false,
          legacy_no_hash: false,
        },
      ],
    },
  };
}

/** Wzorzec photos-crud: realna półka usera (SSR), mock browser-fetchy. */
async function gotoPhotosTabWithMocks(page: import('@playwright/test').Page) {
  await page.goto('/shelves');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });
  const link = page.getByTestId(/^shelf-item-photos-link$/).first();
  const href = await link.getAttribute('href');
  const shelfId = href!.split('/').pop()!.split('?')[0];

  await page.route(`**/mock-storage/thumb-18.jpg`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
  );
  await page.route(`**/api/shelves/${shelfId}/photos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockPhotoList()),
    }),
  );
  await page.route(`**/api/shelves/${shelfId}/books`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: [] } }),
    }),
  );
  await page.route('**/api/shelves', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { shelves: [] } }),
    }),
  );

  await page.goto(`/shelves/${shelfId}?tab=photos`);
}

test('M15b+M16: desktop — lazy loading i podgląd bez kadrowania (object-contain)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoPhotosTabWithMocks(page);

  const img = page.locator(`[data-testid="photo-thumb-link-${PHOTO_ID}"] img`);
  await expect(img).toBeVisible({ timeout: 10_000 });

  await expect(img).toHaveAttribute('loading', 'lazy');
  expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
});

test('M16: mobile — pełna szerokość z object-cover (bez regresu S-28)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoPhotosTabWithMocks(page);

  const img = page.locator(`[data-testid="photo-thumb-link-${PHOTO_ID}"] img`);
  await expect(img).toBeVisible({ timeout: 10_000 });

  expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe('cover');
});
