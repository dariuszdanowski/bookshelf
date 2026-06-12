import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

import { openUserMenu } from './helpers/interactions';

/**
 * E2E dla admin-panel (S-26):
 *   Phase 1 — non-admin redirect + brak linku; admin link + dostęp do /admin
 *   Phase 2 — lista userów + toggle ai_enabled (optimistic + trwały)
 *   Phase 3 — soft delete (rozszerzone w osobnym bloku)
 *
 * Kolejność testów ma znaczenie: najpierw sprawdzamy non-admin (user domyślnie
 * nie jest adminem), potem promujemy go i testujemy funkcje admin.
 * `mode: 'serial'` gwarantuje sekwencję w pliku.
 */

test.describe.configure({ mode: 'serial' });

const META_FILE = path.join('tests', 'e2e', '.auth', 'user-meta.json');

let sharedUserId = '';
let targetUserId = '';
let impersonateTargetId = '';

function readDevVars(): Record<string, string> {
  try {
    const content = fs.readFileSync(path.join(process.cwd(), '.dev.vars'), 'utf-8');
    const result: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m) result[m[1]] = m[2].trim();
    }
    return result;
  } catch {
    return {};
  }
}

function makeAdminClient() {
  const devVars = readDevVars();
  const url = process.env.PUBLIC_SUPABASE_URL || devVars['PUBLIC_SUPABASE_URL'] || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || devVars['SUPABASE_SERVICE_ROLE_KEY'] || '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

test.beforeAll(async () => {
  const admin = makeAdminClient();
  if (!admin || !fs.existsSync(META_FILE)) return;

  const { email } = JSON.parse(fs.readFileSync(META_FILE, 'utf-8')) as { email: string };
  const { data } = await admin.auth.admin.listUsers();
  const sharedUser = data.users.find((u) => u.email === email);
  if (sharedUser) sharedUserId = sharedUser.id;

  // Tworzymy userów-cel dla testów toggle/delete i impersonacji (operujemy wyłącznie na nich)
  const stamp = Date.now();
  const { data: targetData } = await admin.auth.admin.createUser({
    email: `e2e-admin-target-${stamp}@example.com`,
    password: 'E2eAdminTarget!23',
    email_confirm: true,
  });
  if (targetData.user) targetUserId = targetData.user.id;

  // Osobny user do impersonacji — nie dotknięty przez test soft-delete
  const { data: impersonateData } = await admin.auth.admin.createUser({
    email: `e2e-admin-impersonate-${stamp}@example.com`,
    password: 'E2eAdminImpersonate!23',
    email_confirm: true,
  });
  if (impersonateData.user) impersonateTargetId = impersonateData.user.id;
});

test.afterAll(async () => {
  const admin = makeAdminClient();
  if (!admin) return;
  if (targetUserId) await admin.auth.admin.deleteUser(targetUserId);
  if (impersonateTargetId) await admin.auth.admin.deleteUser(impersonateTargetId);
  if (sharedUserId) {
    await admin
      .from('profiles')
      .update({ is_admin: false, ai_enabled: true })
      .eq('id', sharedUserId);
  }
});

// ── Phase 1: non-admin access (shared user nie jest adminem na początku) ──────

test('non-admin: /admin → redirect na /', async ({ page }) => {
  await page.goto('/admin');
  await page.waitForURL('/');
});

test('non-admin: brak linku "Panel admina" w UserMenu', async ({ page }) => {
  await page.goto('/shelves');
  await openUserMenu(page);
  await expect(page.getByTestId('user-menu-admin')).not.toBeVisible();
});

// ── Setup: promocja shared usera na admina ────────────────────────────────────

test('setup: promote shared user to admin', async ({ page }) => {
  const admin = makeAdminClient();
  if (!admin || !sharedUserId) {
    test.skip();
    return;
  }
  await admin.from('profiles').update({ is_admin: true }).eq('id', sharedUserId);

  // Weryfikujemy że Layout odczyta is_admin=true przy kolejnym załadowaniu strony
  await page.goto('/shelves');
  await openUserMenu(page);
  await expect(page.getByTestId('user-menu-admin')).toBeVisible({ timeout: 8_000 });
});

// ── Phase 1: admin access ─────────────────────────────────────────────────────

test('admin widzi link "Panel admina" w UserMenu', async ({ page }) => {
  await page.goto('/shelves');
  await openUserMenu(page);
  await expect(page.getByTestId('user-menu-admin')).toBeVisible({ timeout: 8_000 });
});

test('admin może wejść na /admin', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Panel administratora' })).toBeVisible();
});

// ── Phase 2: lista userów + toggle ai_enabled ─────────────────────────────────

test('admin widzi listę userów na /admin', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByTestId('admin-users-island')).toBeVisible({ timeout: 10_000 });
  if (sharedUserId) {
    await expect(page.getByTestId(`admin-user-row-${sharedUserId}`)).toBeVisible({
      timeout: 10_000,
    });
  }
});

