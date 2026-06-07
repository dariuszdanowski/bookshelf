import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// cost-panel — ikona $ z historią kosztów API (vision runs + refine calls)
//
// Ryzyko: panel kosztów musi działać zarówno na poziomie zdjęcia (overlay
// toolbar) jak i per-detekcja (karta). Dane pobierane lazy przy pierwszym
// kliknięciu $ i cachowane.
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-000000000aa1';
const SHELF_ID = '00000000-0000-4000-8000-000000000aa2';
const DET_1_ID = '00000000-0000-4000-8000-000000000b01';
const DET_2_ID = '00000000-0000-4000-8000-000000000b02';

const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

async function setupRoutes(page: Page) {
  const PHOTO_URL = `**/api/photos/${PHOTO_ID}`;
  const COSTS_URL = `**/api/photos/${PHOTO_ID}/costs`;

  await page.route(PHOTO_URL, async (route) => {
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
            vision_cost_usd: 0.015,
            vision_latency_ms: 3200,
            created_at: '2026-06-01T10:00:00Z',
          },
          photo_url: TINY_GIF,
          detections: [
            // M26: det #1 ma koszt OCR → przycisk $ z etykietą wartości
            {
              id: DET_1_ID,
              position_index: 1,
              raw_title: 'Solaris',
              raw_author: 'Lem',
              vision_confidence: 0.95,
              spine_color: null,
              bbox: { x1: 0.05, y1: 0.02, x2: 0.15, y2: 0.35 },
              status: 'matched',
              candidates: [],
              duplicate: null,
              refine_cost_usd: 0.0031,
            },
            {
              id: DET_2_ID,
              position_index: 2,
              raw_title: 'Lalka',
              raw_author: 'Prus',
              vision_confidence: 0.88,
              spine_color: null,
              bbox: { x1: 0.25, y1: 0.02, x2: 0.4, y2: 0.35 },
              status: 'matched',
              candidates: [],
              duplicate: null,
              refine_cost_usd: 0,
            },
          ],
          vision_run: {
            id: 'vr-1',
            model: 'claude-sonnet-4-6',
            created_at: '2026-06-01T10:00:00Z',
            cost_usd: 0.015,
            latency_ms: 3200,
          },
          // M26: pełna suma (vision 0.015 + refine 0.0031) — etykieta przycisku
          costs_total_usd: 0.0181,
        },
      }),
    });
  });

  await page.route(COSTS_URL, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          vision_runs: [
            {
              id: 'vr-1',
              model: 'claude-sonnet-4-6',
              cost_usd: 0.015,
              latency_ms: 3200,
              status: 'completed',
              created_at: '2026-06-01T10:00:00Z',
            },
          ],
          refine_calls: [
            {
              id: 'rc-1',
              detection_id: DET_1_ID,
              position_index: 1,
              raw_title: 'Solaris',
              model: 'claude-sonnet-4-6',
              cost_usd: 0.0031,
              latency_ms: 1800,
              created_at: '2026-06-01T10:05:00Z',
            },
          ],
          totals: {
            vision_cost_usd: 0.015,
            refine_cost_usd: 0.0031,
            grand_total_usd: 0.0181,
            call_count: 2,
          },
        },
      }),
    });
  });
}

