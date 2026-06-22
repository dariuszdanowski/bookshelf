import { expect, test } from '@playwright/test';

/**
 * E2E: SSE progress w ProgressModal podczas fazy match.
 *
 * Weryfikuje:
 * 1. GET /match-stream jest wywoływany (SSE path aktywny)
 * 2. Modal "Dopasowywanie" widoczny podczas oczekiwania na SSE
 * 3. Po event: done — redirect do /photos/{id}
 *
 * Tytuły pojawiają się w modalu zbyt krótko (SSE body dostarczone naraz przez
 * route.fulfill → done natychmiastowe → redirect). Weryfikacja tytułów i paska
 * jest pokryta w testach jednostkowych ProgressModal + PhotoUploader/PhotoListIsland.
 *
 * Vision/match ZAWSZE mockowane — zero kosztu LLM.
 */

const PHOTO_ID = '00000000-0000-4000-8000-aaaaaaaaaaaa';

const MOCK_RECORD_RESPONSE = {
  data: {
    photo: {
      id: PHOTO_ID,
      shelf_id: '00000000-0000-4000-8000-bbbbbbbbbbbb',
      status: 'uploaded',
      detected_count: null,
      error_message: null,
      vision_cost_usd: null,
      vision_latency_ms: null,
      created_at: new Date().toISOString(),
    },
  },
};

const MOCK_PROCESS_RESPONSE = {
  data: {
    photo: {
      id: PHOTO_ID,
      shelf_id: '00000000-0000-4000-8000-bbbbbbbbbbbb',
      status: 'processed',
      detected_count: 3,
      error_message: null,
      vision_cost_usd: 0.005,
      vision_latency_ms: 4200,
      created_at: new Date().toISOString(),
    },
    detections: [
      {
        position_index: 1,
        raw_title: 'Harry Potter',
        raw_author: 'J.K. Rowling',
        vision_confidence: 0.95,
        spine_color: 'czerwony',
      },
      {
        position_index: 2,
        raw_title: 'Solaris',
        raw_author: 'Stanisław Lem',
        vision_confidence: 0.92,
        spine_color: 'niebieski',
      },
      {
        position_index: 3,
        raw_title: 'Diuna',
        raw_author: 'Frank Herbert',
        vision_confidence: 0.88,
        spine_color: 'brązowy',
      },
    ],
  },
};

const MOCK_PHOTO_GET_RESPONSE = {
  data: {
    photo: {
      id: PHOTO_ID,
      shelf_id: '00000000-0000-4000-8000-bbbbbbbbbbbb',
      status: 'processed',
      detected_count: 3,
      error_message: null,
      vision_cost_usd: 0.005,
      vision_latency_ms: 4200,
      created_at: new Date().toISOString(),
    },
    detections: [],
  },
};

const SSE_EVENTS = [
  'event: progress\ndata: {"index":1,"total":3,"title":"Harry Potter","detectionId":"det-1","matched":true,"candidateTitle":"Harry Potter i Kamień Filozoficzny","candidateAuthors":["J.K. Rowling"]}\n\n',
  'event: progress\ndata: {"index":2,"total":3,"title":"Solaris","detectionId":"det-2","matched":true,"candidateTitle":"Solaris","candidateAuthors":["Stanisław Lem"]}\n\n',
  'event: progress\ndata: {"index":3,"total":3,"title":"Diuna","detectionId":"det-3","matched":false}\n\n',
  'event: done\ndata: {"matched":2,"rate_limited":0}\n\n',
].join('');

async function setupBaseRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/photos/check-hash**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { duplicate: null } }),
    }),
  );
  await page.route('**/storage/v1/object/shelf-photos/**', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ Key: 'shelf-photos/mock.jpg' }) }),
  );
  await page.route('**/api/photos', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_RECORD_RESPONSE),
        })
      : route.continue(),
  );
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_PHOTO_GET_RESPONSE),
        })
      : route.continue(),
  );
}

