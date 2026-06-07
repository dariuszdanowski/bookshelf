import { expect, test } from '@playwright/test';

/**
 * E2E dla S-41: interaktywny widok analizy kosztów na /account.
 *
 * Ryzyko: modal kosztów musi otwierać się zarówno z przycisku „Szczegóły"
 * jak i z chipa klucza (z prefiltrem), filtry i paginacja muszą generować
 * poprawne parametry fetch, a link „Zdjęcie" prowadzić do właściwej strony.
 *
 * Wszystkie wywołania /api/account/* mockowane — zero realnych LLM/DB.
 */

// Fix impl-review F3: fixtures muszą być walidnymi UUID (hex) — realny endpoint
// waliduje `key` przez CostEventsQuerySchema; nie-hex 'k1' przeszedłby tylko
// dlatego, że route jest w pełni zmockowany (contract-incompatible dane).
const MOCK_KEY = {
  id: '00000000-0000-4000-8000-0000000000a1',
  label: 'Anthropic',
  provider: 'anthropic' as const,
  model: null,
  base_url: null,
  is_active: true,
  last_tested_at: null,
  last_test_result: null,
  created_at: '2026-06-01T10:00:00.000Z',
};

const PHOTO_ID = '00000000-0000-4000-8000-000000000aa1';

const VISION_ITEM = {
  id: '10000000-0000-4000-8000-000000000001',
  kind: 'vision',
  model: 'claude-3-5-sonnet',
  cost_usd: 0.01,
  latency_ms: 1200,
  created_at: '2026-06-01T10:00:00Z',
  api_key_id: MOCK_KEY.id,
  photo_id: PHOTO_ID,
  detection_id: null,
  raw_title: null,
};

const REFINE_ITEM = {
  id: '10000000-0000-4000-8000-000000000002',
  kind: 'refine',
  model: 'claude-3-5-sonnet',
  cost_usd: 0.002,
  latency_ms: 800,
  created_at: '2026-06-01T09:00:00Z',
  api_key_id: null,
  photo_id: null,
  detection_id: '20000000-0000-4000-8000-000000000001',
  raw_title: 'Pan Tadeusz',
};

function makeCostsResponse(
  items: (typeof VISION_ITEM | typeof REFINE_ITEM)[],
  totalCount?: number,
) {
  return {
    data: {
      items,
      page: 1,
      page_size: 25,
      total_count: totalCount ?? items.length,
      total_cost_usd: items.reduce((s, i) => s + (i.cost_usd ?? 0), 0),
    },
  };
}

/** Montuje podstawowe mocki dla /account (stats + keys + costs). */
async function setupAccountRoutes(
  page: import('@playwright/test').Page,
  costsBody: unknown = makeCostsResponse([VISION_ITEM, REFINE_ITEM]),
) {
  await page.route('**/api/account/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          total_vision_cost_usd: 0.01,
          total_refine_cost_usd: 0.002,
          vision_run_count: 1,
          refine_call_count: 1,
          cost_by_key: { [MOCK_KEY.id]: { cost_usd: 0.01, call_count: 1 } },
        },
      }),
    }),
  );

  await page.route('**/api/account/keys', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { keys: [MOCK_KEY] } }),
    });
  });

  await page.route('**/api/account/costs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(costsBody),
    }),
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Czeka, aż AccountIsland zakończy hydratację i załaduje statystyki. */
async function waitForAccountReady(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('account-stats-loading')).not.toBeVisible({ timeout: 5_000 });
}

// ─── testy ──────────────────────────────────────────────────────────────────

test('(1) przycisk „Szczegóły" otwiera modal z wierszami', async ({ page }) => {
  await setupAccountRoutes(page);
  await page.goto('/account');

  await waitForAccountReady(page);
  await page.getByTestId('account-costs-details-btn').click();

  const modal = page.getByTestId('cost-analysis-modal');
  await expect(modal).toBeVisible();

  // wiersze vision i OCR — sprawdzamy po testId wiersza, nie po tekście (Vision
  // pojawia się też w filterze, co powoduje strict-mode violation przy getByText)
  await expect(modal.getByTestId(`cost-event-row-${VISION_ITEM.id}`)).toBeVisible();
  await expect(modal.getByTestId(`cost-event-row-${REFINE_ITEM.id}`)).toBeVisible();
});

test('(2) chip klucza otwiera modal z prefiltrem na klucz', async ({ page }) => {
  const costRequests: string[] = [];

  await page.route('**/api/account/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          total_vision_cost_usd: 0.01,
          total_refine_cost_usd: 0,
          vision_run_count: 1,
          refine_call_count: 0,
          cost_by_key: { [MOCK_KEY.id]: { cost_usd: 0.01, call_count: 1 } },
        },
      }),
    }),
  );

  await page.route('**/api/account/keys', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { keys: [MOCK_KEY] } }),
    });
  });

  await page.route('**/api/account/costs**', (route) => {
    costRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeCostsResponse([VISION_ITEM])),
    });
  });

  await page.goto('/account');
  await waitForAccountReady(page);

  // Poczekaj na załadowanie kluczy
  await expect(page.getByTestId(`account-key-cost-${MOCK_KEY.id}`)).toBeVisible({ timeout: 5_000 });
  await page.getByTestId(`account-key-cost-${MOCK_KEY.id}`).click();

  const modal = page.getByTestId('cost-analysis-modal');
  await expect(modal).toBeVisible();

  // request musi zawierać key=<id>
  await expect
    .poll(() => costRequests.some((u) => u.includes(`key=${MOCK_KEY.id}`)), { timeout: 5_000 })
    .toBe(true);

  // select klucza pokazuje label „Anthropic"
  const keySelect = modal.getByTestId('cost-filter-key');
  await expect(keySelect).toHaveValue(MOCK_KEY.id);
});

