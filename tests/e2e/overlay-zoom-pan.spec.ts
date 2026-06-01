import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// overlay-zoom-pan — zoom kółkiem/przyciskami + drag (przesuwanie po zoom)
//
// Mockujemy GET /api/photos/:id z photo_url = tiny data-URI, żeby overlay
// rzeczywiście wyrenderował zdjęcie i viewport był scrollowalny.
// Brak realnych wywołań vision/match/storage — zero kosztu LLM.
//
// Kluczowy scenariusz: po zoom > 1x drag LPM przesuwa viewport o pełną
// odległość (bug: pointercancel z native-drag przerywał po kilku pikselach).
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-0000000000f0';
const SHELF_ID = '00000000-0000-4000-8000-0000000000f1';

// Minimalne 1×1 GIF — zapobiega 404 i pozwala img.onLoad → imgLoaded=true
// dzięki czemu renderMarkers() działa, a viewport ma treść do scrollowania.
const TINY_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

async function setupOverlayRoutes(page: Page) {
  await page.route(`**/api/photos/${PHOTO_ID}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          photo: {
            id: PHOTO_ID,
            shelf_id: SHELF_ID,
            status: 'processed',
            detected_count: 2,
            error_message: null,
            vision_cost_usd: 0.01,
            vision_latency_ms: 3000,
            created_at: '2026-06-01T10:00:00Z',
          },
          // photo_url non-null → PhotoDetectionOverlay renderuje się
          photo_url: TINY_GIF,
          detections: [
            {
              id: '00000000-0000-4000-8000-000000000c11',
              position_index: 1,
              raw_title: 'Solaris',
              raw_author: 'Lem',
              vision_confidence: 0.95,
              spine_color: 'niebieski',
              bbox: { x1: 0.1, y1: 0.05, x2: 0.2, y2: 0.95 },
              status: 'matched',
              candidates: [],
              duplicate: null,
            },
            {
              id: '00000000-0000-4000-8000-000000000c12',
              position_index: 2,
              raw_title: 'Lalka',
              raw_author: 'Prus',
              vision_confidence: 0.88,
              spine_color: 'czerwony',
              bbox: { x1: 0.3, y1: 0.05, x2: 0.45, y2: 0.95 },
              status: 'matched',
              candidates: [],
              duplicate: null,
            },
          ],
          vision_run: {
            id: 'vr-overlay',
            model: 'claude-sonnet-4-6',
            created_at: '2026-06-01T10:00:00Z',
            cost_usd: 0.01,
            latency_ms: 3000,
          },
        },
      }),
    });
  });
}

test.describe('overlay zoom + pan', () => {
  test.beforeEach(async ({ page }) => {
    await setupOverlayRoutes(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('photo-overlay')).toBeVisible();
  });

  // ── zoom przyciskami ────────────────────────────────────────────────────

  test('przycisk + powiększa, − pomniejsza, reset wraca do 100%', async ({ page }) => {
    const reset = page.getByTestId('zoom-reset-button');
    await expect(reset).toHaveText('100%');

    await page.getByTestId('zoom-in-button').click();
    await expect(reset).toHaveText('125%');

    await page.getByTestId('zoom-in-button').click();
    await expect(reset).toHaveText('150%');

    await page.getByTestId('zoom-out-button').click();
    await expect(reset).toHaveText('125%');

    await reset.click();
    await expect(reset).toHaveText('100%');
  });

  test('zoom nie przekracza 400% ani nie spada poniżej 100%', async ({ page }) => {
    const zoomIn = page.getByTestId('zoom-in-button');
    const zoomOut = page.getByTestId('zoom-out-button');
    const reset = page.getByTestId('zoom-reset-button');

    // Klikamy 20 razy + — powinno zatrzymać się na 400%
    for (let i = 0; i < 20; i++) await zoomIn.click();
    await expect(reset).toHaveText('400%');

    // Wracamy do 100% i próbujemy zejść niżej — minimum to 100%
    await reset.click();
    for (let i = 0; i < 10; i++) await zoomOut.click();
    await expect(reset).toHaveText('100%');
  });

  // ── drag po zoom — kluczowy scenariusz (bug: native-drag kradł pointer) ──

  test('drag LPM przesuwa viewport po zoom — nie zatrzymuje się po kilku pikselach', async ({
    page,
  }) => {
    // Zoom do 300% (8× kliknięcie +, każdy +25%)
    const zoomIn = page.getByTestId('zoom-in-button');
    for (let i = 0; i < 8; i++) await zoomIn.click();
    await expect(page.getByTestId('zoom-reset-button')).toHaveText('300%');

    const viewport = page.getByTestId('photo-overlay-viewport');
    const box = await viewport.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width * 0.6;
    const startY = box!.y + box!.height * 0.5;
    const dragDx = -200; // ciągnij w lewo → scrollLeft rośnie
    const dragDy = -80;

    const scrollBefore = await viewport.evaluate((el: Element) => ({
      left: (el as HTMLElement).scrollLeft,
      top: (el as HTMLElement).scrollTop,
    }));

    // Symuluj drag: pointerdown → kilkanaście kroków → pointerup
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(startX + dragDx, startY + dragDy, { steps: 15 });
    await page.mouse.up({ button: 'left' });

    const scrollAfter = await viewport.evaluate((el: Element) => ({
      left: (el as HTMLElement).scrollLeft,
      top: (el as HTMLElement).scrollTop,
    }));

    // Drag o 200px w lewo → scrollLeft powinien wzrosnąć o ≥ 100px.
    // (Mniej niż 200 bo zdjęcie może nie wypełniać całego dostępnego zakresu scroll,
    // ale >100 wyklucza "kilka pikseli i stop" które był bugiem).
    expect(scrollAfter.left).toBeGreaterThan(scrollBefore.left + 100);
    expect(scrollAfter.top).toBeGreaterThan(scrollBefore.top + 30);
  });

  test('drag PPM nie przesuwa viewportu (tylko LPM)', async ({ page }) => {
    // Zoom do 200%
    for (let i = 0; i < 4; i++) await page.getByTestId('zoom-in-button').click();

    const viewport = page.getByTestId('photo-overlay-viewport');
    const box = await viewport.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const scrollBefore = await viewport.evaluate((el: Element) => ({
      left: (el as HTMLElement).scrollLeft,
      top: (el as HTMLElement).scrollTop,
    }));

    // PPM drag — powinien być ignorowany
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx - 150, cy, { steps: 10 });
    await page.mouse.up({ button: 'right' });

    const scrollAfter = await viewport.evaluate((el: Element) => ({
      left: (el as HTMLElement).scrollLeft,
      top: (el as HTMLElement).scrollTop,
    }));

    expect(scrollAfter.left).toBe(scrollBefore.left);
    expect(scrollAfter.top).toBe(scrollBefore.top);
  });

  test('drag nie działa przy zoom = 100% (brak scrollowalnej treści)', async ({ page }) => {
    // Zoom = 100% (default) — handlePointerDown zwraca early gdy zoom <= 1
    const viewport = page.getByTestId('photo-overlay-viewport');
    const box = await viewport.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const scrollBefore = await viewport.evaluate((el: Element) => ({
      left: (el as HTMLElement).scrollLeft,
    }));

    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(cx - 150, cy, { steps: 10 });
    await page.mouse.up({ button: 'left' });

    const scrollAfter = await viewport.evaluate((el: Element) => ({
      left: (el as HTMLElement).scrollLeft,
    }));

    expect(scrollAfter.left).toBe(scrollBefore.left);
  });

  // ── toggle ramek ────────────────────────────────────────────────────────

  test('toggle ramek ukrywa i pokazuje bbox markery', async ({ page }) => {
    const toggleBtn = page.getByTestId('toggle-bboxes-button');
    // Czekamy aż img załaduje (onLoad → imgLoaded → renderMarkers)
    await expect(page.getByTestId('bbox-marker-1')).toBeVisible({ timeout: 5000 });

    await expect(toggleBtn).toHaveText('Ukryj ramki');
    await toggleBtn.click();
    await expect(page.getByTestId('bbox-marker-1')).toHaveCount(0);
    await expect(toggleBtn).toHaveText('Pokaż ramki');

    await toggleBtn.click();
    await expect(page.getByTestId('bbox-marker-1')).toBeVisible();
  });

  // ── fokus detekcji ──────────────────────────────────────────────────────

  test('brak auto-fokusu #1 przy ładowaniu strony', async ({ page }) => {
    // "Pokaż wszystkie detekcje" nie powinien być widoczny (focusedDetectionId = null)
    await expect(page.getByTestId('clear-focus-button')).toHaveCount(0);
    await expect(page.getByTestId('focused-bbox-diagnostics')).toHaveCount(0);
  });

  test('klik na detekcję ustawia fokus, clear-focus kasuje', async ({ page }) => {
    // Klik w detekcję #1 na liście
    await page.getByTestId('detection-card-1').click();
    await expect(page.getByTestId('clear-focus-button')).toBeVisible();
    await expect(page.getByTestId('focused-bbox-diagnostics')).toBeVisible();

    // "Pokaż wszystkie" w toolbarze — klik kasuje fokus
    await page.getByTestId('clear-focus-button').click();
    await expect(page.getByTestId('clear-focus-button')).toHaveCount(0);
    await expect(page.getByTestId('focused-bbox-diagnostics')).toHaveCount(0);
  });
});
