import { expect, test } from '@playwright/test';

import { createShelf } from './helpers/interactions';

/**
 * Golden path E2E dla S-02:
 *  1. Signup nowego usera (auto-confirm, trigger handle_new_user tworzy
 *     „Zakupione" automatycznie).
 *  2. /shelves → widoczna „Zakupione" jako systemowa (badge widoczny,
 *     bez buttonów Edit/Delete).
 *  3. Tworzenie własnej półki przez form.
 *  4. Edycja name + location przez inline edit mode.
 *  5. Usunięcie own półki przez confirm dialog.
 *
 * UWAGA: ten test wymaga zaaplikowanej migracji 0004 na docelowym
 * Supabase. Bez tego trigger reject jest brak, ale CREATE/UPDATE/DELETE
 * dla user-created półek nadal działają — UI smoke pokryje większość
 * scenariuszy.
 */

const STAMP = Date.now();
const SHELF_NAME = `E2E Półka ${STAMP}`;
const SHELF_NAME_RENAMED = `E2E Półka Renamed ${STAMP}`;
const SHELF_LOCATION = 'Salon, regał testowy';

test('/shelves → create → edit → delete (system Zakupione protected)', async ({ page }) => {
  // Sesja z współdzielonego storageState — od razu na /shelves (bez signup per-test)
  await page.goto('/shelves');
  await expect(page.getByTestId('shelves-island')).toBeVisible();

  // „Zakupione" widoczna z badge'em systemowa.
  const systemBadge = page.getByTestId('shelf-item-system-badge');
  await expect(systemBadge).toBeVisible();
  await expect(systemBadge).toHaveText('systemowa');

  // 3. Tworzenie własnej półki — createShelf czeka na POST + refetch (S-44),
  // zamiast gołego 5s timeoutu ścigającego się z zimnym dev-serverem (asercja
  // widoczności nowego wiersza jest w helperze).
  await createShelf(page, SHELF_NAME, SHELF_LOCATION);

  // 4. Edit — toggle edit mode, rename + change location, save
  const newShelfRow = page.locator('[data-testid^="shelf-item-"]').filter({ hasText: SHELF_NAME });
  await newShelfRow.getByTestId('shelf-item-edit-button').click();
  // edit-mode: nazwa jest teraz w <input> (value), więc filtr hasText nie matchuje
  // już wiersza — input edycji jest jedyny na stronie (jeden wiersz w edit-mode naraz)
  const editName = page.getByTestId('shelf-item-edit-name');
  await editName.fill(SHELF_NAME_RENAMED);
  // Couple klik z odpowiedzią PATCH (S-44) — czekamy na realny stan, nie na zegar.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/shelves/') && r.request().method() === 'PATCH' && r.ok(),
    ),
    page.getByRole('button', { name: 'Zapisz' }).click(),
  ]);

  const renamedShelf = page.getByTestId('shelf-item-name').filter({ hasText: SHELF_NAME_RENAMED });
  await expect(renamedShelf).toBeVisible({ timeout: 10_000 });

  // 5. Delete — React ConfirmDialog (nie natywny window.confirm per CLAUDE.md)
  const renamedRow = page
    .locator('[data-testid^="shelf-item-"]')
    .filter({ hasText: SHELF_NAME_RENAMED });
  await renamedRow.getByTestId('shelf-item-delete-button').click();

  // ConfirmDialog widoczny — kliknij „Usuń półkę", couple z odpowiedzią DELETE (S-44)
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/shelves/') && r.request().method() === 'DELETE' && r.ok(),
    ),
    page.getByRole('button', { name: 'Usuń półkę' }).click(),
  ]);

  // Po refetch — usuniętej półki nie ma w liście.
  await expect(renamedShelf).not.toBeVisible({ timeout: 10_000 });

  // „Zakupione" wciąż widoczna (nieusuwalna).
  await expect(systemBadge).toBeVisible();
});
