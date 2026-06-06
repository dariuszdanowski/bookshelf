import { expect, test } from '@playwright/test';

/**
 * E2E spec dla S-37: deep-link książka → review z fokusem na jej detekcji.
 *
 * Ryzyka pokryte:
 *  - link „Źródłowe zdjęcie" niesie ?detection=<id> gdy detection_id znane
 *  - wejście z parametrem fokusuje ramkę tej detekcji (overlay w trybie fokus,
 *    1 marker zamiast wszystkich) — golden path z karty książki
 *  - nieznane detection id → graceful: pełny widok, wszystkie markery, bez trybu fokus
 *
 * API mockowane przez page.route — zero realnego vision/Storage/DB write.
 * Auth: współdzielona sesja storageState (auth.setup.ts).
 */

const PHOTO_ID = '00000000-0000-4000-8000-373737373737';
const BOOK_ID = '00000000-0000-4000-8000-373737b00001';
const DET_FOCUS = '00000000-0000-4000-8000-373737d00001';
const DET_OTHER = '00000000-0000-4000-8000-373737d00002';
const UNKNOWN_DET = '00000000-0000-4000-8000-373737dead00';

// 1x1 px PNG — żeby <img> w overlay odpalił onLoad i wyrenderował markery
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PHOTO_URL_PATH = '/mock-storage/shelf-373737.png';

function makeBook() {
  return {
    id: BOOK_ID,
    title: 'Solaris',
    authors: ['Stanisław Lem'],
    cover_url: null,
    published_year: 1961,
    position_index: 1,
    is_read: false,
    photo_id: PHOTO_ID,
    detection_id: DET_FOCUS,
  };
}

function makeDetection(id: string, position: number, x1: number) {
  return {
    id,
    position_index: position,
    raw_title: `Książka ${position}`,
    raw_author: null,
    vision_confidence: 0.9,
    spine_color: null,
    bbox: { x1, y1: 0.05, x2: x1 + 0.1, y2: 0.95 },
    status: 'matched',
    candidates: [],
    duplicate: null,
  };
}

/** Mock GET /api/photos/[id] + obrazek Storage; zwraca 2 detekcje z bbox. */
async function mockReviewApi(page: import('@playwright/test').Page) {
  await page.route(`**${PHOTO_URL_PATH}`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
  );
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          photo: {
            id: PHOTO_ID,
            shelf_id: null,
            status: 'processed',
            detected_count: 2,
            error_message: null,
            vision_cost_usd: null,
            vision_latency_ms: null,
            created_at: '2026-06-01T00:00:00Z',
          },
          photo_url: PHOTO_URL_PATH,
          detections: [makeDetection(DET_FOCUS, 1, 0.1), makeDetection(DET_OTHER, 2, 0.3)],
          vision_run: null,
        },
      }),
    }),
  );
}

/** Pobiera real shelf ID z /shelves i mockuje endpoint books dla tego ID. */
async function getShelfIdWithBooksMocked(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/shelves');
  await page.waitForSelector('[data-testid^="shelf-item-"]', { timeout: 10_000 });
  const shelfLink = page.getByTestId(/^shelf-item-photos-link$/).first();
  const href = await shelfLink.getAttribute('href');
  const shelfId = href!.split('/').pop()!;

  await page.route(`**/api/shelves/${shelfId}/books`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: [makeBook()] } }),
    }),
  );
  await page.route(`**/api/shelves/${shelfId}/photos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { photos: [] } }),
    }),
  );

  return shelfId;
}

test('S-37: golden path — link z ?detection= prowadzi do review z fokusem na ramce', async ({
  page,
}) => {
  const shelfId = await getShelfIdWithBooksMocked(page);
  await mockReviewApi(page);

  await page.goto(`/shelves/${shelfId}`);
  const link = page.getByTestId(`source-photo-link-${BOOK_ID}`);
  await expect(link).toBeVisible({ timeout: 10_000 });
  await expect(link).toHaveAttribute('href', `/photos/${PHOTO_ID}?detection=${DET_FOCUS}`);

  await link.click();
  await page.waitForURL(`**/photos/${PHOTO_ID}?detection=${DET_FOCUS}`, { timeout: 10_000 });

  // Tryb fokus: przycisk „Pokaż wszystkie detekcje" obecny, overlay renderuje
  // wyłącznie marker fokusowanej detekcji (#1), marker #2 nieobecny.
  await expect(page.getByTestId('clear-focus-button')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('bbox-marker-1')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('bbox-marker-2')).not.toBeAttached();

  // Wiersz listy fokusowanej detekcji w viewport (scroll zadziałał)
  await expect(page.getByTestId('detection-card-1')).toBeInViewport();

  // Wyjście z fokusu przywraca wszystkie markery
  await page.getByTestId('clear-focus-button').click();
  await expect(page.getByTestId('bbox-marker-2')).toBeVisible({ timeout: 10_000 });
});

test('S-37: nieznane detection id → pełny widok bez trybu fokus (graceful)', async ({ page }) => {
  await mockReviewApi(page);

  await page.goto(`/photos/${PHOTO_ID}?detection=${UNKNOWN_DET}`);

  // Business outcome: wszystkie markery widoczne, brak trybu fokus
  await expect(page.getByTestId('bbox-marker-1')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('bbox-marker-2')).toBeVisible();
  await expect(page.getByTestId('clear-focus-button')).not.toBeAttached();
});

test('S-37: zniekształcony parametr detection → strona renderuje się normalnie', async ({
  page,
}) => {
  await mockReviewApi(page);

  await page.goto(`/photos/${PHOTO_ID}?detection=not-a-uuid`);

  await expect(page.getByTestId('detection-review')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('clear-focus-button')).not.toBeAttached();
});