test.describe('cost-panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('detection-review')).toBeVisible();
  });

  // ── Przycisk kosztów w panelu vision-run (M26) ───────────────────────────

  test('przycisk kosztów jest widoczny i pokazuje PEŁNĄ sumę (vision+OCR) jako etykietę', async ({
    page,
  }) => {
    const btn = page.getByTestId('cost-button-photo');
    await expect(btn).toBeVisible();
    // M26: etykieta = costs_total_usd (0.015 vision + 0.0031 refine), NIE koszt
    // ostatniego runa; spójna z sumą w dropdownie
    await expect(btn).toHaveText(/\$0\.0181/);
    // przycisk żyje w panelu vision-run pod zdjęciem, nie w toolbarze overlay
    await expect(
      page.getByTestId('vision-run-panel').getByTestId('cost-button-photo'),
    ).toBeVisible();
  });

  test('M26: det z kosztem OCR ma wartość na przycisku; bez OCR — sama ikona', async ({ page }) => {
    await expect(page.getByTestId(`cost-button-det-${DET_1_ID}`)).toHaveText(/\$0\.0031/);
    await expect(page.getByTestId(`cost-button-det-${DET_2_ID}`)).not.toHaveText(/\$0\./);
  });

  test('klik $ w overlay otwiera panel z vision run i sumą', async ({ page }) => {
    await page.getByTestId('cost-button-photo').click();

    // Panel widoczny
    const panel = page
      .locator('[data-testid="cost-button-photo"]')
      .locator('..')
      .locator('div.absolute');
    await expect(panel).toBeVisible();

    // Zawiera Vision run
    await expect(panel).toContainText('Vision');
    // Zawiera OCR wpis
    await expect(panel).toContainText('OCR #1');
    // Suma
    await expect(panel).toContainText('Suma');
    await expect(panel).toContainText('$0.0181');
  });

  test('drugi klik $ zamyka panel', async ({ page }) => {
    await page.getByTestId('cost-button-photo').click();
    const panel = page
      .locator('[data-testid="cost-button-photo"]')
      .locator('..')
      .locator('div.absolute');
    await expect(panel).toBeVisible();

    await page.getByTestId('cost-button-photo').click();
    await expect(panel).not.toBeVisible();
  });

  // ── Ikona $ na karcie detekcji ────────────────────────────────────────────

  test('ikona $ na karcie detekcji #1 jest widoczna', async ({ page }) => {
    const btn = page.getByTestId(`cost-button-det-${DET_1_ID}`);
    await expect(btn).toBeVisible();
  });

  test('klik $ na karcie detekcji #1 pokazuje tylko OCR dla tej detekcji', async ({ page }) => {
    const btn = page.getByTestId(`cost-button-det-${DET_1_ID}`);
    await btn.click();

    const panel = btn.locator('..').locator('div.absolute');
    await expect(panel).toBeVisible();

    // Zawiera OCR dla tej detekcji
    await expect(panel).toContainText('OCR');
    await expect(panel).toContainText('$0.0031');

    // NIE zawiera Vision run (to jest filtr per-detekcja)
    await expect(panel).not.toContainText('Vision run');
  });

  test('ikona $ na karcie detekcji #2 — brak OCR (suma $0)', async ({ page }) => {
    const btn = page.getByTestId(`cost-button-det-${DET_2_ID}`);
    await btn.click();

    const panel = btn.locator('..').locator('div.absolute');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Brak wywołań API');
  });

  // ── Panel zamyka się kliknięciem poza ────────────────────────────────────

  test('klik poza panelem zamyka go', async ({ page }) => {
    await page.getByTestId('cost-button-photo').click();
    const panel = page
      .locator('[data-testid="cost-button-photo"]')
      .locator('..')
      .locator('div.absolute');
    await expect(panel).toBeVisible();

    // Klik poza panelem
    await page.mouse.click(10, 10);
    await expect(panel).not.toBeVisible();
  });

  // ── Dane pobierane lazy — tylko po kliknięciu ─────────────────────────────

  test('GET /costs nie jest wywoływany przed kliknięciem $', async ({ page }) => {
    let costsCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/costs')) costsCalled = true;
    });

    // Odczekaj chwilę bez klikania $
    await page.waitForTimeout(500);
    expect(costsCalled).toBe(false);

    // Dopiero klik wywołuje fetch
    const costsRequestPromise = page.waitForRequest((req) => req.url().includes('/costs'));
    await page.getByTestId('cost-button-photo').click();
    await costsRequestPromise;
    expect(costsCalled).toBe(true);
  });
});
