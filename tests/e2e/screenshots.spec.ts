import { expect, test, type Page } from '@playwright/test';

/**
 * Capture-spec dla zrzutów README (docs/screenshots/0X-*.png).
 *
 * To NIE jest test ryzyka (M3L4) — to deterministyczny generator artefaktów
 * prezentacyjnych. Renderuje realny UI aplikacji na kuratorowanych danych
 * mock (page.route), żeby README pokazywał faktyczny wygląd ekranów bez
 * potrzeby realnego zdjęcia / wywołania vision (koszt = twardy guardrail).
 *
 * Dane są syntetyczne, ale dobrane „na pokaz" (polskie tytuły, sensowne
 * półki). Format zrzutów jest gotowy — gdy pojawi się realny content,
 * podmiana plików ręcznie zachowuje layout README.
 *
 * Uruchomienie pojedynczo:
 *   npx playwright test screenshots.spec.ts --project=chromium
 *
 * Auth: współdzielona sesja z auth.setup.ts (storageState). Ekran logowania
 * świadomie nadpisuje storageState na pusty (guard /login przekierowuje
 * zalogowanych na /).
 */

const OUT = 'docs/screenshots';
test.use({ viewport: { width: 1280, height: 900 } });

// Motyw sterowany env. Domyślnie DARK — to wersja kanoniczna w README, więc
// zwykły `npx playwright test screenshots.spec.ts` reprodukuje committed set.
// SHOT_THEME=light wymusza jasny; SHOT_SUFFIX dokleja się do nazw plików
// (np. '-light'), by oba motywy mogły współistnieć do porównania.
// Motyw = klasa .dark via localStorage 'bookshelf:theme-mode' (inline <head>).
const THEME = process.env.SHOT_THEME === 'light' ? 'light' : 'dark';
const SUFFIX = process.env.SHOT_SUFFIX ?? '';

test.beforeEach(async ({ page }) => {
  if (THEME === 'dark') {
    await page.addInitScript(() => {
      window.localStorage.setItem('bookshelf:theme-mode', 'dark');
    });
  }
});

// Usuń dev-only chrome (Astro dev toolbar + badge środowiska „PROD DB") z DOM
// tuż przed zrzutem — inaczej lądują w kadrze README. CSS przez init-script
// nie łapie toolbara (host w shadow DOM), więc twardo go usuwamy.
async function cleanChrome(page: Page) {
  await page.evaluate(() => {
    document.querySelector('astro-dev-toolbar')?.remove();
    document.querySelector('[data-testid="env-badge"]')?.remove();
  });
}

// ---------------------------------------------------------------------------
// SVG „półki" jako data-URI — kolorowe grzbiety pokrywają się z bboxami
// detekcji, dzięki czemu ramki overlay framują realnie wyglądające grzbiety.
// Brak realnego zdjęcia = brak kosztu storage/vision.
// ---------------------------------------------------------------------------
const SPINES = [
  { x: 0.04, w: 0.12, color: '#1e3a5f', title: 'Solaris', author: 'Lem' },
  { x: 0.19, w: 0.12, color: '#7f1d2e', title: 'Lalka', author: 'Prus' },
  { x: 0.34, w: 0.12, color: '#1f4d2e', title: 'Wiedźmin', author: 'Sapkowski' },
  { x: 0.49, w: 0.12, color: '#6b4423', title: 'Diuna', author: 'Herbert' },
  { x: 0.64, w: 0.12, color: '#8a6d1d', title: '???', author: '' },
];

