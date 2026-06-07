import { expect, test } from '@playwright/test';

/**
 * E2E spec dla S-24: lightbox zdjęcia w review.
 *
 * ⚠ M23 (2026-06-07): trigger lightboxa WYŁĄCZONY na życzenie usera
 * ("wyłącz, nie kasuj") — zoom/pan + pinch na miejscu wystarczają. Spec
 * w całości test.skip; mechanizm (PhotoLightbox + testy unit) zostaje
 * w repo. Przywrócenie = re-import w PhotoDetectionOverlay + zdjęcie skipa.
 *
 * Ryzyka pokryte (gdy aktywny):
 *  - klik w zdjęcie otwiera pełnoekranowy lightbox z numerowanymi ramkami
 *  - Esc zamyka lightbox (powrót do review bez przeładowania)
 *  - w trybie edycji ramek klik w obraz NIE otwiera lightboxa (kolizja intencji
 *    z rysowaniem bbox)
 *
 * API mockowane przez page.route — zero realnego vision/Storage/DB write.
 */

test.skip(
  true,
  'M23: trigger lightboxa wyłączony na życzenie usera (2026-06-07) — mechanizm zachowany w repo',
);

const PHOTO_ID = '00000000-0000-4000-8000-242424242424';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PHOTO_URL_PATH = '/mock-storage/shelf-242424.png';

function makeDetection(position: number, x1: number) {
  return {
    id: `00000000-0000-4000-8000-242424d0000${position}`,
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
          detections: [makeDetection(1, 0.1), makeDetection(2, 0.3)],
          vision_run: null,
        },
      }),
    }),
  );
}

test('S-24: klik w zdjęcie otwiera lightbox z ramkami; Esc zamyka', async ({ page }) => {
  await mockReviewApi(page);
  await page.goto(`/photos/${PHOTO_ID}`);

  const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
  await expect(img).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('photo-lightbox')).not.toBeAttached();

  await img.click();
  await expect(page.getByTestId('photo-lightbox')).toBeVisible();
  await expect(page.getByTestId('lightbox-marker-1')).toBeVisible();
  await expect(page.getByTestId('lightbox-marker-2')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('photo-lightbox')).not.toBeAttached();
  // review nadal działa — lista detekcji na miejscu (bez przeładowania)
  await expect(page.getByTestId('detection-review')).toBeVisible();
});

test('S-24: przycisk ✕ i klik tła zamykają lightbox', async ({ page }) => {
  await mockReviewApi(page);
  await page.goto(`/photos/${PHOTO_ID}`);

  const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
  await expect(img).toBeVisible({ timeout: 10_000 });

  await img.click();
  await expect(page.getByTestId('photo-lightbox')).toBeVisible();
  await page.getByTestId('photo-lightbox-close').click();
  await expect(page.getByTestId('photo-lightbox')).not.toBeAttached();

  await img.click();
  await expect(page.getByTestId('photo-lightbox')).toBeVisible();
  // klik w tło (backdrop) — punkt z dala od wycentrowanego obrazu 1px
  await page.getByTestId('photo-lightbox').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('photo-lightbox')).not.toBeAttached();
});

test('S-24: w trybie edycji ramek klik w obraz NIE otwiera lightboxa', async ({ page }) => {
  await mockReviewApi(page);
  await page.goto(`/photos/${PHOTO_ID}`);

  const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
  await expect(img).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('edit-bboxes-button').click();
  await expect(page.getByTestId('apply-bbox-edits-button')).toBeVisible();

  await img.click({ force: true }); // w edit mode klik rysuje draft, nie otwiera modala
  await expect(page.getByTestId('photo-lightbox')).not.toBeAttached();
});
