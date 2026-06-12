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

function makeAdminClient() {
  const url = process.env.PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
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

  // Tworzymy userów-cel dla testów toggle/delete (operujemy wyłącznie na nich)
  const stamp = Date.now();
  const { data: targetData } = await admin.auth.admin.createUser({
    email: `e2e-admin-target-${stamp}@example.com`,
    password: 'E2eAdminTarget!23',
    email_confirm: true,
  });
  if (targetData.user) targetUserId = targetData.user.id;
});

test.afterAll(async () => {
  const admin = makeAdminClient();
  if (!admin) return;
  if (targetUserId) await admin.auth.admin.deleteUser(targetUserId);
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

test('soft-deleted user wyświetla się z badge "Usunięte"', async ({ page }) => {
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
});