function shelfSvgDataUri(): string {
  const W = 1400;
  const H = 560;
  const top = 0.05 * H;
  const botSpine = 0.9 * H;
  const spines = SPINES.map((s) => {
    const px = s.x * W;
    const pw = s.w * W;
    const cx = px + pw / 2;
    const cy = (top + botSpine) / 2;
    return `
      <rect x="${px}" y="${top}" width="${pw}" height="${botSpine - top}" rx="6"
            fill="${s.color}" stroke="#00000033" stroke-width="2"/>
      <text x="${cx}" y="${cy}" fill="#f5efe0" font-family="Georgia, serif" font-size="26"
            font-weight="600" text-anchor="middle"
            transform="rotate(-90 ${cx} ${cy})">${s.title}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4a341f"/>
        <stop offset="1" stop-color="#2e2013"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#wood)"/>
    <rect x="0" y="${botSpine}" width="${W}" height="${H - botSpine}" fill="#1c130a"/>
    ${spines}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------------
// Mock: detekcje + kandydaci dla /photos/[id] (overlay 04 + proposals 05)
// ---------------------------------------------------------------------------
const PHOTO_ID = '00000000-0000-4000-8000-5c5e5e5e5e01';
const SHELF_ID = '00000000-0000-4000-8000-5c5e5e5e5e02';

const PHOTO_DETECTIONS = [
  {
    id: '00000000-0000-4000-8000-5c5e5e5e5e11',
    position_index: 1,
    raw_title: 'Solaris',
    raw_author: 'Stanisław Lem',
    vision_confidence: 0.96,
    spine_color: 'niebieski',
    bbox: { x1: 0.04, y1: 0.05, x2: 0.16, y2: 0.9 },
    status: 'matched',
    candidates: [
      {
        id: '00000000-0000-4000-8000-5c5e5e5e5ea1',
        source: 'google_books',
        externalId: 'gb-solaris',
        title: 'Solaris',
        authors: ['Stanisław Lem'],
        isbn10: null,
        isbn13: '9788308065488',
        publisher: 'Wydawnictwo Literackie',
        publishedYear: 1961,
        coverUrl: null,
        matchScore: 0.94,
        rank: 1,
      },
    ],
    duplicate: null,
  },
  {
    id: '00000000-0000-4000-8000-5c5e5e5e5e12',
    position_index: 2,
    raw_title: 'Lalka',
    raw_author: 'Bolesław Prus',
    vision_confidence: 0.9,
    spine_color: 'czerwony',
    bbox: { x1: 0.19, y1: 0.05, x2: 0.31, y2: 0.9 },
    status: 'matched',
    candidates: [
      {
        id: '00000000-0000-4000-8000-5c5e5e5e5ea2',
        source: 'google_books',
        externalId: 'gb-lalka',
        title: 'Lalka',
        authors: ['Bolesław Prus'],
        isbn10: null,
        isbn13: '9788373271234',
        publisher: 'PIW',
        publishedYear: 1890,
        coverUrl: null,
        matchScore: 0.88,
        rank: 1,
      },
    ],
    duplicate: null,
  },
  {
    id: '00000000-0000-4000-8000-5c5e5e5e5e13',
    position_index: 3,
    raw_title: 'Wiedźmin: Ostatnie życzenie',
    raw_author: 'Sapkowski',
    vision_confidence: 0.86,
    spine_color: 'zielony',
    bbox: { x1: 0.34, y1: 0.05, x2: 0.46, y2: 0.9 },
    status: 'matched',
    candidates: [
      {
        id: '00000000-0000-4000-8000-5c5e5e5e5ea3',
        source: 'google_books',
        externalId: 'gb-wiedzmin',
        title: 'Ostatnie życzenie',
        authors: ['Andrzej Sapkowski'],
        isbn10: null,
        isbn13: '9788375780635',
        publisher: 'superNOWA',
        publishedYear: 1993,
        coverUrl: null,
        matchScore: 0.83,
        rank: 1,
      },
    ],
    duplicate: null,
  },
  {
    id: '00000000-0000-4000-8000-5c5e5e5e5e14',
    position_index: 4,
    raw_title: 'Diunax',
    raw_author: 'Herbert',
    vision_confidence: 0.74,
    spine_color: 'brązowy',
    bbox: { x1: 0.49, y1: 0.05, x2: 0.61, y2: 0.9 },
    status: 'matched',
    candidates: [
      {
        id: '00000000-0000-4000-8000-5c5e5e5e5ea4',
        source: 'google_books',
        externalId: 'gb-diuna',
        title: 'Diuna',
        authors: ['Frank Herbert'],
        isbn10: null,
        isbn13: null,
        publisher: 'Rebis',
        publishedYear: 1965,
        coverUrl: null,
        matchScore: 0.62,
        rank: 1,
      },
    ],
    duplicate: null,
  },
  {
    id: '00000000-0000-4000-8000-5c5e5e5e5e15',
    position_index: 5,
    raw_title: 'Grzbiet nieczytelny',
    raw_author: null,
    vision_confidence: 0.45,
    spine_color: 'żółty',
    bbox: { x1: 0.64, y1: 0.05, x2: 0.76, y2: 0.9 },
    status: 'pending',
    candidates: [],
    duplicate: null,
  },
];

async function mockPhoto(page: Page) {
  await page.route(`**/api/photos/${PHOTO_ID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          photo: {
            id: PHOTO_ID,
            shelf_id: SHELF_ID,
            status: 'processed',
            detected_count: PHOTO_DETECTIONS.length,
            error_message: null,
            vision_cost_usd: 0.0062,
            vision_latency_ms: 4300,
            created_at: '2026-06-04T09:00:00Z',
          },
          photo_url: shelfSvgDataUri(),
          detections: PHOTO_DETECTIONS,
          vision_run: {
            id: 'vr-readme',
            model: 'claude-sonnet-4-6',
            created_at: '2026-06-04T09:00:00Z',
            cost_usd: 0.0062,
            latency_ms: 4300,
          },
        },
      }),
    });
  });
  // CostPanel per-detekcja może bić po koszt — odpowiadamy pustym, by nie 404.
  await page.route('**/api/photos/*/cost*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) })
  );
}

