import { test, expect } from '@playwright/test';

const PHOTO_ID = 'cf42bf3a-0000-4000-8000-000000000001';
const DET_ID = '00000000-0000-4000-8000-000000000020';

const MOCK_DETECTION_NO_CANDIDATES = {
  id: DET_ID,
  position_index: 1,
  raw_title: 'Poraniona blyskawica',
  raw_author: null,
  vision_confidence: 0.7,
  spine_color: null,
  bbox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.9 },
  status: 'pending',
  candidates: [],
  duplicate: null,
};

const MOCK_REMATCH_RESULT = {
  id: '00000000-0000-4000-8000-000000000030',
  source: 'google_books',
  externalId: 'gb-1',
  title: 'Przerwana kołysanka',
  authors: ['Natasza Socha'],
  isbn10: null,
  isbn13: '9788383100012',
  publisher: null,
  publishedYear: 2022,
  coverUrl: null,
  matchScore: 0.95,
  rank: 1,
};

test.describe('manual rematch — szukaj po tytule', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/api/photos/${PHOTO_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            photo: { id: PHOTO_ID, shelf_id: 'shelf-1', status: 'processed', detected_count: 1, error_message: null, vision_cost_usd: 0.005, vision_latency_ms: 3000, created_at: new Date().toISOString() },
            photo_url: 'https://example.com/shelf.jpg',
            detections: [MOCK_DETECTION_NO_CANDIDATES],
            vision_run: { id: 'vr-1', model: 'claude-sonnet-4-6', created_at: new Date().toISOString(), cost_usd: 0.005, latency_ms: 3000 },
          },
        }),
      })
    );
    await page.goto(`/photos/${PHOTO_ID}`);
    await page.waitForSelector('[data-testid="no-match-placeholder"]');
  });

  test('przycisk Szukaj po tytule jest widoczny dla detekcji bez kandydatów', async ({ page }) => {
    await expect(page.getByTestId('rematch-button').first()).toBeVisible();
  });

  test('kliknięcie Szukaj otwiera formularz z pre-wypełnionym tytułem', async ({ page }) => {
    await page.getByTestId('rematch-button').first().click();
    await expect(page.getByTestId('rematch-form')).toBeVisible();
    const titleInput = page.getByTestId('rematch-title');
    await expect(titleInput).toHaveValue('Poraniona blyskawica');
  });

  test('po wyszukaniu z wynikami kandydat pojawia się w karcie', async ({ page }) => {
    await page.route(`**/api/detections/${DET_ID}/rematch`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            applied: true,
            detection: { id: DET_ID, status: 'matched', raw_title: 'Przerwana kołysanka', raw_author: 'Natasza Socha' },
            candidates: [MOCK_REMATCH_RESULT],
            duplicate: null,
          },
        }),
      })
    );

    await page.getByTestId('rematch-button').first().click();
    const titleInput = page.getByTestId('rematch-title');
    await titleInput.fill('Przerwana kołysanka');
    await page.getByTestId('rematch-author').fill('Natasza Socha');
    await page.getByTestId('rematch-submit').click();

    await expect(page.getByTestId('no-match-placeholder')).not.toBeVisible();
    await expect(page.getByText('Przerwana kołysanka').first()).toBeVisible();
  });

  test('brak wyników pokazuje komunikat i zamyka formularz', async ({ page }) => {
    await page.route(`**/api/detections/${DET_ID}/rematch`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { applied: false, detection: { id: DET_ID, status: 'pending', raw_title: 'xyz nieznany', raw_author: null }, candidates: [], duplicate: null },
        }),
      })
    );

    await page.getByTestId('rematch-button').first().click();
    await page.getByTestId('rematch-title').fill('xyz nieznany');
    await page.getByTestId('rematch-submit').click();

    await expect(page.getByTestId('rematch-form')).not.toBeVisible();
    await expect(page.getByTestId('rematch-no-results')).toBeVisible();
  });

  test('Anuluj zamyka formularz bez wywołania API', async ({ page }) => {
    let rematchCalled = false;
    await page.route(`**/api/detections/${DET_ID}/rematch`, () => { rematchCalled = true; });

    await page.getByTestId('rematch-button').first().click();
    await expect(page.getByTestId('rematch-form')).toBeVisible();
    await page.getByTestId('rematch-cancel').click();
    await expect(page.getByTestId('rematch-form')).not.toBeVisible();
    expect(rematchCalled).toBe(false);
  });
});
