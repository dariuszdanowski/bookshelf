import { expect, test } from '@playwright/test';

/**
 * S-43 Phase 3 — identity-first UI tests
 *
 * Pokrywa NOWE zachowania identity-first (F2 plan-review: nie duplikuj
 * null-overlay render który upload-flow.spec.ts:104 już sprawdza):
 *
 *  1. RefineButton ukryty gdy bbox === null (gating refine)
 *  2. Identity golden-path: potwierdź detekcję → Dodano do katalogu
 *  3. Add-missed: „Dodaj pominiętą książkę" → formularz → rematch → Akceptuj
 *  4. Overlay empty-bbox hint widoczny + tryb edycji dostępny
 *
 * Wszystkie API mockowane; zero realnego vision/LLM.
 */

const PHOTO_ID = '00000000-0000-4000-8000-a43a43a43a43';
const SHELF_ID = '00000000-0000-4000-8000-b43b43b43b43';

const DET_HIGH = '00000000-0000-4000-8000-c43c43c43c10';
const DET_LOW = '00000000-0000-4000-8000-c43c43c43c11';
const CAND_HIGH = '00000000-0000-4000-8000-d43d43d43d20';
const CAND_LOW = '00000000-0000-4000-8000-d43d43d43d21';

const NEW_DET_ID = '00000000-0000-4000-8000-e43e43e43e99';
const NEW_CAND_ID = '00000000-0000-4000-8000-f43f43f43f99';

const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const MOCK_PHOTO = {
  id: PHOTO_ID,
  shelf_id: SHELF_ID,
  status: 'processed',
  detected_count: 2,
  error_message: null,
  vision_cost_usd: 0.003,
  vision_latency_ms: 3500,
  created_at: new Date().toISOString(),
};

const MOCK_VISION_RUN = {
  id: 'vr-identity-e2e',
  model: 'claude-sonnet-4-6',
  created_at: new Date().toISOString(),
  cost_usd: 0.003,
  latency_ms: 3500,
};

// Obie detekcje bez bbox — symuluje response v7 identity-only
const MOCK_DETECTIONS = [
  {
    id: DET_HIGH,
    position_index: 1,
    raw_title: 'Solaris',
    raw_author: 'Stanisław Lem',
    vision_confidence: 0.95,
    spine_color: 'niebieski',
    bbox: null,
    quad: null,
    refine_cost_usd: null,
    status: 'matched',
    candidates: [
      {
        id: CAND_HIGH,
        source: 'google_books',
        externalId: 'gb-s',
        title: 'Solaris',
        authors: ['Stanisław Lem'],
        isbn10: null,
        isbn13: '9780156027601',
        publisher: 'Harvest',
        publishedYear: 1961,
        coverUrl: null,
        matchScore: 0.92,
        rank: 1,
      },
    ],
    duplicate: null,
  },
  {
    id: DET_LOW,
    position_index: 2,
    raw_title: 'Pan Tadeusz',
    raw_author: 'Adam Mickiewicz',
    vision_confidence: 0.88,
    spine_color: 'zielony',
    bbox: null,
    quad: null,
    refine_cost_usd: null,
    status: 'matched',
    candidates: [
      {
        id: CAND_LOW,
        source: 'google_books',
        externalId: 'gb-pt',
        title: 'Pan Tadeusz',
        authors: ['Adam Mickiewicz'],
        isbn10: null,
        isbn13: null,
        publisher: null,
        publishedYear: 1834,
        coverUrl: null,
        matchScore: 0.62,
        rank: 1,
      },
    ],
    duplicate: null,
  },
];

async function setupBaseRoutes(page: import('@playwright/test').Page) {
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          photo: MOCK_PHOTO,
          photo_url: TINY_GIF,
          detections: MOCK_DETECTIONS,
          vision_run: MOCK_VISION_RUN,
        },
      }),
    });
  });

  await page.route(`**/api/detections/${DET_HIGH}/confirm`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { book_id: 'bk-solaris', shelf_id: SHELF_ID } }),
    });
  });

  await page.route(`**/api/detections/${DET_LOW}/confirm`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { book_id: 'bk-pt', shelf_id: SHELF_ID } }),
    });
  });

  await page.route(`**/api/detections/${DET_HIGH}/reject`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { rejected: true } }),
    });
  });
  await page.route(`**/api/detections/${DET_LOW}/reject`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { rejected: true } }),
    });
  });

  // Shelf redirect after all decided
  await page.route(`**/api/shelves/${SHELF_ID}/books`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: [] } }),
    });
  });
}

