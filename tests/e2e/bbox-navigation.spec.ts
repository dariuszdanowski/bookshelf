import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// bbox-navigation — dwukierunkowa nawigacja marker↔karta + tooltip
//
// Ryzyko: przejście z markera do propozycji musi działać we wszystkich
// trybach widoku (card/list/tile), nie tylko w domyślnym. Ikonka crosshair
// na karcie musi wracać do overlay. Tooltip musi pojawić się po 1s.
//
// Zero realnych API — wszystko mockowane.
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-000000000cc1';
const SHELF_ID = '00000000-0000-4000-8000-000000000cc2';
const DET_1_ID = '00000000-0000-4000-8000-000000000e01';
const DET_2_ID = '00000000-0000-4000-8000-000000000e02';

const TINY_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

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
              candidates: [
                {
                  id: 'cand-1',
                  source: 'google_books',
                  externalId: 'gb-1',
                  title: 'Solaris',
                  authors: ['Stanisław Lem'],
                  isbn10: null,
                  isbn13: '9788308000001',
                  publisher: 'Wydawnictwo Literackie',
                  publishedYear: 1961,
                  coverUrl: null,
                  matchScore: 0.97,
                  rank: 1,
                },
              ],
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
            id: 'vr-nav',
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

test.describe('nawigacja marker → karta', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('photo-overlay')).toBeVisible();
    // Wczytaj zdjęcie żeby markery się wyrenderowały
    const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
    await img.waitFor({ state: 'visible' });
  });

  // ── tryb card (domyślny) ──────────────────────────────────────────────────

  test('klik ikony ≡ na markerze (tryb card) — detection-card widoczny', async ({ page }) => {
    const markerBtn = page.locator('[data-testid="bbox-marker-1"] button[title="Przejdź do propozycji na liście"]');
    await expect(markerBtn).toBeVisible();
    await markerBtn.click();
    await expect(page.getByTestId('detection-card-1')).toBeVisible();
  });

  // ── tryb list (row) ───────────────────────────────────────────────────────

  test('klik ikony ≡ na markerze (tryb list) — detection-row widoczny', async ({ page }) => {
    // Przełącz na tryb list
    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.getByTestId('detection-row-1')).toBeVisible();

    const markerBtn = page.locator('[data-testid="bbox-marker-1"] button[title="Przejdź do propozycji na liście"]');
    await markerBtn.click();
    await expect(page.getByTestId('detection-row-1')).toBeVisible();
  });

  // ── tryb tiles ────────────────────────────────────────────────────────────

  test('klik ikony ≡ na markerze (tryb tiles) — detection-tile widoczny', async ({ page }) => {
    // Przełącz na tryb kafelków
    await page.getByRole('button', { name: 'Kafelki' }).click();
    await expect(page.getByTestId('detection-tile-1')).toBeVisible();

    const markerBtn = page.locator('[data-testid="bbox-marker-1"] button[title="Przejdź do propozycji na liście"]');
    await markerBtn.click();
    await expect(page.getByTestId('detection-tile-1')).toBeVisible();
  });
});

test.describe('nawigacja karta → marker (overlay)', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('photo-overlay')).toBeVisible();
    const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
    await img.waitFor({ state: 'visible' });
  });

  test('klik crosshair na detection-card → overlay widoczny', async ({ page }) => {
    const navigateBtn = page.locator('[data-testid="detection-card-1"] button[title="Przejdź do ramki na zdjęciu"]');
    await expect(navigateBtn).toBeVisible();
    await navigateBtn.click();
    await expect(page.getByTestId('photo-overlay')).toBeVisible();
  });

  test('klik crosshair na detection-card — tylko marker #1 widoczny (fokus)', async ({ page }) => {
    const navigateBtn = page.locator('[data-testid="detection-card-1"] button[title="Przejdź do ramki na zdjęciu"]');
    await navigateBtn.click();

    // Marker #1 zaznaczony (fokus aktywny)
    await expect(page.getByTestId('bbox-marker-1')).toBeVisible();
    // Marker #2 niewidoczny (tryb focus)
    await expect(page.getByTestId('bbox-marker-2')).not.toBeVisible();
  });

  test('klik crosshair na detection-row (tryb list) → overlay widoczny + fokus', async ({ page }) => {
    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.getByTestId('detection-row-1')).toBeVisible();

    const navigateBtn = page.locator('[data-testid="detection-row-1"] button[title="Przejdź do ramki na zdjęciu"]');
    await expect(navigateBtn).toBeVisible();
    await navigateBtn.click();

    await expect(page.getByTestId('bbox-marker-1')).toBeVisible();
    await expect(page.getByTestId('bbox-marker-2')).not.toBeVisible();
  });

  test('klik crosshair na detection-tile (tryb tiles) → overlay widoczny + fokus', async ({ page }) => {
    await page.getByRole('button', { name: 'Kafelki' }).click();
    await expect(page.getByTestId('detection-tile-1')).toBeVisible();

    const navigateBtn = page.locator('[data-testid="detection-tile-1"] button[title="Przejdź do ramki na zdjęciu"]');
    await expect(navigateBtn).toBeVisible();
    await navigateBtn.click();

    await expect(page.getByTestId('bbox-marker-1')).toBeVisible();
    await expect(page.getByTestId('bbox-marker-2')).not.toBeVisible();
  });
});

test.describe('tooltip na markerze', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('photo-overlay')).toBeVisible();
    const img = page.getByAltText('Zdjęcie półki z wykrytymi książkami');
    await img.waitFor({ state: 'visible' });
  });

  test('tooltip pojawia się po najechaniu na marker — zawiera tytuł i kandydata', async ({ page }) => {
    const marker = page.getByTestId('bbox-marker-1');
    await marker.hover();

    // Tooltip pojawia się po ~1s — czekamy na widoczność (max 3s)
    const tooltip = page.getByTestId('marker-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 3000 });
    await expect(tooltip).toContainText('Solaris');
    await expect(tooltip).toContainText('Stanisław Lem');
  });

  test('tooltip znika po opuszczeniu markera', async ({ page }) => {
    const marker = page.getByTestId('bbox-marker-1');
    await marker.hover();

    const tooltip = page.getByTestId('marker-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 3000 });

    // Odsuń mysz od markera
    await page.mouse.move(10, 10);
    await expect(tooltip).not.toBeVisible();
  });

  test('tooltip na markerze bez kandydatów — brak propozycji', async ({ page }) => {
    const marker = page.getByTestId('bbox-marker-2');
    await marker.hover();

    const tooltip = page.getByTestId('marker-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 3000 });
    await expect(tooltip).toContainText('Lalka');
    await expect(tooltip).toContainText('brak propozycji');
  });
});
