import { test as teardown } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cleanup project — kasuje współdzielonego e2e usera utworzonego w auth.setup.ts.
 * Best-effort: wymaga PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY w env
 * test-runnera (`.dev.vars` ładuje się tylko do dev-servera, nie do procesu
 * Playwright — eksportuj ręcznie jeśli chcesz cleanup). Bez env: pomijamy.
 */

const metaFile = path.join('tests', 'e2e', '.auth', 'user-meta.json');

teardown('delete shared user', async () => {
  const url = process.env.PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey || !fs.existsSync(metaFile)) return;

  const { email } = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) as { email: string };
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await admin.auth.admin.listUsers();
  const user = data?.users.find((u) => u.email === email);
  if (user) await admin.auth.admin.deleteUser(user.id);
});
