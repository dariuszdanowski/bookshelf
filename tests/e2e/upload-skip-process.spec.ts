import { expect, test } from '@playwright/test';

/**
 * E2E spec dla S-36: upload zdjęcia bez uruchamiania vision.
 *
 * Ryzyka pokryte:
 *  - odznaczony checkbox „Analizuj od razu" → upload kończy się BEZ żadnego
 *    requestu do /process i /match (twardy guardrail kosztowy — asercja na
 *    przechwyconych requestach)
 *  - redirect ląduje na zakładce Zdjęcia (`?tab=photos`) z wierszem zdjęcia
 *    i akcją „Uruchom vision"
 *  - preferencja checkboxa przeżywa reload (localStorage)
 *
 * Storage/API mockowane przez page.route — zero realnego vision/Storage.
 */

const PHOTO_ID = '00000000-0000-4000-8000-363636363636';

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

function mockUploadedPhotoList() {
  return {
    data: {
      photos: [
        {
          id: PHOTO_ID,
          status: 'uploaded',
          stage: 'uploaded',
          created_at: new Date().toISOString(),
          thumbnail_url: null,
          detected_count: null,
          matched_count: 0,
          confirmed_count: 0,
          latest_vision_run: null,
          has_running_run: false,
          legacy_no_hash: false,
        },
      ],
    },
  };
}

test('S-36: odznaczony checkbox → upload bez /process i /match, lądowanie na tabie Zdjęcia', async ({
  page,
}) => {
  // Twardy guardrail: zbieramy KAŻDY request do process/match
  const visionRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/process') || req.url().includes('/match')) {
      visionRequests.push(req.url());
    }
  });

  await page.goto('/upload');
  await expect(page.getByTestId('photo-uploader')).toBeVisible();
  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 5_000 });
  const shelfId = await page.getByTestId('shelf-select').inputValue();

  // Odznacz „Analizuj od razu"
  const checkbox = page.getByTestId('auto-process-checkbox');
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();

  // Mocki: Storage + record + lista zdjęć/książek półki docelowej
  await page.route('**/storage/v1/object/shelf-photos/**', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ Key: 'shelf-photos/mock.jpg' }) }),
  );
  await page.route('**/api/photos', (route) => {
    if (route.request().method() === 'POST') {
      void route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_RECORD_RESPONSE),
      });
    } else {
      void route.continue();
    }
  });
  await page.route(`**/api/shelves/${shelfId}/photos`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockUploadedPhotoList()),
    }),
  );
  await page.route(`**/api/shelves/${shelfId}/books`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: [] } }),
    }),
  );

  await page.getByTestId('file-input').setInputFiles('tests/fixtures/test-shelf.jpg');

  // Redirect na zakładkę Zdjęcia
  await page.waitForURL(`**/shelves/${shelfId}?tab=photos`, { timeout: 15_000 });
  await expect(page.getByTestId('shelf-tab-photos')).toHaveAttribute('aria-selected', 'true', {
    timeout: 10_000,
  });

  // Wiersz zdjęcia w stanie uploaded z akcją ręcznego uruchomienia vision
  await expect(page.getByText('Uruchom vision')).toBeVisible({ timeout: 10_000 });

  // ZERO wywołań vision/match podczas całego flow
  expect(visionRequests).toEqual([]);
});

test('S-36: preferencja checkboxa przeżywa reload (localStorage)', async ({ page }) => {
  await page.goto('/upload');
  // shelf-select pojawia się dopiero po hydratacji + fetchu półek — dopiero
  // wtedy handler checkboxa jest podpięty (uncheck przed hydratacją ginie)
  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 10_000 });

  const checkbox = page.getByTestId('auto-process-checkbox');
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();

  await page.reload();
  await expect(page.getByTestId('shelf-select')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('auto-process-checkbox')).not.toBeChecked({ timeout: 10_000 });

  // przywróć default — nie zostawiamy stanu dla innych testów w tym samym storageState
  await page.getByTestId('auto-process-checkbox').check();
});
