/**
 * Generator zrzutów dla strony /help z realnych danych konta demo.
 * Każdy ekran łapany w dwóch wariantach: jasnym (`NN-nazwa.png`) i ciemnym
 * (`NN-nazwa-dark.png`) — /help pokazuje wariant zgodny z aktywnym motywem.
 *
 * Wymaga konta demo (np. demo@demo.com) z co najmniej:
 *   - jedną półką z zaanalizowanym zdjęciem (status=processed + bboxami)
 *   - kilkoma potwierdzonymi książkami w katalogu
 *
 * Uruchomienie (odpala się TYLKO jawnie — w CI/pełnym runie skip):
 *   DEMO_EMAIL=demo@demo.com DEMO_PASSWORD=*** \
 *     npx playwright test tests/e2e/help-screenshots.spec.ts --project=chromium
 *
 * Opcjonalnie konkretne zdjęcie: DEMO_PHOTO_ID=<uuid> (default: zdjęcie demo
 * z małą liczbą propozycji — czytelniejszy zrzut 05).
 */

import { expect, test, type Page } from '@playwright/test';
import path from 'path';

const OUT = 'src/assets/help';
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? '';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? '';
const DEMO_PHOTO_ID = process.env.DEMO_PHOTO_ID ?? 'aca3d091-dad7-4859-886c-691a45ae3cf8';

// Generator odpala się TYLKO jawnie (DEMO_EMAIL+DEMO_PASSWORD w env) — w CI
// i zwykłym pełnym runie E2E brak konta demo → wszystkie testy skip.
test.skip(!DEMO_EMAIL || !DEMO_PASSWORD, 'help-screenshots: brak DEMO_EMAIL/DEMO_PASSWORD w env');

test.use({
  viewport: { width: 1280, height: 900 },
  storageState: { cookies: [], origins: [] }, // nie używamy shared storageState
});

test.use({ baseURL: 'http://localhost:4321' });

// Dev-only chrome (Astro dev toolbar + badge środowiska) ukrywany CSS-em od
// startu KAŻDEGO dokumentu — addInitScript przeżywa przeładowania strony,
// więc nie ma wyścigu „toolbar wrócił po reloadzie tuż przed kadrem".
// Plus: globalne wyłączenie transition/animation — `transition-colors` na
// dropzonie potrafił zostać złapany w klatce pośredniej (jasne tło mimo
// html.dark). Wyłączenie tranzycji = deterministyczny stan końcowy w kadrze.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    injectCss,
    'astro-dev-toolbar,[data-testid="env-badge"]{display:none!important}' +
      '*,*::before,*::after{transition:none!important;animation:none!important}',
  );
});

// Serializowana do strony przez addInitScript — w momencie init `document.head`
// może jeszcze nie istnieć, stąd defer do DOMContentLoaded.
function injectCss(cssText: string) {
  const apply = () => {
    const style = document.createElement('style');
    style.textContent = cssText;
    document.head.appendChild(style);
  };
  if (document.readyState !== 'loading') apply();
  else document.addEventListener('DOMContentLoaded', apply);
}

/**
 * Zrzut w obu motywach: jasny → `name.png`, ciemny → `name-dark.png`.
 * KAŻDY motyw ładowany od zera (emulateMedia PRZED nawigacją) — live-flip po
 * załadowaniu bywał zawodny dla React-island z `transition-colors` (część
 * elementów nie przeliczała `dark:` od razu). Pełny reload = stan deterministyczny.
 * `reload` ustawia URL do ponownego wejścia (zrzut zalogowanych ekranów).
 */
// goto odporny na ERR_ABORTED — dev server bywa się sam przeładowuje
// (#astro-retry po nieudanym dynamic import wyspy), co przerywa pierwszą
// nawigację. Jeden retry wystarcza.
async function gotoStable(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (err) {
    if (String(err).includes('ERR_ABORTED')) await page.goto(url);
    else throw err;
  }
  await page.waitForLoadState('networkidle');
}

