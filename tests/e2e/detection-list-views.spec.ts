import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// S-25 — Tryby prezentacji listy detekcji (Karty / Lista / Kafelki)
// E2E z mockowanym GET /api/photos/:id (bez realnego vision/match — koszt $).
// localStorage seedowany jawnie przed nawigacją (F5: nie polegamy na wycieku
// stanu między spec'ami). Domyślny viewport Desktop Chrome (1280px ≥640) →
// default = Karty, więc istniejące e2e review pozostają w trybie Karty.
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-0000000000e0';
const SHELF_ID = '00000000-0000-4000-8000-0000000000e1';
const VIEW_MODE_KEY = 'bookshelf:detection-view-mode';

type DetectionPayload = {
  id: string;
  position_index: number;
  raw_title: string;
  raw_author: string | null;
  vision_confidence: number | null;
  spine_color: string | null;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  status: string;
  candidates: {
    id: string;
    source: string;
    externalId: string;
    title: string;
    authors: string[];
    isbn10: string | null;
    isbn13: string | null;
    publisher: string | null;
    publishedYear: number | null;
    coverUrl: string | null;
    matchScore: number;
    rank: number;
  }[];
  duplicate: { type: 'exact' | 'edition'; shelfHint?: string } | null;
};

function makeDetections(): DetectionPayload[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000c01',
      position_index: 1,
      raw_title: 'Solaris',
      raw_author: 'Lem',
      vision_confidence: 0.95,
      spine_color: null,
      bbox: { x1: 0.1, y1: 0.05, x2: 0.2, y2: 0.95 },
      status: 'matched',
      candidates: [
        {
          id: '00000000-0000-4000-8000-000000000d01',
          source: 'google_books',
          externalId: 'gb-1',
          title: 'Solaris',
          authors: ['Stanisław Lem'],
          isbn10: null,
          isbn13: '9788308068540',
          publisher: 'Wydawnictwo Literackie',
          publishedYear: 1961,
          coverUrl: null,
          matchScore: 0.92,
          rank: 1,
        },
      ],
      duplicate: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000c02',
      position_index: 2,
      raw_title: 'Lalka',
      raw_author: 'Prus',
      vision_confidence: 0.88,
      spine_color: null,
      bbox: { x1: 0.25, y1: 0.05, x2: 0.35, y2: 0.95 },
      status: 'matched',
      candidates: [
        {
          id: '00000000-0000-4000-8000-000000000d02',
          source: 'google_books',
          externalId: 'gb-2',
          title: 'Lalka',
          authors: ['Bolesław Prus'],
          isbn10: null,
          isbn13: '9788373271890',
          publisher: 'Greg',
          publishedYear: 2010,
          coverUrl: null,
          matchScore: 0.86,
          rank: 1,
        },
      ],
      duplicate: null,
    },
  ];
}

async function setupReviewRoutes(page: Page, detections = makeDetections()) {
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
            detected_count: detections.length,
            error_message: null,
            vision_cost_usd: 0.005,
            vision_latency_ms: 5000,
            created_at: '2026-05-29T10:00:00Z',
          },
          photo_url: null,
          detections,
          vision_run: {
            id: 'vr-1',
            model: 'claude-sonnet-4-6',
            created_at: '2026-05-29T10:00:00Z',
            cost_usd: 0.005,
            latency_ms: 5000,
          },
        },
      }),
    });
  });
}

// Seeduje localStorage PRZED uruchomieniem skryptów strony (F5).
// UWAGA: addInitScript re-uruchamia się na każdej nawigacji, w tym page.reload().
// Dlatego dla mode===null NIE rejestrujemy skryptu (czysty kontekst = default);
// gdybyśmy robili removeItem, reload kasowałby preferencję zapisaną klikiem
// i test persystencji byłby fałszywie czerwony.
async function seedViewMode(page: Page, mode: string | null) {
  if (mode === null) return; // czysty kontekst → responsywny default
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [VIEW_MODE_KEY, mode] as const
  );
}

