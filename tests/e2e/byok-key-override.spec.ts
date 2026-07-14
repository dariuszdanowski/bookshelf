import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// per-call-byok-key-override — dropdown wyboru klucza BYOK per-wywołanie
// (refine / "Rozwiąż przez AI" / rerun-vision), jednorazowy override.
//
// Ryzyka pokrywane:
// - user z 2+ kluczami widzi dropdown, domyślnie zaznaczony aktywny
// - wybór innego klucza faktycznie trafia do body POST-a (apiKeyId)
// - user z 1 kluczem widzi listę 1-pozycyjną (decyzja po manualnej weryfikacji —
//   NIE ukrywanie; zob. commit message Fazy 3 / ApiKeySelect)
// - klucz usunięty tuż przed potwierdzeniem → czytelny błąd, brak crasha
// - 0 kluczy → refine/resolve disabled na kartach bez kandydatów (eager-fetch
//   gated by hasNoCandidates — jedyny bezpieczny punkt proaktywnego disable,
//   zob. komentarz "KRYTYCZNE" w useDetectionDecision). rerun-vision NIE ma
//   proaktywnego disable (świadomy kompromis — eager fetch na tym poziomie
//   łamał 37/46 testów DetectionReview.test.tsx), zostaje click-then-error.
// ---------------------------------------------------------------------------

const PHOTO_ID = '00000000-0000-4000-8000-0000000ab001';
const SHELF_ID = '00000000-0000-4000-8000-0000000ab002';
const DET_ID = '00000000-0000-4000-8000-0000000ab003';
const KEY_ACTIVE_ID = '00000000-0000-4000-8000-0000000ab010';
const KEY_OTHER_ID = '00000000-0000-4000-8000-0000000ab011';

const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const ACTIVE_KEY = {
  id: KEY_ACTIVE_ID,
  label: 'Klucz aktywny',
  provider: 'anthropic',
  model: null,
  base_url: null,
  is_active: true,
  last_tested_at: null,
  last_test_result: 'ok',
  created_at: '2026-01-01T00:00:00Z',
  request_timeout_ms: null,
  max_tokens_override: null,
};
const OTHER_KEY = {
  ...ACTIVE_KEY,
  id: KEY_OTHER_ID,
  label: 'Klucz zapasowy',
  provider: 'openai_compatible',
  model: 'gpt-4o-mini',
  base_url: 'https://relay.example.com',
  is_active: false,
};
const TWO_KEYS = [ACTIVE_KEY, OTHER_KEY];
const ONE_KEY = [ACTIVE_KEY];

function photoResponseBody() {
  return {
    data: {
      photo: {
        id: PHOTO_ID,
        shelf_id: SHELF_ID,
        status: 'processed',
        detected_count: 1,
        error_message: null,
        vision_cost_usd: 0.01,
        vision_latency_ms: 2000,
        created_at: '2026-06-01T10:00:00Z',
      },
      photo_url: TINY_GIF,
      // bbox obecny (RefineButton) + candidates puste (AiResolutionButton) —
      // pozwala pokazać oba dialogi na tej samej karcie (wzorzec force-refine.spec.ts).
      detections: [
        {
          id: DET_ID,
          position_index: 1,
          raw_title: 'Książka testowa',
          raw_author: null,
          vision_confidence: 0.8,
          spine_color: null,
          bbox: { x1: 0.05, y1: 0.02, x2: 0.15, y2: 0.4 },
          status: 'pending',
          candidates: [],
          duplicate: null,
        },
      ],
      vision_run: {
        id: '00000000-0000-4000-8000-0000000ab099',
        model: 'claude-sonnet-4-6',
        created_at: '2026-06-01T10:00:00Z',
        cost_usd: 0.01,
        latency_ms: 2000,
      },
    },
  };
}

