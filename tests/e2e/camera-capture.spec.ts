import { expect, test } from '@playwright/test';

/**
 * E2E dla S-42 camera-capture:
 *  1. Przycisk „Zrób zdjęcie" widoczny na /upload.
 *  2. input[capture="environment"] obecny w DOM (mobile path).
 *  3. Desktop path: kliknięcie → CameraPreview → capture → onCapture → upload startuje.
 *  4. Przycisk „Anuluj" zamyka CameraPreview bez uploadu.
 *  5. Permission denied → error message inline.
 *  6. Touch device (pointer: coarse) → dispatch na natywny input, nie CameraPreview.
 *
 * Chromium otrzymuje --use-fake-device-for-media-stream + --use-fake-ui-for-media-stream
 * przez launchOptions w playwright.config.ts — brak realnego hardware kamery.
 * WSZYSTKIE boundaries mockowane przez page.route (API + Supabase Storage) —
 * zero side-effectów w DB i Storage (fix impl-review F3: wcześniej przechwycona
 * klatka realnie lądowała w buckecie z .dev.vars).
 *
 * Synchronizacja hydratacji: przycisk ma data-camera-mode="desktop|mobile" ustawiany przez
 * useEffect po feature-detection. Testy czekają na tę wartość przed kliknięciem.
 */

const MOCK_SHELVES = {
  data: {
    shelves: [
      {
        id: '00000000-0000-4000-8000-bbbbbbbbbbbb',
        name: 'Salon',
        location: null,
        position_index: 0,
        created_at: new Date().toISOString(),
      },
    ],
  },
};

const MOCK_KEYS = { data: { keys: [{ is_active: true }] } };

const PHOTO_ID = '00000000-0000-4000-8000-aaaaaaaaaaaa';

const MOCK_UPLOAD = {
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

async function mockUploadRoutes(page: import('@playwright/test').Page) {
  await page.route('/api/shelves', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_SHELVES) }),
  );
  await page.route('/api/account/keys', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_KEYS) }),
  );
  // Dedup check — brak duplikatu, flow idzie do uploadu.
  await page.route('/api/photos/check-hash**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { photo: null } }),
    }),
  );
  // Supabase Storage — przechwycona klatka NIE trafia do realnego bucketa.
  await page.route('**/storage/v1/object/shelf-photos/**', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ Key: 'shelf-photos/mock-path.jpg' }) }),
  );
  await page.route('/api/photos', (route) => {
    if (route.request().method() === 'POST') {
      void route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_UPLOAD) });
    } else {
      void route.fallback();
    }
  });
  await page.route('/api/photos/*/process', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { status: 'processed', detections: [] } }),
    }),
  );
  await page.route('/api/photos/*/match', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { matched: 0, detections: [] } }),
    }),
  );
}

/** Czeka aż useEffect dla feature-detection ustawi data-camera-mode="desktop". */
async function waitForDesktopCameraMode(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('camera-capture-btn')).toHaveAttribute(
    'data-camera-mode',
    'desktop',
  );
}

test('przycisk "Zrób zdjęcie" widoczny na stronie upload', async ({ page }) => {
  await mockUploadRoutes(page);
  await page.goto('/upload');
  await expect(page.getByTestId('camera-capture-btn')).toBeVisible();
});

test('mobile path: input z capture="environment" obecny w DOM', async ({ page }) => {
  await mockUploadRoutes(page);
  await page.goto('/upload');
  const cameraInput = page.getByTestId('camera-input');
  await expect(cameraInput).toBeAttached();
  await expect(cameraInput).toHaveAttribute('capture', 'environment');
});

test('desktop path: capture zamyka CameraPreview i startuje upload', async ({ page }) => {
  await mockUploadRoutes(page);

  const uploadRequest = page.waitForRequest(
    (req) => req.url().includes('/api/photos') && req.method() === 'POST',
  );

  await page.goto('/upload');
  await waitForDesktopCameraMode(page);
  await page.getByTestId('camera-capture-btn').click();

  const preview = page.getByTestId('camera-preview');
  await expect(preview).toBeVisible();

  // Czekaj na gotowość kamery (onLoadedMetadata → ready → button enabled)
  await expect(page.getByTestId('camera-preview-take')).toBeEnabled({ timeout: 10_000 });

  await page.getByTestId('camera-preview-take').click();

  // CameraPreview znika — onCapture wywołany (canvas.toBlob zwróciło blob)
  await expect(preview).not.toBeVisible();

  // Upload został zainicjowany
  await uploadRequest;
});

test('anulowanie CameraPreview zamyka podgląd bez uploadu', async ({ page }) => {
  await mockUploadRoutes(page);

  let uploadCalled = false;
  await page.route('/api/photos', (route) => {
    if (route.request().method() === 'POST') uploadCalled = true;
    void route.fallback();
  });

  await page.goto('/upload');
  await waitForDesktopCameraMode(page);
  await page.getByTestId('camera-capture-btn').click();

  const preview = page.getByTestId('camera-preview');
  await expect(preview).toBeVisible();

  await page.getByTestId('camera-preview-cancel').click();
  await expect(preview).not.toBeVisible();

  // Deterministyczne dowody powrotu do idle (bez waitForTimeout — E2E rules):
  // drop-zone z powrotem widoczna, progress nie wystartował.
  await expect(page.getByTestId('drop-zone')).toBeVisible();
  await expect(page.getByTestId('progress-area')).not.toBeVisible();
  expect(uploadCalled).toBe(false);
});

test('permission denied: wyświetla komunikat błędu inline', async ({ page }) => {
  await mockUploadRoutes(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: () =>
          Promise.reject(
            Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
          ),
      },
      writable: true,
      configurable: true,
    });
  });

  await page.goto('/upload');
  await waitForDesktopCameraMode(page);
  await page.getByTestId('camera-capture-btn').click();

  await expect(page.getByTestId('camera-preview-error')).toBeVisible();
});

test.describe('touch device (pointer: coarse)', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('„Zrób zdjęcie" dispatchuje do natywnego inputu, nie CameraPreview', async ({ page }) => {
    await mockUploadRoutes(page);
    await page.goto('/upload');

    // Fix impl-review F6: na touch device getUserMedia istnieje (HTTPS),
    // ale preferujemy natywny aparat — data-camera-mode musi być "mobile".
    await expect(page.getByTestId('camera-capture-btn')).toHaveAttribute(
      'data-camera-mode',
      'mobile',
    );

    await page.getByTestId('camera-capture-btn').click();
    // CameraPreview NIE otwiera się — ścieżka idzie przez input[capture].
    await expect(page.getByTestId('camera-preview')).not.toBeVisible();
  });
});
