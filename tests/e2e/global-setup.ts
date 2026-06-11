import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Czeka aż Supabase auth health endpoint odpowie 200.
 * Niezbędne przy lokalnym WSL stacku — GoTrue restartuje 2-3× zanim DB będzie gotowe (~15s).
 * Bez tego auth.setup łapie status:0 lub 503 na pierwszym signupie.
 *
 * Playwright przekazuje FullConfig jako pierwszy argument do globalSetup —
 * dlatego eksportujemy wrapper, a nie waitForSupabaseAuth bezpośrednio.
 */
async function waitForSupabaseAuth(timeoutMs = 30_000): Promise<void> {
  const devVarsPath = resolve(process.cwd(), '.dev.vars');
  let supabaseUrl = 'http://127.0.0.1:54321';

  try {
    const content = readFileSync(devVarsPath, 'utf-8');
    const match = content.match(/^PUBLIC_SUPABASE_URL=(.+)$/m);
    if (match) supabaseUrl = match[1].trim();
  } catch {
    // .dev.vars niedostępny — cloud URL; health check nie jest potrzebny (cloud zawsze up)
    return;
  }

  // Tylko dla lokalnego stacku (nie dla chmury Supabase)
  if (
    !supabaseUrl.includes('127.0.0.1') &&
    !supabaseUrl.match(/^http:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)
  ) {
    return;
  }

  const healthUrl = `${supabaseUrl}/auth/v1/health`;
  const deadline = Date.now() + timeoutMs;

  console.log(`[global-setup] Czekam na Supabase auth: ${healthUrl} (max ${timeoutMs / 1000}s)`);

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(3_000) });
      if (resp.ok) {
        console.log('[global-setup] Supabase auth gotowy.');
        return;
      }
      console.log(`[global-setup] Auth odpowiedział ${resp.status} — czekam…`);
    } catch {
      console.log('[global-setup] Auth nieosiągalny — czekam…');
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  throw new Error(
    `[global-setup] Timeout ${timeoutMs / 1000}s — Supabase auth nieresponsywny (${healthUrl}).\n` +
      `Upewnij się że lokalny stack Supabase działa (supabase start w WSL)\n` +
      `i że okno WSL terminala jest otwarte.`,
  );
}

export default async function globalSetup(): Promise<void> {
  await waitForSupabaseAuth(30_000);
}
