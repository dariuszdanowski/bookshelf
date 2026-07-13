import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// correction-history (weak-match-resolve-and-ocr-audit) — panel „Historia"
// pokazujący chronologiczną historię korekt (corrections) dla detekcji:
// co było odczytane pierwotnie → na co zostało skorygowane, kiedy i jakim
// mechanizmem. Read-only, lazy-fetch (wzorzec CostPanel). Mock przez page.route,
// nigdy realny endpoint.
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-0000000ac001';
const SHELF_ID = '00000000-0000-4000-8000-0000000ac002';
const DET_WITH_HISTORY_ID = '00000000-0000-4000-8000-0000000ac010';
const DET_NO_HISTORY_ID = '00000000-0000-4000-8000-0000000ac011';

async function setupRoutes(page: Page) {
  await page.route(
    (url) => url.pathname === `/api/photos/${PHOTO_ID}`,
    async (route) => {
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
              created_at: '2026-07-13T10:00:00Z',
            },
            photo_url: 'https://example.com/shelf.jpg',
            detections: [
              {
                id: DET_WITH_HISTORY_ID,
                position_index: 1,
                raw_title: 'Prawdziwy Tytuł',
                raw_author: 'Prawdziwy Autor',
                vision_confidence: 0.6,
                spine_color: null,
                bbox: null,
                status: 'matched',
                candidates: [],
                duplicate: null,
              },
              {
                id: DET_NO_HISTORY_ID,
                position_index: 2,
                raw_title: 'Świeża Detekcja',
                raw_author: null,
                vision_confidence: 0.8,
                spine_color: null,
                bbox: null,
                status: 'pending',
                candidates: [],
                duplicate: null,
              },
            ],
            vision_run: null,
          },
        }),
      });
    },
  );

  await page.route(
    (url) => url.pathname === `/api/detections/${DET_WITH_HISTORY_ID}/history`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            corrections: [
              {
                id: 'corr-1',
                correction_type: 'rematch',
                original_raw_title: 'Marowska Duchowska',
                original_raw_author: null,
                corrected_title: 'Prawdziwy Tytuł Wstępny',
                corrected_authors: ['Wstępny Autor'],
                created_at: '2026-07-13T10:05:00Z',
              },
              {
                id: 'corr-2',
                correction_type: 'refine',
                original_raw_title: 'Prawdziwy Tytuł Wstępny',
                original_raw_author: 'Wstępny Autor',
                corrected_title: 'Prawdziwy Tytuł',
                corrected_authors: ['Prawdziwy Autor'],
                created_at: '2026-07-13T10:10:00Z',
              },
            ],
          },
        }),
      });
    },
  );

  await page.route(
    (url) => url.pathname === `/api/detections/${DET_NO_HISTORY_ID}/history`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { corrections: [] } }),
      });
    },
  );
}

test.describe('correction-history — panel „Historia" korekt detekcji', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('detection-review')).toBeVisible();
  });

  test('otwarcie panelu pokazuje wpisy w poprawnej kolejności chronologicznej', async ({
    page,
  }) => {
    const panel = page.getByTestId(`history-panel-det-${DET_WITH_HISTORY_ID}`);
    await expect(panel).not.toBeVisible();

    await page.getByTestId(`history-button-det-${DET_WITH_HISTORY_ID}`).click();
    await expect(panel).toBeVisible();

    await expect(panel).toContainText('Marowska Duchowska');
    await expect(panel).toContainText('Szukaj po tytule');
    await expect(panel).toContainText('Doprecyzuj odczyt');
    await expect(panel).toContainText('Prawdziwy Tytuł');

    // Kolejność chronologiczna: rematch (corr-1) przed refine (corr-2).
    const entriesText = await panel.innerText();
    expect(entriesText.indexOf('Szukaj po tytule')).toBeLessThan(
      entriesText.indexOf('Doprecyzuj odczyt'),
    );
  });

  test('pusta historia pokazuje komunikat „Brak historii korekt"', async ({ page }) => {
    await page.getByTestId(`history-button-det-${DET_NO_HISTORY_ID}`).click();
    const panel = page.getByTestId(`history-panel-det-${DET_NO_HISTORY_ID}`);
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('history-empty')).toContainText('Brak historii korekt');
  });

  test('drugi klik zamyka panel', async ({ page }) => {
    const button = page.getByTestId(`history-button-det-${DET_WITH_HISTORY_ID}`);
    const panel = page.getByTestId(`history-panel-det-${DET_WITH_HISTORY_ID}`);
    await button.click();
    await expect(panel).toBeVisible();
    await button.click();
    await expect(panel).not.toBeVisible();
  });
});