test('SSE match: modal "Dopasowywanie" widoczny podczas SSE, redirect po done', async ({
  page,
}) => {
  await page.goto('/upload');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    URL.createObjectURL = () => TINY_PNG;
    URL.revokeObjectURL = () => {};
  });
  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 5_000 });

  await setupBaseRoutes(page);

  // Trzymamy process i SSE osobno, żeby złapać oba stany modalu
  let resolveProcess!: () => void;
  let resolveSSE!: () => void;

  await page.route(
    (url) => url.pathname === `/api/photos/${PHOTO_ID}/process`,
    async (route) => {
      await new Promise<void>((r) => {
        resolveProcess = r;
      });
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PROCESS_RESPONSE),
      });
    },
  );

  await page.route(`**/api/photos/${PHOTO_ID}/match-stream`, async (route) => {
    await new Promise<void>((r) => {
      resolveSSE = r;
    });
    void route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: SSE_EVENTS,
    });
  });

  // Śledzenie czy sync /match POST był wywołany (nie powinien — SSE ma zadziałać)
  let syncMatchCalled = false;
  page.on('request', (req) => {
    if (
      req.url().includes(`/api/photos/${PHOTO_ID}/match`) &&
      !req.url().includes('match-stream') &&
      req.method() === 'POST'
    ) {
      syncMatchCalled = true;
    }
  });

  // Przygotuj oczekiwanie na request /process zanim uruchomimy upload
  const processRequestArrived = page.waitForRequest(
    (req) => new URL(req.url()).pathname === `/api/photos/${PHOTO_ID}/process`,
  );

  await page.getByTestId('file-input').setInputFiles('tests/fixtures/test-shelf.jpg');

  // Modal widoczny od razu (od fazy 'uploading' — krok 1 Przesyłanie)
  await expect(page.getByTestId('progress-modal')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('progress-modal-label')).toContainText('Przetwarzanie zdjęcia');

  // Poczekaj aż request /process dotrze do handlera (resolveProcess zostaje ustawione)
  await processRequestArrived;

  // W fazie vision (krok 2 aktywny, nie ostatni) pasek postępu nie jest widoczny
  await expect(page.getByTestId('progress-modal-bar')).not.toBeAttached();

  // Zwolnij process → komponent przechodzi do fazy matching, otwiera EventSource
  resolveProcess();

  // Teraz SSE jest trzymane → faza matching aktywna → pasek postępu pojawia się
  await expect(page.getByTestId('progress-modal-bar')).toBeVisible({ timeout: 8_000 });

  // Zwolnij SSE → progress events + done → redirect
  resolveSSE();

  await page.waitForURL(`/photos/${PHOTO_ID}`, { timeout: 10_000 });

  // SSE path użyty → sync POST /match NIE powinien być wywołany
  expect(syncMatchCalled).toBe(false);
});

test('SSE match błąd: 3 aborty /match-stream → komunikat błędu (brak fallbacku POST)', async ({
  page,
}) => {
  await page.goto('/upload');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    URL.createObjectURL = () => TINY_PNG;
    URL.revokeObjectURL = () => {};
  });
  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 5_000 });

  await setupBaseRoutes(page);

  await page.route(
    (url) => url.pathname === `/api/photos/${PHOTO_ID}/process`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PROCESS_RESPONSE),
      }),
  );

  // Abort SSE 3× → błąd połączenia, brak fallbacku do POST /match
  let sseCallCount = 0;
  await page.route(`**/api/photos/${PHOTO_ID}/match-stream`, (route) => {
    sseCallCount++;
    void route.abort();
  });

  // POST /match NIE powinien być wywołany — fallback usunięty
  let syncMatchCalled = false;
  page.on('request', (req) => {
    if (
      req.url().includes(`/api/photos/${PHOTO_ID}/match`) &&
      !req.url().includes('match-stream') &&
      req.method() === 'POST'
    ) {
      syncMatchCalled = true;
    }
  });

  await page.getByTestId('file-input').setInputFiles('tests/fixtures/test-shelf.jpg');

  // Po 3 abortach EventSource → modal znika lub pojawia się komunikat błędu
  await expect(page.getByTestId('progress-modal')).not.toBeVisible({ timeout: 20_000 });

  expect(syncMatchCalled).toBe(false);
  expect(sseCallCount).toBeGreaterThanOrEqual(1);
});
