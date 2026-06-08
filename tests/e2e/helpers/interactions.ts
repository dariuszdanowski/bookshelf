import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Deterministyczne interakcje E2E — neutralizują wyścigi hydratacji wysp,
 * timing refetchu po mutacji i transientny odczyt computed-style.
 *
 * Wzorzec: bounded `toPass` walidowany obserwowalnym side-effectem, NIE globalny
 * retry maskujący. Zob. `tests/e2e/AGENTS.md` § Deterministyczne interakcje.
 */

/**
 * Otwiera UserMenu mimo wyścigu hydratacji.
 *
 * `UserMenu` jest renderowany server-side (Layout, `client:load`) — `user-menu-trigger`
 * istnieje w SSR-HTML zanim React podepnie `onClick` (`UserMenu.tsx:41`). Surowy
 * klik przed hydratacją przepada, `open` zostaje `false`, a `user-menu-account`
 * renderuje się tylko gdy `{open && …}` (`UserMenu.tsx:63`). Retry klika trigger
 * dopóki dropdown faktycznie się nie otworzy — guard `isVisible()` przed klikiem
 * chroni przed toggle-close gdy menu już otwarte.
 */
export async function openUserMenu(page: Page): Promise<void> {
  const dropdown = page.getByTestId('user-menu-dropdown');
  await expect(async () => {
    if (!(await dropdown.isVisible())) {
      await page.getByTestId('user-menu-trigger').click();
    }
    await expect(dropdown).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

/**
 * Tworzy półkę przez formularz i czeka na realny stan (POST + refetch), nie na
 * arbitralny timer.
 *
 * `ShelvesIsland` jest client-fetched (`loading=true` → formularz w gałęzi
 * `loading=false`, `ShelvesIsland.tsx:91,101`), więc fill/submit są bezpieczne po
 * pojawieniu się pól (Playwright auto-czeka). Po POST `handleCreate` robi
 * `fetchShelves()` (GET) — czekamy na odpowiedź POST sprzężoną z klikiem, potem na
 * widoczność wiersza (która domyka refetch + re-render).
 */
export async function createShelf(page: Page, name: string, location?: string): Promise<void> {
  await page.getByTestId('shelf-form-name').fill(name);
  if (location !== undefined) {
    await page.getByTestId('shelf-form-location').fill(location);
  }
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/shelves') && r.request().method() === 'POST' && r.ok(),
    ),
    page.getByTestId('shelf-form-submit').click(),
  ]);
  await expect(page.getByTestId('shelf-item-name').filter({ hasText: name })).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Najeżdża na element i asercjonuje computed `background-color`, pollując do
 * ustabilizowania na oczekiwanej wartości.
 *
 * Surowy `hover()` + jednorazowy `getComputedStyle` łapie stan bez hovera, gdy
 * React re-renderuje wiersz albo :hover nie zdążył się zaaplikować. Polling przez
 * `toPass` jest deterministyczny — realnie zły kolor wciąż failuje po timeoucie.
 */
export async function expectHoverBg(locator: Locator, expected: string): Promise<void> {
  await locator.hover();
  await expect(async () => {
    const bg = await locator.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(expected);
  }).toPass({ timeout: 3_000 });
}