test('(3) zmiana filtra typu → refetch z type=refine', async ({ page }) => {
  const costRequests: string[] = [];

  await page.route('**/api/account/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          total_vision_cost_usd: 0,
          total_refine_cost_usd: 0,
          vision_run_count: 0,
          refine_call_count: 0,
        },
      }),
    }),
  );
  await page.route('**/api/account/keys', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { keys: [MOCK_KEY] } }),
    });
  });
  await page.route('**/api/account/costs**', (route) => {
    costRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeCostsResponse([REFINE_ITEM])),
    });
  });

  await page.goto('/account');
  await waitForAccountReady(page);
  await page.getByTestId('account-costs-details-btn').click();

  await expect(page.getByTestId('cost-analysis-modal')).toBeVisible();

  // klik OCR
  await page.getByTestId('cost-filter-type-refine').click();

  await expect
    .poll(() => costRequests.some((u) => u.includes('type=refine')), { timeout: 5_000 })
    .toBe(true);
});

test('(4) paginacja Następna → request z page=2', async ({ page }) => {
  const costRequests: string[] = [];

  await page.route('**/api/account/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          total_vision_cost_usd: 0,
          total_refine_cost_usd: 0,
          vision_run_count: 0,
          refine_call_count: 0,
        },
      }),
    }),
  );
  await page.route('**/api/account/keys', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { keys: [] } }),
    });
  });
  await page.route('**/api/account/costs**', (route) => {
    costRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      // 26 wyników → 2 strony → przycisk Następna aktywny
      body: JSON.stringify({
        data: {
          items: [VISION_ITEM],
          page: 1,
          page_size: 25,
          total_count: 26,
          total_cost_usd: 0.01,
        },
      }),
    });
  });

  await page.goto('/account');
  await waitForAccountReady(page);
  await page.getByTestId('account-costs-details-btn').click();

  const nextBtn = page.getByTestId('cost-pagination-next');
  await expect(nextBtn).toBeEnabled({ timeout: 5_000 });
  await nextBtn.click();

  await expect
    .poll(() => costRequests.some((u) => u.includes('page=2')), { timeout: 5_000 })
    .toBe(true);
});

test('(5) link „Zdjęcie" — href do /photos/<id>; wiersz bez photo_id nie ma linku', async ({
  page,
}) => {
  await setupAccountRoutes(page);
  await page.goto('/account');
  await waitForAccountReady(page);
  await page.getByTestId('account-costs-details-btn').click();

  const modal = page.getByTestId('cost-analysis-modal');
  await expect(modal).toBeVisible();

  // VISION_ITEM ma photo_id
  const link = modal.getByTestId(`cost-event-photo-link-${VISION_ITEM.id}`);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', `/photos/${PHOTO_ID}`);

  // REFINE_ITEM nie ma photo_id
  await expect(modal.getByTestId(`cost-event-photo-link-${REFINE_ITEM.id}`)).not.toBeAttached();
});

test('(6) empty state — brak wywołań dla wybranych filtrów', async ({ page }) => {
  await setupAccountRoutes(page, {
    data: { items: [], page: 1, page_size: 25, total_count: 0, total_cost_usd: 0 },
  });
  await page.goto('/account');
  await waitForAccountReady(page);
  await page.getByTestId('account-costs-details-btn').click();

  await expect(page.getByTestId('cost-events-empty')).toBeVisible({ timeout: 5_000 });
});

test('(7a) zamknięcie przez ESC', async ({ page }) => {
  await setupAccountRoutes(page);
  await page.goto('/account');
  await waitForAccountReady(page);
  await page.getByTestId('account-costs-details-btn').click();

  await expect(page.getByTestId('cost-analysis-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cost-analysis-modal')).not.toBeAttached();
});

test('(7b) zamknięcie klikiem w tło (overlay)', async ({ page }) => {
  await setupAccountRoutes(page);
  await page.goto('/account');
  await waitForAccountReady(page);
  await page.getByTestId('account-costs-details-btn').click();

  await expect(page.getByTestId('cost-analysis-modal')).toBeVisible();
  await page.getByTestId('cost-analysis-modal-overlay').click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('cost-analysis-modal')).not.toBeAttached();
});

test('(8) error path: 500 → komunikat błędu → „Spróbuj ponownie" refetchuje (fix F1)', async ({
  page,
}) => {
  await setupAccountRoutes(page);

  // Pierwsze wywołanie costs → 500; kolejne → sukces. Nadpisujemy mock
  // z setupAccountRoutes (ostatnio zarejestrowany route wygrywa).
  let costsCalls = 0;
  await page.route('**/api/account/costs**', (route) => {
    costsCalls += 1;
    if (costsCalls === 1) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Błąd serwera' } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeCostsResponse([VISION_ITEM])),
    });
  });

  await page.goto('/account');
  await waitForAccountReady(page);
  await page.getByTestId('account-costs-details-btn').click();

  await expect(page.getByTestId('cost-events-error')).toBeVisible();

  await page.getByTestId('cost-events-retry').click();

  // Retry musi realnie ponowić fetch i wyrenderować dane.
  await expect(page.getByTestId(`cost-event-row-${VISION_ITEM.id}`)).toBeVisible();
  await expect(page.getByTestId('cost-events-error')).not.toBeVisible();
  expect(costsCalls).toBeGreaterThanOrEqual(2);
});
