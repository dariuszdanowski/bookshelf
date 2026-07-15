import { test as teardown } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cleanup project — kasuje współdzielonego e2e usera utworzonego w auth.setup.ts.
 *
 * Best-effort: PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY z env procesu
 * Playwright, z fallbackiem do `.dev.vars` (ten sam wzorzec co
 * admin.spec.ts::readDevVars()). `.dev.vars` ładuje się tylko do dev-servera,
 * nie do procesu Playwright — bez tego fallbacku ten teardown cicho no-opował
 * KAŻDY run (potwierdzone: 551 zalegających kont testowych w lokalnej bazie).
 * Bez env/pliku meta: nadal pomijamy (best-effort, nie hard fail).
 */

const metaFile = path.join('tests', 'e2e', '.auth', 'user-meta.json');

function readDevVars(): Record<string, string> {
  try {
    const content = fs.readFileSync(path.join(process.cwd(), '.dev.vars'), 'utf-8');
    const result: Record<string, string> = {};
    // split(/\r?\n/) — nie split('\n'): .dev.vars ma CRLF, gołe split('\n')
    // zostawia \r na końcu każdej linii, przez co (.+)$ (bez flagi /m/) nigdy
    // nie dopasowuje (potwierdzone empirycznie — ten sam bug w admin.spec.ts).
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m) result[m[1]] = m[2].trim();
    }
    return result;
  } catch {
    return {};
  }
}

teardown('delete shared user', async () => {
  const devVars = readDevVars();
  const url = process.env.PUBLIC_SUPABASE_URL || devVars['PUBLIC_SUPABASE_URL'] || '';
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || devVars['SUPABASE_SERVICE_ROLE_KEY'] || '';
  if (!url || !serviceKey || !fs.existsSync(metaFile)) return;

  const { email } = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) as { email: string };
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // perPage wysoko ustawione: listUsers() domyślnie sortuje rosnąco po
  // created_at (najstarsi first) — przy dużej liczbie zalegających kont
  // testowych świeżo utworzony shared user byłby poza domyślną page 1 (50).
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = data?.users.find((u) => u.email === email);
  if (user) await admin.auth.admin.deleteUser(user.id);
});
