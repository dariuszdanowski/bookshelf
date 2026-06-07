import { expect, test } from '@playwright/test';

/**
 * E2E dla S-42 camera-capture:
 *  1. Przycisk „Zrób zdjęcie" widoczny na /upload.
 *  2. input[capture="environment"] obecny w DOM (mobile path).
 *  3. Desktop path: kliknięcie → CameraPreview → capture → onCapture → upload startuje.
 *  4. Przycisk „Anuluj" zamyka CameraPreview bez uploadu.
 *  5. Permission denied → error message inline.
 *
 * Chromium otrzymuje --use-fake-device-for-media-stream + --use-fake-ui-for-media-stream
 * przez launchOptions w playwright.config.ts — brak realnego hardware kamery.
 * Upload endpoint mockowany przez page.route — zero side-effectów w DB.
 *
 * Synchronizacja hydratacji: przycisk ma data-camera-mode="desktop|mobile" ustawiany przez
 * useEffect po rozpoznaniu navigator.mediaDevices.getUserMedia. Testy czekają na tę wartość
 * przed kliknięciem (eliminuje race z React useEffect).
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
  await page.route('/api/photos', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_UPLOAD) });
    } else {
      route.continue();
    }
  });
  await page.route('/api/photos/*/process', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { status: 'processed', detections: [] } }),
    }),
  );
}

/** Czeka aż useEffect dla feature-detection ustawi data-camera-mode="desktop". */
async function waitForDesktopCameraMode(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="camera-capture-btn"][data-camera-mode="desktop"]');
}

test('przycisk "Zrób zdjęcie" widoczny na stronie upload', async ({ page }) => {
  await page.goto('/upload');
  await expect(page.getByTestId('camera-capture-btn')).toBeVisible();
});

test('mobile path: input z capture="environment" obecny w DOM', async ({ page }) => {
  await page.goto('/upload');
  const cameraInput = page.getByTestId('camera-input');
  await expect(cameraInput).toBeAttached();
  expect(await cameraInput.getAttribute('capture')).toBe('environment');
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
    route.continue();
  });

  await page.goto('/upload');
  await waitForDesktopCameraMode(page);
  await page.getByTestId('camera-capture-btn').click();

  const preview = page.getByTestId('camera-preview');
  await expect(preview).toBeVisible();

  await page.getByTestId('camera-preview-cancel').click();
  await expect(preview).not.toBeVisible();

  await page.waitForTimeout(300);
  expect(uploadCalled).toBe(false);
});

test('permission denied: wyświetla komunikat błędu inline', async ({ page }) => {
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
