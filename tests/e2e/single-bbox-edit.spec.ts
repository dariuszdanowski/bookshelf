import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// single-bbox-edit — edycja pojedynczej ramki bez trybu globalnego
//
// Ryzyko: kliknięcie ołówka na markerze musi wejść w per-markerowy tryb
// edycji, resize/move musi działać, Save wywołuje PATCH API, Cancel cofa
// bez API call. Inne markery pozostają bez zmian.
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-000000000dd1';
const SHELF_ID = '00000000-0000-4000-8000-000000000dd2';
const DET_1_ID = '00000000-0000-4000-8000-000000000f01';
const DET_2_ID = '00000000-0000-4000-8000-000000000f02';

const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

async function setupRoutes(page: Page) {
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
            vision_latency_ms: 2000,
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
              // bbox w górnej części — uchwyty widoczne w viewport bez scrollowania
              bbox: { x1: 0.05, y1: 0.02, x2: 0.18, y2: 0.28 },
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
              bbox: { x1: 0.3, y1: 0.02, x2: 0.45, y2: 0.28 },
              status: 'matched',
              candidates: [],
              duplicate: null,
            },
          ],
          vision_run: {
            id: 'vr-single',
            model: 'claude-sonnet-4-6',
            created_at: '2026-06-01T10:00:00Z',
            cost_usd: 0.01,
            latency_ms: 2000,
          },
        },
      }),
    });
  });

  // PATCH bbox — zwraca 200 z zaktualizowanym bbox
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
}

