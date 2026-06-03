import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// force-refine — przycisk refine dla uncertain_localization bbox
//
// Ryzyko: przycisk refine był disabled dla bbox o złej jakości (poziomy, mały).
// Po zmianie: zawsze klikalny. Spójny label „Doprecyzuj odczyt" (S-35); słaby
// crop sygnalizowany ⚠ prefixem (rozróżnialność po tekście, nie po kolorze).
// Scenariusze: dobre bbox → „Doprecyzuj odczyt"; złe → „⚠ Doprecyzuj odczyt".
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-000000000ee1';
const SHELF_ID = '00000000-0000-4000-8000-000000000ee2';
const DET_GOOD_ID = '00000000-0000-4000-8000-000000000g01'; // dobre bbox (pionowe)
const DET_WEAK_ID = '00000000-0000-4000-8000-000000000g02'; // słabe bbox (poziome)
const DET_NONE_ID = '00000000-0000-4000-8000-000000000g03'; // brak bbox

const TINY_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function makeDetection(id: string, idx: number, bbox: { x1: number; y1: number; x2: number; y2: number } | null) {
  return {
    id,
    position_index: idx,
    raw_title: `Książka ${idx}`,
    raw_author: null,
    vision_confidence: 0.8,
    spine_color: null,
    bbox,
    status: 'matched',
    candidates: [],
    duplicate: null,
  };
}

async function setupRoutes(page: Page) {
  await page.route(`**/api/photos/${PHOTO_ID}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          photo: {
            id: PHOTO_ID, shelf_id: SHELF_ID, status: 'processed',
            detected_count: 3, error_message: null,
            vision_cost_usd: 0.01, vision_latency_ms: 2000,
            created_at: '2026-06-01T10:00:00Z',
          },
          photo_url: TINY_GIF,
          detections: [
            // Dobre bbox — pionowe (aspect ≥ 1.0)
            makeDetection(DET_GOOD_ID, 1, { x1: 0.05, y1: 0.02, x2: 0.15, y2: 0.4 }),
            // Słabe bbox — poziome (aspect < 0.5) → uncertain_localization
            makeDetection(DET_WEAK_ID, 2, { x1: 0.05, y1: 0.4, x2: 0.22, y2: 0.44 }),
            // Brak bbox
            makeDetection(DET_NONE_ID, 3, null),
          ],
          vision_run: null,
        },
      }),
    });
  });

  // Mock refine endpoint
  await page.route(`**/api/detections/*/refine`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const url = route.request().url();
    const detId = url.split('/detections/')[1].split('/refine')[0];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          applied: true,
          detection: {
            id: detId,
            raw_title: 'Tytuł z OCR',
            raw_author: 'Autor z OCR',
            vision_confidence: 0.9,
            spine_color: null,
            bbox: null,
            status: 'matched',
            candidates: [],
            duplicate: null,
          },
        },
      }),
    });
  });
}

test.describe('force-refine — przycisk Refine dla słabych bboxów', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('detection-review')).toBeVisible();
  });

  // ── Dobre bbox → normalny indigo button ───────────────────────────────────

  test('dobre bbox (pionowe) → "Doprecyzuj odczyt" widoczny i klikalny', async ({ page }) => {
    const card = page.getByTestId('detection-card-1');
    await expect(card).toBeVisible();

    const btn = card.getByTestId('refine-button');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText('Doprecyzuj odczyt'); // dobry crop: bez ⚠ prefixu
    await expect(btn).not.toContainText('⚠');
    // Informacja o koszcie widoczna obok przycisku
    await expect(card.getByTestId('refine-cost-hint')).toBeVisible();
  });

  // ── Słabe bbox → amber Force Refine button ────────────────────────────────

  test('słabe bbox (poziome) → "⚠ Doprecyzuj odczyt" widoczny i klikalny', async ({ page }) => {
    const card = page.getByTestId('detection-card-2');
    await expect(card).toBeVisible();

    const btn = card.getByTestId('refine-button');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    // Słaby crop: spójny label + ⚠ prefix (sygnał weak po tekście, nie po kolorze)
    await expect(btn).toContainText('⚠ Doprecyzuj odczyt');
    await expect(card.getByTestId('refine-cost-hint')).toBeVisible();
  });

  test('słaby crop — refine wywołuje endpoint i jest aktywny', async ({ page }) => {
    const refinePromise = page.waitForRequest(
      (req) => req.url().includes(`/api/detections/${DET_WEAK_ID}/refine`) && req.method() === 'POST'
    );

    const card = page.getByTestId('detection-card-2');
    await card.getByTestId('refine-button').click();
    await refinePromise; // bez timeout = test passes gdy request złapany
  });

  // ── Brak bbox → button dla braku bbox ────────────────────────────────────

  test('brak bbox → refine button widoczny (dla detekcji bez bbox)', async ({ page }) => {
    const card = page.getByTestId('detection-card-3');
    await expect(card).toBeVisible();

    const btn = card.getByTestId('refine-button');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  // ── Tryb list ─────────────────────────────────────────────────────────────

  test('tryb list — słabe bbox → "⚠ Doprecyzuj odczyt" widoczny i klikalny', async ({ page }) => {
    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.getByTestId('detection-row-2')).toBeVisible();

    const btn = page.getByTestId('detection-row-2').getByTestId('refine-button');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText('⚠ Doprecyzuj odczyt');
  });
});
