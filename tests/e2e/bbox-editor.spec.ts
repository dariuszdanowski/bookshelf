import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// bbox-editor — interaktywna edycja ramek detekcji na zdjęciu półki
//
// Ryzyko: zmiany bbox (rysowanie, usuwanie) muszą przetrwać Apply i trafić
// do bazy przez API batch. Cancel NIE może wywoływać żadnych API calls.
//
// Wszystkie zewnętrzne API zmockowane — zero kosztu LLM, zero realnego storage.
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-000000000bb1';
const SHELF_ID = '00000000-0000-4000-8000-000000000bb2';
const DET_1_ID = '00000000-0000-4000-8000-000000000d01';
const DET_2_ID = '00000000-0000-4000-8000-000000000d02';
const NEW_DET_ID = '00000000-0000-4000-8000-000000000d99';

const TINY_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

async function setupRoutes(page: Page) {
  // GET /api/photos/:id — dane zdjęcia z 2 detekcjami z bbox
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
          photo_url: TINY_GIF,
          detections: [
            {
              id: DET_1_ID,
              position_index: 1,
              raw_title: 'Solaris',
              raw_author: 'Lem',
              vision_confidence: 0.95,
              spine_color: 'niebieski',
              bbox: { x1: 0.05, y1: 0.05, x2: 0.2, y2: 0.9 },
              status: 'matched',
              candidates: [],
              duplicate: null,
            },
            {
              id: DET_2_ID,
              position_index: 2,
              raw_title: 'Lalka',
              raw_author: 'Prus',
              vision_confidence: 0.88,
              spine_color: 'czerwony',
              bbox: { x1: 0.25, y1: 0.05, x2: 0.45, y2: 0.9 },
              status: 'matched',
              candidates: [],
              duplicate: null,
            },
          ],
          vision_run: {
            id: 'vr-bbox-editor',
            model: 'claude-sonnet-4-6',
            created_at: '2026-06-01T10:00:00Z',
            cost_usd: 0.01,
            latency_ms: 3000,
          },
        },
      }),
    });
  });

  // PATCH /api/detections/:id/bbox
  await page.route(`**/api/detections/*/bbox`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const url = route.request().url();
    const detId = url.split('/detections/')[1].split('/bbox')[0];
    const body = JSON.parse(route.request().postData() ?? '{}') as { bbox: unknown };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { id: detId, bbox: body.bbox } }),
    });
  });

  // POST /api/detections/:id/reject
  await page.route(`**/api/detections/*/reject`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { rejected: true } }),
    });
  });

  // POST /api/photos/:id/detections — nowa detekcja z narysowanego bbox
  await page.route(`**/api/photos/${PHOTO_ID}/detections`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = JSON.parse(route.request().postData() ?? '{}') as { bbox: { x1: number; y1: number; x2: number; y2: number } };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: NEW_DET_ID,
          position_index: 3,
          raw_title: '',
          raw_author: null,
          vision_confidence: null,
          spine_color: null,
          bbox: body.bbox,
          status: 'pending',
          candidates: [],
          duplicate: null,
        },
      }),
    });
  });
}

test.describe('bbox editor', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('photo-overlay')).toBeVisible();
  });

  // ── 1. Wejście w edit mode ─────────────────────────────────────────────────

  test('edit-bboxes-button otwiera tryb edycji — apply i cancel widoczne, zoom ukryty', async ({ page }) => {
    await page.getByTestId('edit-bboxes-button').click();

    await expect(page.getByTestId('apply-bbox-edits-button')).toBeVisible();
    await expect(page.getByTestId('cancel-bbox-edits-button')).toBeVisible();
    await expect(page.getByTestId('edit-bboxes-button')).not.toBeVisible();
    await expect(page.getByTestId('zoom-in-button')).not.toBeVisible();
  });

  // ── 2. Usuń bbox → Apply → detekcja znika z listy ─────────────────────────

  test('usunięcie bbox przez × i Apply usuwa kartę detekcji z listy', async ({ page }) => {
    const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
    await img.waitFor({ state: 'visible' });

    // Wejdź w edit mode
    await page.getByTestId('edit-bboxes-button').click();
    await expect(page.getByTestId('apply-bbox-edits-button')).toBeVisible();

    // Usuń marker #1
    await expect(page.getByTestId('bbox-marker-1')).toBeVisible();
    await page.getByTestId('bbox-delete-1').click();
    await expect(page.getByTestId('bbox-marker-1')).not.toBeVisible();

    // Wyślij zmiany — czekaj na reject API call
    const rejectPromise = page.waitForRequest(
      (req) => req.url().includes(`/api/detections/${DET_1_ID}/reject`) && req.method() === 'POST'
    );
    await page.getByTestId('apply-bbox-edits-button').click();
    await rejectPromise;

    // Karta detekcji 1 powinna zniknąć z listy
    await expect(page.getByTestId('detection-card-1')).not.toBeVisible();
    // Karta detekcji 2 nadal istnieje
    await expect(page.getByTestId('detection-card-2')).toBeVisible();
  });

  // ── 3. Rysowanie nowego bbox → Apply → nowa karta w liście ───────────────

  test('narysowanie nowego bbox i Apply dodaje kartę detekcji do listy', async ({ page }) => {
    const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
    await img.waitFor({ state: 'visible' });

    await page.getByTestId('edit-bboxes-button').click();
    await expect(page.getByTestId('apply-bbox-edits-button')).toBeVisible();

    // Pobierz bbox viewport i wyznacz obszar do rysowania (prawa strona, dala od markerów)
    const viewport = page.getByTestId('photo-overlay-viewport');
    const box = await viewport.boundingBox();
    expect(box).not.toBeNull();

    // Markery są na x: 5-20% i 25-45% → rysuj w ~70-90% szerokości
    const startX = box!.x + box!.width * 0.70;
    const startY = box!.y + box!.height * 0.20;
    const endX = box!.x + box!.width * 0.90;
    const endY = box!.y + box!.height * 0.70;

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up({ button: 'left' });

    // Wyślij zmiany — czekaj na POST detections
    const postPromise = page.waitForRequest(
      (req) => req.url().includes(`/api/photos/${PHOTO_ID}/detections`) && req.method() === 'POST'
    );
    await page.getByTestId('apply-bbox-edits-button').click();
    await postPromise;

    // Nowa karta (position_index: 3) powinna pojawić się w liście
    await expect(page.getByTestId('detection-card-3')).toBeVisible();
  });

  // ── 4. Anuluj — brak zmian i brak API calls ───────────────────────────────

  test('cancel po usunięciu bbox nie wywołuje API i przywraca widok', async ({ page }) => {
    const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
    await img.waitFor({ state: 'visible' });

    await page.getByTestId('edit-bboxes-button').click();

    // Usuń marker #1 lokalnie
    await page.getByTestId('bbox-delete-1').click();
    await expect(page.getByTestId('bbox-marker-1')).not.toBeVisible();

    // Śledź ewentualne reject calls
    let rejectCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/reject')) rejectCalled = true;
    });

    // Anuluj
    await page.getByTestId('cancel-bbox-edits-button').click();

    // Tryb edit wyłączony
    await expect(page.getByTestId('apply-bbox-edits-button')).not.toBeVisible();
    await expect(page.getByTestId('edit-bboxes-button')).toBeVisible();

    // Żaden reject call nie poszedł
    expect(rejectCalled).toBe(false);

    // Karty detekcji nadal widoczne (stan DB bez zmian)
    await expect(page.getByTestId('detection-card-1')).toBeVisible();
    await expect(page.getByTestId('detection-card-2')).toBeVisible();
  });
});