test.describe('edycja pojedynczej ramki', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('photo-overlay')).toBeVisible();
    const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
    await img.waitFor({ state: 'visible' });
  });

  // ── Wejście w tryb edycji ─────────────────────────────────────────────────

  test('klik ołówka na markerze #1 wchodzi w tryb edycji tej ramki', async ({ page }) => {
    const pencil = page.getByTestId('single-edit-enter-1');
    await expect(pencil).toBeVisible();
    await pencil.click();

    // Róg SE (SVG circle) visible → edit mode aktywny
    await expect(page.getByTestId('bbox-handle-1-se')).toBeVisible();
    // Przyciski save i cancel widoczne
    await expect(page.getByTestId('single-edit-save-1')).toBeVisible();
    await expect(page.getByTestId('single-edit-cancel-1')).toBeVisible();
    // Globalny toolbar edit NIE zmieniony — przyciski zoom nadal widoczne
    await expect(page.getByTestId('zoom-in-button')).toBeVisible();
  });

  test('wejście w single-edit ukrywa ołówki na innych markerach', async ({ page }) => {
    // Przed: ołówek na markerze #2 widoczny
    await expect(page.getByTestId('single-edit-enter-2')).toBeVisible();

    // Wejście w single-edit #1
    await page.getByTestId('single-edit-enter-1').click();

    // Po: ołówek na markerze #2 ukryty (singleEditId aktywny)
    await expect(page.getByTestId('single-edit-enter-2')).not.toBeVisible();
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  test('cancel zamyka tryb edycji bez wywołania API', async ({ page }) => {
    let patchCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/bbox') && req.method() === 'PATCH') patchCalled = true;
    });

    await page.getByTestId('single-edit-enter-1').click();
    await expect(page.getByTestId('single-edit-cancel-1')).toBeVisible();
    await page.getByTestId('single-edit-cancel-1').click();

    // Tryb edycji zamknięty — uchwyt znikł, ołówek wrócił
    await expect(page.getByTestId('bbox-handle-1-se')).not.toBeVisible();
    await expect(page.getByTestId('single-edit-enter-1')).toBeVisible();
    // Brak PATCH call
    expect(patchCalled).toBe(false);
  });

  // ── Save (bez zmiany bbox — bez drag) ────────────────────────────────────

  test('save bez zmiany wywołuje PATCH z oryginalnym bbox i zamyka edycję', async ({ page }) => {
    const patchPromise = page.waitForRequest(
      (req) => req.url().includes(`/api/detections/${DET_1_ID}/bbox`) && req.method() === 'PATCH',
    );

    await page.getByTestId('single-edit-enter-1').click();
    await page.getByTestId('single-edit-save-1').click();

    // PATCH wywołany
    const req = await patchPromise;
    const body = JSON.parse(req.postData() ?? '{}') as {
      bbox: { x1: number; y1: number; x2: number; y2: number };
    };
    expect(body.bbox).toMatchObject({ x1: 0.05, y1: 0.02, x2: 0.18, y2: 0.28 });

    // Tryb edycji zamknięty
    await expect(page.getByTestId('bbox-handle-1-se')).not.toBeVisible();
    await expect(page.getByTestId('single-edit-enter-1')).toBeVisible();
  });

  // ── Drag rogu SE (SVG circle) ────────────────────────────────────────────

  test('drag rogu SE zmienia bbox i save wywołuje PATCH ze zmienionym bbox', async ({ page }) => {
    await page.getByTestId('single-edit-enter-1').click();

    const handle = page.getByTestId('bbox-handle-1-se');
    await expect(handle).toBeVisible();

    const box = await handle.boundingBox();
    expect(box).not.toBeNull();

    const hcx = box!.x + box!.width / 2;
    const hcy = box!.y + box!.height / 2;

    // Drag rogu SE w prawo i w dół o 60px
    await page.mouse.move(hcx, hcy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(hcx + 60, hcy + 30, { steps: 10 });
    await page.mouse.up({ button: 'left' });

    // Save — PATCH musi być wywołany
    const patchPromise = page.waitForRequest(
      (req) => req.url().includes(`/api/detections/${DET_1_ID}/bbox`) && req.method() === 'PATCH',
    );
    await page.getByTestId('single-edit-save-1').click();
    const req = await patchPromise;

    const body = JSON.parse(req.postData() ?? '{}') as {
      bbox: { x1: number; y1: number; x2: number; y2: number };
    };
    // x2 powinien wzrosnąć (drag rogu BR w prawo przesuwa punkt i zmienia bbox)
    expect(body.bbox.x2).toBeGreaterThan(0.18);
  });

  // ── Move — drag wnętrza markera ──────────────────────────────────────────

  test('drag markera (move) zmienia bbox i save wywołuje PATCH', async ({ page }) => {
    await page.getByTestId('single-edit-enter-1').click();

    const marker = page.getByTestId('bbox-marker-1');
    const box = await marker.boundingBox();
    expect(box).not.toBeNull();

    // Drag środka markera w prawo o 60px
    const cx = box!.x + box!.width * 0.5;
    const cy = box!.y + box!.height * 0.5;

    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(cx + 60, cy + 5, { steps: 10 });
    await page.mouse.up({ button: 'left' });

    const patchPromise = page.waitForRequest(
      (req) => req.url().includes(`/api/detections/${DET_1_ID}/bbox`) && req.method() === 'PATCH',
    );
    await page.getByTestId('single-edit-save-1').click();
    const req = await patchPromise;

    const body = JSON.parse(req.postData() ?? '{}') as {
      bbox: { x1: number; y1: number; x2: number; y2: number };
    };
    // Marker przesunięty — x1 > oryginalnego 0.05
    expect(body.bbox.x1).toBeGreaterThan(0.05);
  });

  // ── Izolacja — drugi marker nie zmieniony ────────────────────────────────

  test('edycja #1 nie wpływa na marker #2', async ({ page }) => {
    await page.getByTestId('single-edit-enter-1').click();

    // Marker #2 nadal widoczny i bez uchwytów
    await expect(page.getByTestId('bbox-marker-2')).toBeVisible();
    await expect(page.getByTestId('bbox-handle-2-se')).not.toBeVisible();

    await page.getByTestId('single-edit-cancel-1').click();

    // Po cancel — marker #2 wciąż bez uchwytów, ołówek powrócił
    await expect(page.getByTestId('bbox-handle-2-se')).not.toBeVisible();
    await expect(page.getByTestId('single-edit-enter-2')).toBeVisible();
  });

  // ── Global edit mode wyklucza single-edit ────────────────────────────────

  test('wejście w globalny edit mode usuwa ołówki markerów', async ({ page }) => {
    await expect(page.getByTestId('single-edit-enter-1')).toBeVisible();

    await page.getByTestId('edit-bboxes-button').click();
    await expect(page.getByTestId('apply-bbox-edits-button')).toBeVisible();

    // Ołówek nie widoczny (globalny edit = brak per-marker pencil)
    await expect(page.getByTestId('single-edit-enter-1')).not.toBeVisible();
  });
});