// ---------------------------------------------------------------------------
// Mock: lista półek (02-shelves, picker w 03-upload, filtr w 06-library)
// ---------------------------------------------------------------------------
const SHELVES = [
  { id: SHELF_ID, name: 'Zakupione', location: null, position_index: 0, is_system: true, book_count: 3, photo_count: 1, created_at: '2026-05-20T10:00:00Z' },
  { id: '00000000-0000-4000-8000-5c5e5e5e5e21', name: 'Salon — beletrystyka', location: 'Salon', position_index: 1, is_system: false, book_count: 12, photo_count: 3, created_at: '2026-05-21T10:00:00Z' },
  { id: '00000000-0000-4000-8000-5c5e5e5e5e22', name: 'Fantastyka', location: 'Gabinet', position_index: 2, is_system: false, book_count: 8, photo_count: 2, created_at: '2026-05-22T10:00:00Z' },
  { id: '00000000-0000-4000-8000-5c5e5e5e5e23', name: 'Klasyka', location: 'Sypialnia', position_index: 3, is_system: false, book_count: 15, photo_count: 4, created_at: '2026-05-23T10:00:00Z' },
];

async function mockShelves(page: Page) {
  await page.route('**/api/shelves', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { shelves: SHELVES } }),
    });
  });
}

// ---------------------------------------------------------------------------
// Mock: wyniki wyszukiwarki katalogu (06-library)
// ---------------------------------------------------------------------------
const CATALOG = [
  { id: 'b1', title: 'Solaris', authors: ['Stanisław Lem'], cover_url: null, published_year: 1961, position_index: 1, is_read: true, shelf_id: SHELVES[1].id, shelf_name: 'Salon — beletrystyka', spine_color: 'niebieski' },
  { id: 'b2', title: 'Lalka', authors: ['Bolesław Prus'], cover_url: null, published_year: 1890, position_index: 2, is_read: false, shelf_id: SHELVES[1].id, shelf_name: 'Salon — beletrystyka', spine_color: 'czerwony' },
  { id: 'b3', title: 'Ostatnie życzenie', authors: ['Andrzej Sapkowski'], cover_url: null, published_year: 1993, position_index: 1, is_read: true, shelf_id: SHELVES[2].id, shelf_name: 'Fantastyka', spine_color: 'zielony' },
  { id: 'b4', title: 'Diuna', authors: ['Frank Herbert'], cover_url: null, published_year: 1965, position_index: 2, is_read: false, shelf_id: SHELVES[2].id, shelf_name: 'Fantastyka', spine_color: 'brązowy' },
  { id: 'b5', title: 'Rok 1984', authors: ['George Orwell'], cover_url: null, published_year: 1949, position_index: 3, is_read: true, shelf_id: SHELVES[1].id, shelf_name: 'Salon — beletrystyka', spine_color: 'szary' },
  { id: 'b6', title: 'Zbrodnia i kara', authors: ['Fiodor Dostojewski'], cover_url: null, published_year: 1866, position_index: 1, is_read: false, shelf_id: SHELVES[3].id, shelf_name: 'Klasyka', spine_color: 'czarny' },
  { id: 'b7', title: 'Mistrz i Małgorzata', authors: ['Michaił Bułhakow'], cover_url: null, published_year: 1967, position_index: 2, is_read: true, shelf_id: SHELVES[3].id, shelf_name: 'Klasyka', spine_color: 'czerwony' },
  { id: 'b8', title: 'Hobbit', authors: ['J.R.R. Tolkien'], cover_url: null, published_year: 1937, position_index: 3, is_read: false, shelf_id: SHELVES[2].id, shelf_name: 'Fantastyka', spine_color: 'zielony' },
];