test.describe('S-25 detection list views', () => {
  test.beforeEach(async ({ page }) => {
    await setupReviewRoutes(page);
  });

  test('switcher przełącza layout Karty → Lista → Kafelki → Karty', async ({ page }) => {
    await seedViewMode(page, null); // brak preferencji → default desktop = Karty
    await page.goto(`/photos/${PHOTO_ID}`);

    await expect(page.getByTestId('view-mode-switcher')).toBeVisible();
    await expect(page.getByTestId('detection-card-1')).toBeVisible();

    await page.getByTestId('view-mode-list').click();
    await expect(page.getByTestId('detection-row-1')).toBeVisible();
    await expect(page.getByTestId('detection-card-1')).toHaveCount(0);

    await page.getByTestId('view-mode-tiles').click();
    await expect(page.getByTestId('detection-tile-1')).toBeVisible();
    await expect(page.getByTestId('detection-row-1')).toHaveCount(0);

    await page.getByTestId('view-mode-cards').click();
    await expect(page.getByTestId('detection-card-1')).toBeVisible();
    await expect(page.getByTestId('detection-tile-1')).toHaveCount(0);
  });

  test('wybór trybu persystowany po reloadzie (localStorage)', async ({ page }) => {
    await seedViewMode(page, null);
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.getByTestId('view-mode-tiles').click();
    await expect(page.getByTestId('detection-tile-1')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('detection-tile-1')).toBeVisible();
    await expect(page.getByTestId('view-mode-tiles')).toHaveAttribute('aria-pressed', 'true');
  });

  test('seedowany tryb Lista renderuje się od razu (bez klikania)', async ({ page }) => {
    await seedViewMode(page, 'list');
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('detection-row-1')).toBeVisible();
    await expect(page.getByTestId('detection-card-1')).toHaveCount(0);
  });

  test('Akceptuj działa w trybie Lista', async ({ page }) => {
    let confirmCalled = false;
    await page.route(`**/api/detections/**/confirm`, async (route) => {
      confirmCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { book_id: 'bk-1', shelf_id: SHELF_ID } }),
      });
    });
    await seedViewMode(page, 'list');
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.getByTestId('detection-row-1').getByTestId('confirm-button').click();
    await expect.poll(() => confirmCalled).toBe(true);
  });

  test('Odrzuć działa w trybie Kafelki', async ({ page }) => {
    let rejectCalled = false;
    await page.route(`**/api/detections/**/reject`, async (route) => {
      rejectCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { rejected: true } }),
      });
    });
    await seedViewMode(page, 'tiles');
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.getByTestId('detection-tile-1').getByTestId('reject-button').click();
    await expect.poll(() => rejectCalled).toBe(true);
  });

  test('„Popraw" otwiera modal w trybie Lista i Kafelki', async ({ page }) => {
    // Lista
    await seedViewMode(page, 'list');
    await page.goto(`/photos/${PHOTO_ID}`);
    await expect(page.getByTestId('correction-modal')).toHaveCount(0);
    await page.getByTestId('detection-row-1').getByTestId('correct-button').click();
    await expect(page.getByTestId('correction-modal')).toBeVisible();
    await expect(page.getByTestId('correct-form')).toBeVisible();
    // Esc zamyka
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('correction-modal')).toHaveCount(0);

    // Kafelki
    await page.getByTestId('view-mode-tiles').click();
    await page.getByTestId('detection-tile-1').getByTestId('correct-button').click();
    await expect(page.getByTestId('correction-modal')).toBeVisible();
    await expect(page.getByTestId('correct-form')).toBeVisible();
  });

  test('Refine działa w trybie Lista', async ({ page }) => {
    let refineCalled = false;
    await page.route(`**/api/detections/**/refine`, async (route) => {
      refineCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { detection: { id: '00000000-0000-4000-8000-000000000c01' } } }),
      });
    });

    await seedViewMode(page, 'list');
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.getByTestId('detection-row-1').getByTestId('refine-button').click();
    await expect.poll(() => refineCalled).toBe(true);
  });
});