async function setupBaseRoutes(page: Page, keys: typeof TWO_KEYS) {
  await page.route(`**/api/photos/${PHOTO_ID}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(photoResponseBody()),
    });
  });
  await page.route('**/api/account/keys', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { keys } }),
    });
  });
}

async function gotoPhoto(page: Page) {
  await page.goto(`/photos/${PHOTO_ID}`);
  await expect(page.getByTestId('detection-review')).toBeVisible({ timeout: 10_000 });
}

test.describe('BYOK key override — 2 klucze', () => {
  test.beforeEach(async ({ page }) => {
    await setupBaseRoutes(page, TWO_KEYS);
  });

  test('refine — dropdown widoczny, domyślnie aktywny klucz zaznaczony', async ({ page }) => {
    await gotoPhoto(page);
    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('refine-button').click();
    const select = page.getByTestId('api-key-select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue(KEY_ACTIVE_ID);
  });

  test('refine — wybór innego klucza wysyła apiKeyId w body', async ({ page }) => {
    let capturedBody: unknown = null;
    await page.route(
      (url) => url.pathname === `/api/detections/${DET_ID}/refine`,
      async (route) => {
        capturedBody = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { applied: false, message: 'no-op' } }),
        });
      },
    );

    await gotoPhoto(page);
    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('refine-button').click();
    await page.getByTestId('api-key-select').selectOption(KEY_OTHER_ID);
    const refinePromise = page.waitForResponse(
      (r) => r.url().includes(`/detections/${DET_ID}/refine`) && r.request().method() === 'POST',
    );
    await page.getByTestId('refine-confirm-confirm').click();
    await refinePromise;
    expect(capturedBody).toMatchObject({ apiKeyId: KEY_OTHER_ID });
  });

  test('resolve — dropdown widoczny, domyślnie aktywny klucz zaznaczony', async ({ page }) => {
    await gotoPhoto(page);
    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('ai-resolution-button').click();
    const select = page.getByTestId('api-key-select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue(KEY_ACTIVE_ID);
  });

  test('resolve — wybór innego klucza wysyła apiKeyId w body', async ({ page }) => {
    let capturedBody: unknown = null;
    await page.route(
      (url) => url.pathname === `/api/detections/${DET_ID}/resolve`,
      async (route) => {
        capturedBody = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { applied: false, resolution: { status: 'not_found', reason: 'brak' } },
          }),
        });
      },
    );

    await gotoPhoto(page);
    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('ai-resolution-button').click();
    await page.getByTestId('api-key-select').selectOption(KEY_OTHER_ID);
    const resolvePromise = page.waitForResponse(
      (r) => r.url().includes(`/detections/${DET_ID}/resolve`) && r.request().method() === 'POST',
    );
    await page.getByTestId('ai-resolution-confirm-confirm').click();
    await resolvePromise;
    expect(capturedBody).toMatchObject({ apiKeyId: KEY_OTHER_ID });
  });

  test('rerun-vision — dropdown widoczny, wybór innego klucza wysyła apiKeyId w body', async ({
    page,
  }) => {
    let capturedBody: unknown = null;
    await page.route(
      (url) => url.pathname === `/api/photos/${PHOTO_ID}/process`,
      async (route) => {
        capturedBody = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
          body: `event: started\ndata: {}\n\nevent: done\ndata: ${JSON.stringify(photoResponseBody().data)}\n\n`,
        });
      },
    );
    await page.route(`**/api/photos/${PHOTO_ID}/match-stream**`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: 'event: done\ndata: {"matched":0,"rate_limited":0}\n\n',
      });
    });

    await gotoPhoto(page);
    await page.getByTestId('rerun-vision-button').click();
    const select = page.getByTestId('api-key-select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue(KEY_ACTIVE_ID);

    await select.selectOption(KEY_OTHER_ID);
    const processPromise = page.waitForResponse(
      (r) => r.url().includes(`/photos/${PHOTO_ID}/process`) && r.request().method() === 'POST',
    );
    await page.getByTestId('rerun-vision-confirm-confirm').click();
    await processPromise;
    expect(capturedBody).toMatchObject({ apiKeyId: KEY_OTHER_ID });
  });
});

test.describe('BYOK key override — 1 klucz (lista 1-pozycyjna)', () => {
  test.beforeEach(async ({ page }) => {
    await setupBaseRoutes(page, ONE_KEY);
  });

  test('refine — dropdown widoczny z jedną opcją oznaczoną "✓ aktywny"', async ({ page }) => {
    await gotoPhoto(page);
    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('refine-button').click();
    const select = page.getByTestId('api-key-select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue(KEY_ACTIVE_ID);
    const options = select.locator('option');
    await expect(options).toHaveCount(1);
    // Natywne <option> nie są "visible" dla Playwrighta — asercja przez textContent.
    await expect(options.first()).toHaveText(
      `${ACTIVE_KEY.label} (${ACTIVE_KEY.provider}) ✓ aktywny`,
    );
  });

  test('resolve — dropdown widoczny z jedną opcją oznaczoną "✓ aktywny"', async ({ page }) => {
    await gotoPhoto(page);
    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('ai-resolution-button').click();
    const select = page.getByTestId('api-key-select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(1);
  });

  test('rerun-vision — dropdown widoczny, komunikat zawiera etykietę klucza', async ({ page }) => {
    await gotoPhoto(page);
    await page.getByTestId('rerun-vision-button').click();
    await expect(page.getByTestId('rerun-vision-confirm')).toBeVisible();
    await expect(page.getByTestId('api-key-select')).toBeVisible();
    await expect(page.getByTestId('rerun-vision-confirm')).toContainText(ACTIVE_KEY.label);
  });
});

test.describe('BYOK key override — 0 kluczy (przyciski disabled)', () => {
  test('refine i resolve — disabled na karcie bez kandydatów (eager-fetch gated)', async ({
    page,
  }) => {
    await setupBaseRoutes(page, []);
    await gotoPhoto(page);
    const card = page.getByTestId('detection-card-1');
    // Karta testowa ma candidates: [] → hasNoCandidates=true → eager fetch
    // cardKeys już przy mount, disabled widoczny bez potrzeby klikania.
    await expect(card.getByTestId('refine-button')).toBeDisabled({ timeout: 5_000 });
    await expect(card.getByTestId('ai-resolution-button')).toBeDisabled({ timeout: 5_000 });
    await expect(card.getByTestId('refine-button')).toHaveAttribute('title', /Brak klucza API/);
  });
});

test.describe('BYOK key override — klucz usunięty tuż przed potwierdzeniem', () => {
  test('refine — 404 z backendu pokazuje czytelny błąd, brak crasha', async ({ page }) => {
    await setupBaseRoutes(page, TWO_KEYS);
    await page.route(
      (url) => url.pathname === `/api/detections/${DET_ID}/refine`,
      async (route) => {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'NOT_FOUND', message: 'Wybrany klucz nie istnieje.' },
          }),
        });
      },
    );

    await gotoPhoto(page);
    const card = page.getByTestId('detection-card-1');
    await card.getByTestId('refine-button').click();
    await page.getByTestId('api-key-select').selectOption(KEY_OTHER_ID);
    await page.getByTestId('refine-confirm-confirm').click();

    await expect(card.getByTestId('detection-error')).toBeVisible({ timeout: 5_000 });
    // Handler czyta error.message z backendu (bardziej użyteczne niż generyczny
    // "Błąd refine (404)" fallback) — dokładnie treść z NOT_FOUND w resolve.ts/refine.ts.
    await expect(card.getByTestId('detection-error')).toContainText('Wybrany klucz nie istnieje.');
    // Karta pozostaje w stanie 'pending' — brak crasha, przyciski nadal aktywne.
    await expect(card.getByTestId('refine-button')).toBeEnabled();
  });
});
