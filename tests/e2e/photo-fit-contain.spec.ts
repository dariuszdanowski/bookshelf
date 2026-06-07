import fs from 'node:fs';

import { expect, test } from '@playwright/test';

/**
 * E2E dla M24 (uwagi round 3, 2026-06-07): pionowe zdjęcie (pojedyncza
 * książka z telefonu, 9:16) renderowało się fit-to-width — na desktopie
 * ~3× wyżej niż okno podglądu (max-h-72vh) i wymagało scrolla wewnątrz
 * ramki, "obrazek zajmuje więcej niż ekran".
 *
 * Po fixie: zoom=1 to fit-to-CONTAINER (contain) — całe zdjęcie widoczne
 * od wejścia; zoom +/- nadal działa ponad bazową skalą.
 *
 * API + obraz mockowane przez page.route — zero realnego Storage/vision.
 */

const PHOTO_ID = '00000000-0000-4000-8000-242400000024';
const IMG_PATH = '/mock-storage/portrait-book.png';

function makePhotoGet() {
  return {
    data: {
      photo: {
        id: PHOTO_ID,
        shelf_id: null,
        status: 'processed',
        detected_count: 1,
        error_message: null,
        vision_cost_usd: 0.01,
        vision_latency_ms: 9000,
        created_at: '2026-06-07T10:00:00Z',
      },
      photo_url: IMG_PATH,
      detections: [
        {
          id: '00000000-0000-4000-8000-2424000d0001',
          position_index: 1,
          raw_title: 'Zaleca się kota',
          raw_author: null,
          vision_confidence: 0.9,
          spine_color: null,
          bbox: { x1: 0.17, y1: 0.3, x2: 0.83, y2: 0.88 },
          status: 'matched',
          candidates: [],
          duplicate: null,
        },
      ],
      vision_run: null,
    },
  };
}

async function setupMocks(page: import('@playwright/test').Page) {
  const png = fs.readFileSync('tests/fixtures/test-portrait-9x16.png');
  await page.route(`**${IMG_PATH}`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  );
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makePhotoGet()),
      });
    } else {
      void route.continue();
    }
  });
}

const IMG_SELECTOR = 'img[alt="Zdjęcie półki z wykrytymi książkami"]';

test('M24: portret na desktopie mieści się w oknie podglądu (fit-contain)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupMocks(page);
  await page.goto(`/photos/${PHOTO_ID}`);

  const img = page.locator(IMG_SELECTOR).first();
  await expect(img).toBeVisible({ timeout: 10_000 });
  // poczekaj aż fitScale policzony po onLoad (width warstwy < 50% kontenera)
  await expect
    .poll(async () => {
      return img.evaluate((el) => {
        const viewport = el.closest('[data-testid="photo-overlay-viewport"]')!;
        return el.getBoundingClientRect().height / viewport.getBoundingClientRect().height;
      });
    })
    .toBeLessThanOrEqual(1);

  const m = await img.evaluate((el) => {
    const viewport = el.closest('[data-testid="photo-overlay-viewport"]')!;
    const vb = viewport.getBoundingClientRect();
    const ib = el.getBoundingClientRect();
    return {
      vH: vb.height,
      iH: ib.height,
      iW: ib.width,
      scrollH: viewport.scrollHeight,
      clientH: viewport.clientHeight,
    };
  });

  // całe zdjęcie w oknie: wysokość obrazu ≤ okna, brak wewnętrznego scrolla
  expect(m.iH).toBeLessThanOrEqual(m.vH);
  // +2px tolerancja na subpixel rounding scrollHeight vs clientHeight
  expect(m.scrollH).toBeLessThanOrEqual(m.clientH + 2);
  // proporcje zachowane (9:16, nie rozciągnięte na szerokość)
  expect(m.iW / m.iH).toBeCloseTo(756 / 1344, 1);
});

test('M24: zoom + nadal powiększa ponad bazowy fit (scroll wraca)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupMocks(page);
  await page.goto(`/photos/${PHOTO_ID}`);

  const img = page.locator(IMG_SELECTOR).first();
  await expect(img).toBeVisible({ timeout: 10_000 });
  const before = await img.evaluate((el) => el.getBoundingClientRect().width);

  await page.getByTestId('zoom-in-button').click();
  await page.getByTestId('zoom-in-button').click();

  await expect
    .poll(async () => img.evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(before * 1.3);

  const overflows = await img.evaluate((el) => {
    const viewport = el.closest('[data-testid="photo-overlay-viewport"]')!;
    return viewport.scrollHeight > viewport.clientHeight;
  });
  expect(overflows).toBe(true);
});

test('M24: mobile — portret nadal mieści się jak dotąd (anty-regres)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupMocks(page);
  await page.goto(`/photos/${PHOTO_ID}`);

  const img = page.locator(IMG_SELECTOR).first();
  await expect(img).toBeVisible({ timeout: 10_000 });

  const m = await img.evaluate((el) => {
    const viewport = el.closest('[data-testid="photo-overlay-viewport"]')!;
    return {
      vH: viewport.getBoundingClientRect().height,
      iH: el.getBoundingClientRect().height,
    };
  });
  expect(m.iH).toBeLessThanOrEqual(m.vH);
});