async function mockCatalog(page: Page) {
  await page.route('**/api/books/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { books: CATALOG, total: CATALOG.length } }),
    })
  );
}

// ===========================================================================
// 01 — Logowanie (anon: nadpisujemy storageState na pusty)
// ===========================================================================
test.describe('readme screenshot — login (anon)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('01-login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Zaloguj się' })).toBeVisible();
    await expect(page.getByRole('button', { name: /zaloguj/i })).toBeVisible();
    await cleanChrome(page);
    await page.screenshot({ path: `${OUT}/01-login${SUFFIX}.png` });
  });
});

// ===========================================================================
// Ekrany zalogowane (współdzielona sesja z auth.setup.ts)
// ===========================================================================
test.describe('readme screenshots — authenticated', () => {
  test('02-shelves', async ({ page }) => {
    await mockShelves(page);
    await page.goto('/shelves');
    await expect(page.getByTestId('shelves-list')).toBeVisible();
    await expect(page.getByText('Salon — beletrystyka')).toBeVisible();
    await cleanChrome(page);
    await page.screenshot({ path: `${OUT}/02-shelves${SUFFIX}.png` });
  });

  test('03-upload', async ({ page }) => {
    await mockShelves(page);
    await page.goto('/upload');
    await expect(page.getByRole('heading', { name: 'Dodaj zdjęcie' })).toBeVisible();
    // Poczekaj aż island się zhydruje (picker półek albo dropzone widoczny)
    await page.waitForLoadState('networkidle');
    await cleanChrome(page);
    await page.screenshot({ path: `${OUT}/03-upload${SUFFIX}.png` });
  });

  test('04-detection-overlay + 05-proposals', async ({ page }) => {
    await mockPhoto(page);
    await page.goto(`/photos/${PHOTO_ID}`);

    // Overlay z ramkami — czekamy aż obraz SVG się załaduje i markery wyrenderują
    const overlay = page.getByTestId('photo-overlay');
    await expect(overlay).toBeVisible();
    await expect(page.getByTestId('bbox-marker-1')).toBeVisible({ timeout: 5000 });
    await overlay.scrollIntoViewIfNeeded();
    await cleanChrome(page);
    await overlay.screenshot({ path: `${OUT}/04-detection-overlay${SUFFIX}.png` });

    // Propozycje — ukrywamy overlay + panel vision, by karty wypełniły kadr
    await page.addStyleTag({
      content:
        '[data-testid="photo-overlay"],[data-testid="vision-run-panel"]{display:none!important}',
    });
    await expect(page.getByTestId('detection-card-1')).toBeVisible();
    await expect(page.getByTestId('bulk-confirm-button')).toBeVisible();
    await cleanChrome(page);
    await page.getByTestId('detection-review').screenshot({ path: `${OUT}/05-proposals${SUFFIX}.png` });
  });

  test('06-library', async ({ page }) => {
    await mockShelves(page);
    await mockCatalog(page);
    await page.goto('/library');
    await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Solaris')).toBeVisible();
    await cleanChrome(page);
    await page.screenshot({ path: `${OUT}/06-library${SUFFIX}.png` });
  });
});
