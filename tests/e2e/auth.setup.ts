import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Setup project — wykonuje JEDEN realny signup na początku przebiegu E2E
 * i zapisuje sesję jako storageState. Wszystkie specs (poza auth/smoke, które
 * jawnie się wypisują) reużywają tej sesji → 1 signup/run zamiast ~13,
 * co eliminuje rate-limit Supabase (flaky) i pollution (1 user/run).
 *
 * Cleanup tego usera: tests/e2e/auth.teardown.ts (best-effort, wymaga
 * SUPABASE_SERVICE_ROLE_KEY w env test-runnera).
 */

export const authFile = path.join('tests', 'e2e', '.auth', 'user.json');
const metaFile = path.join('tests', 'e2e', '.auth', 'user-meta.json');

setup('authenticate (shared signup)', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-shared-${stamp}@example.com`;
  const password = 'E2eSharedPass!23';

  await page.goto('/signup');
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="display_name"]', `E2E Shared ${stamp}`);
  await page.fill('input[name="password"]', password);
  await page.click('[data-testid="submit-signup"]');
  // signup auto-loguje (confirm email = off); cookie sesji ustawiany przez
  // @supabase/ssr na odpowiedzi → storageState złapie sesję po redirect.
  await page.waitForURL('/', { timeout: 20_000 });

  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
  fs.writeFileSync(metaFile, JSON.stringify({ email, stamp }), 'utf-8');
});