async function captureBoth(page: Page, name: string, reloadUrl: string) {
  for (const scheme of ['light', 'dark'] as const) {
    const suffix = scheme === 'dark' ? '-dark' : '';
    await page.emulateMedia({ colorScheme: scheme });
    await gotoStable(page, reloadUrl);
    await page.screenshot({ path: path.join(OUT, `${name}${suffix}.png`) });
  }
}

async function loginAsDemo(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel(/e-?mail/i).fill(DEMO_EMAIL);
  await page.getByLabel(/hasło|password/i).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /zaloguj/i }).click();
  await page.waitForURL('/', { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// 01 — Logowanie (anon)
// ---------------------------------------------------------------------------
test('01-login', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Zaloguj się' })).toBeVisible();
  await captureBoth(page, '01-login', '/login');
});

// ---------------------------------------------------------------------------
// Ekrany zalogowane (konto demo)
// ---------------------------------------------------------------------------
test('02-shelves', async ({ page }) => {
  await loginAsDemo(page);
  await captureBoth(page, '02-shelves', '/shelves');
});

test('03-upload', async ({ page }) => {
  await loginAsDemo(page);
  await captureBoth(page, '03-upload', '/upload');
});

/**
 * Zrzut elementu z jednym retry — strona zdjęcia potrafi jednorazowo
 * re-mountować subtree po dokończeniu async (signed URL / koszty), co odpina
 * locator między toBeVisible a screenshot ("Element is not attached").
 */
async function shootEl(page: Page, testId: string, file: string) {
  const target = page.getByTestId(testId);
  await expect(target).toBeVisible({ timeout: 10_000 });
  try {
    await target.screenshot({ path: path.join(OUT, file) });
  } catch {
    await page.waitForLoadState('networkidle');
    await expect(target).toBeVisible({ timeout: 10_000 });
    await target.screenshot({ path: path.join(OUT, file) });
  }
}

test('04-detection-overlay (oba motywy)', async ({ page }) => {
  await loginAsDemo(page);
  // Pełny load strony per motyw — live-flip motywu re-mountuje wyspy.
  for (const scheme of ['light', 'dark'] as const) {
    const suffix = scheme === 'dark' ? '-dark' : '';
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/photos/${DEMO_PHOTO_ID}`);
    await expect(page.getByTestId('photo-overlay')).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await page.getByTestId('photo-overlay').scrollIntoViewIfNeeded();
    await shootEl(page, 'photo-overlay', `04-detection-overlay${suffix}.png`);
  }
});

test('05-proposals (oba motywy)', async ({ page }) => {
  // Reload-proof hide: CSS wstrzykiwany od startu KAŻDEGO dokumentu
  // (addInitScript przeżywa przeładowania). Strona /photos pod dev-serverem
  // potrafi się sama przeładować (#astro-retry po nieudanym dynamic import
  // wyspy) — styl z addStyleTag wtedy znikał i kadr łapał overlay mimo
  // wcześniejszego toBeHidden.
  await page.addInitScript(
    injectCss,
    '[data-testid="photo-overlay"],[data-testid="vision-run-panel"]{display:none!important}',
  );
  await loginAsDemo(page);

  for (const scheme of ['light', 'dark'] as const) {
    const suffix = scheme === 'dark' ? '-dark' : '';
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/photos/${DEMO_PHOTO_ID}`);
    await expect(page.getByTestId('detection-card-1')).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('photo-overlay')).toBeHidden();
    await shootEl(page, 'detection-review', `05-proposals${suffix}.png`);
    await expect(page.getByTestId('photo-overlay')).toBeHidden();
  }
});

test('06-library', async ({ page }) => {
  await loginAsDemo(page);
  // Per-motyw od zera (katalog wymaga wpisania w search, by pokazać książki)
  for (const scheme of ['light', 'dark'] as const) {
    const suffix = scheme === 'dark' ? '-dark' : '';
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/library');
    await page.waitForLoadState('networkidle');
    await Promise.all([
      page.waitForResponse('**/api/books/search**'),
      page.getByPlaceholder(/szukaj po tytule/i).fill('a'),
    ]);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(OUT, `06-library${suffix}.png`) });
  }
});