// ---------------------------------------------------------------------------
// 1. Gating refine — RefineButton NIE wyświetla się gdy bbox === null
// ---------------------------------------------------------------------------
test('identity: brak refine-button gdy bbox null (gating refine)', async ({ page }) => {
  await setupBaseRoutes(page);
  await page.goto(`/photos/${PHOTO_ID}`);
  await expect(page.getByTestId('detection-review')).toBeVisible();

  // Żadna karta nie powinna mieć refine-button
  await expect(page.getByTestId('refine-button')).not.toBeVisible();
  // Ale karty i przyciski confirm są widoczne
  await expect(page.getByTestId('detection-card-1')).toBeVisible();
  await expect(page.getByTestId('detection-card-1').getByTestId('confirm-button')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2. Identity golden-path: potwierdź pierwszą detekcję → „Dodano do katalogu"
// ---------------------------------------------------------------------------
test('identity: potwierdź detekcję → Dodano do katalogu', async ({ page }) => {
  await setupBaseRoutes(page);
  await page.goto(`/photos/${PHOTO_ID}`);
  await expect(page.getByTestId('detection-review')).toBeVisible();

  const card1 = page.getByTestId('detection-card-1');
  await expect(card1.getByTestId('candidate-title')).toContainText('Solaris');
  await card1.getByTestId('confirm-button').click();
  await expect(card1).toContainText('Dodano do katalogu');
});

// ---------------------------------------------------------------------------
// 3. Add-missed: „Dodaj pominiętą książkę" → tytuł → rematch → kandydaci → Akceptuj
// ---------------------------------------------------------------------------
test('add-missed: formularz tytułu → rematch → potwierdź', async ({ page }) => {
  await setupBaseRoutes(page);

  // Mock POST /api/photos/[id]/detections (create detection by title)
  await page.route(`**/api/photos/${PHOTO_ID}/detections`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: NEW_DET_ID,
          position_index: 3,
          raw_title: 'Wiedźmin',
          raw_author: null,
          vision_confidence: null,
          spine_color: null,
          bbox: null,
          quad: null,
          refine_cost_usd: null,
          status: 'pending',
          candidates: [],
          duplicate: null,
        },
      }),
    });
  });

  // Mock POST /api/detections/[newId]/rematch
  await page.route(`**/api/detections/${NEW_DET_ID}/rematch`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          applied: true,
          detection: { raw_title: 'Wiedźmin', status: 'matched' },
          candidates: [
            {
              id: NEW_CAND_ID,
              source: 'google_books',
              externalId: 'gb-w',
              title: 'Wiedźmin: Ostatnie życzenie',
              authors: ['Andrzej Sapkowski'],
              isbn10: null,
              isbn13: '9788375780598',
              publisher: 'SuperNOWA',
              publishedYear: 1993,
              coverUrl: null,
              matchScore: 0.88,
              rank: 1,
            },
          ],
          duplicate: null,
        },
      }),
    });
  });

  // Mock confirm dla nowej detekcji
  await page.route(`**/api/detections/${NEW_DET_ID}/confirm`, (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { book_id: 'bk-w', shelf_id: SHELF_ID } }),
    });
  });

  await page.goto(`/photos/${PHOTO_ID}`);
  await expect(page.getByTestId('detection-review')).toBeVisible();

  // Klik „+ Dodaj pominiętą książkę"
  await page.getByTestId('add-missed-book-button').click();
  await expect(page.getByTestId('add-missed-book-form')).toBeVisible();

  // Wpisz tytuł
  await page.getByTestId('add-missed-title').fill('Wiedźmin');
  await page.getByTestId('add-missed-submit').click();

  // Po rematch: modal przechodzi do etapu potwierdzenia z kartą kandydatów
  await expect(page.getByTestId('add-missed-review')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('add-missed-review')).toContainText('Potwierdź książkę');
  // Karta z kandydatem widoczna
  const candidateTitle = page.getByTestId('add-missed-review').getByTestId('candidate-title');
  await expect(candidateTitle).toContainText('Wiedźmin');

  // Akceptuj
  await page.getByTestId('add-missed-review').getByTestId('confirm-button').click();
  // Modal zamknięty po sukcesie
  await expect(page.getByTestId('add-missed-review')).not.toBeVisible({ timeout: 3_000 });
});

// ---------------------------------------------------------------------------
// 4. Overlay CTA i tryb edycji przy 0 bboxach
// ---------------------------------------------------------------------------
test('overlay: hint o braku lokalizacji + przejście do trybu rysowania', async ({ page }) => {
  await setupBaseRoutes(page);
  await page.goto(`/photos/${PHOTO_ID}`);
  await expect(page.getByTestId('detection-review')).toBeVisible();

  // Overlay widoczny (foto + info + toolbar)
  await expect(page.getByTestId('photo-overlay')).toBeVisible();

  // Hint o braku bbox widoczny (CTA identity-first)
  await expect(page.getByTestId('overlay-no-bbox-hint')).toBeVisible();

  // Toolbar ma przycisk "Edytuj ramki" (legacy draw path działa)
  await expect(page.getByTestId('edit-bboxes-button')).toBeVisible();

  // Wejście w tryb edycji działa
  await page.getByTestId('edit-bboxes-button').click();
  // Po wejściu w tryb edycji: apply + cancel widoczne
  await expect(page.getByTestId('apply-bbox-edits-button')).toBeVisible();
  await expect(page.getByTestId('cancel-bbox-edits-button')).toBeVisible();
});