test('toggle ai_enabled — optimistic update + trwała zmiana', async ({ page }) => {
  if (!targetUserId) {
    test.skip();
    return;
  }

  await page.goto('/admin');
  await expect(page.getByTestId('admin-users-island')).toBeVisible({ timeout: 10_000 });

  const toggle = page.getByTestId(`admin-user-ai-toggle-${targetUserId}`);
  await expect(toggle).toBeVisible({ timeout: 10_000 });

  // ai_enabled domyślnie true — klikamy aby wyłączyć
  await expect(toggle).toBeChecked();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/api/admin/users/${targetUserId}/ai-enabled`) &&
        r.request().method() === 'PATCH',
    ),
    toggle.click(),
  ]);

  await expect(toggle).not.toBeChecked({ timeout: 5_000 });

  // Reload — sprawdzamy trwałość
  await page.reload();
  await expect(page.getByTestId('admin-users-island')).toBeVisible({ timeout: 10_000 });
  const toggleAfter = page.getByTestId(`admin-user-ai-toggle-${targetUserId}`);
  await expect(toggleAfter).toBeVisible({ timeout: 10_000 });
  await expect(toggleAfter).not.toBeChecked();
});

test('soft-deleted user wyświetla się z badge "Usunięte" (manual DB)', async ({ page }) => {
  if (!targetUserId) {
    test.skip();
    return;
  }

  const admin = makeAdminClient();
  if (!admin) {
    test.skip();
    return;
  }
  // Ręcznie ustawiamy deleted_at (bez przycisków Phase 3)
  await admin
    .from('profiles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', targetUserId);

  await page.goto('/admin');
  await expect(page.getByTestId('admin-users-island')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`admin-user-deleted-badge-${targetUserId}`)).toBeVisible({
    timeout: 10_000,
  });

  // Przywracamy konto do stanu aktywnego (kolejne testy Phase 3 operują na aktywnym koncie)
  await admin.from('profiles').update({ deleted_at: null }).eq('id', targetUserId);
});

// ── Phase 3: soft delete przez UI + impersonacja ──────────────────────────────

test('soft delete przez UI — przycisk "Usuń konto" + dialog + badge', async ({ page }) => {
  if (!targetUserId) {
    test.skip();
    return;
  }

  await page.goto('/admin');
  await expect(page.getByTestId('admin-users-island')).toBeVisible({ timeout: 10_000 });

  const deleteBtn = page.getByTestId(`admin-user-delete-${targetUserId}`);
  await expect(deleteBtn).toBeVisible({ timeout: 10_000 });
  await deleteBtn.click();

  // Dialog pojawia się
  await expect(page.getByTestId('admin-delete-dialog')).toBeVisible({ timeout: 5_000 });

  // Klikamy potwierdzenie i czekamy na odpowiedź API
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/api/admin/users/${targetUserId}/delete`) &&
        r.request().method() === 'POST',
    ),
    page.getByTestId('admin-delete-dialog-confirm').click(),
  ]);

  // Lista się przeładowuje — badge "Usunięte" pojawia się
  await expect(page.getByTestId('admin-users-island')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`admin-user-deleted-badge-${targetUserId}`)).toBeVisible({
    timeout: 10_000,
  });
});

// Impersonacja OSTATNIA — zmienia sesję przeglądarki na innego użytkownika.
// Używa osobnego impersonateTargetId (nie soft-deleted przez poprzedni test).
test('impersonacja przez UI — klik + zmiana sesji na innego usera', async ({ page }) => {
  if (!impersonateTargetId) {
    test.skip();
    return;
  }

  await page.goto('/admin');
  await expect(page.getByTestId('admin-users-island')).toBeVisible({ timeout: 10_000 });

  const impersonateBtn = page.getByTestId(`admin-user-impersonate-${impersonateTargetId}`);
  await expect(impersonateBtn).toBeVisible({ timeout: 10_000 });

  // Klikamy i czekamy na nawigację do /shelves (setSession → window.location.href)
  await Promise.all([page.waitForURL('**/shelves', { timeout: 15_000 }), impersonateBtn.click()]);

  // Jesteśmy na /shelves jako zaimpersonowany user (nie jako admin)
  await expect(page).toHaveURL(/\/shelves/);

  // Baner impersonacji musi być widoczny
  await expect(page.getByTestId('impersonation-banner')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('impersonation-email')).toBeVisible();

  // Impersonowany user nie jest adminem — link "Panel admina" nie powinien być widoczny
  await openUserMenu(page);
  await expect(page.getByTestId('user-menu-admin')).not.toBeVisible({ timeout: 5_000 });
  // Zamykamy menu klikając poza nim (Escape), żeby nie blokować kolejnych asercji
  await page.keyboard.press('Escape');

  // Powrót do własnego konta przez przycisk w banerze
  await Promise.all([
    page.waitForURL('**/admin', { timeout: 15_000 }),
    page.getByTestId('impersonation-return-btn').click(),
  ]);

  await expect(page.getByRole('heading', { name: 'Panel administratora' })).toBeVisible({
    timeout: 8_000,
  });
});
