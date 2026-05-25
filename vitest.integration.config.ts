import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Minimalny parser dotenv-style. Czytamy ręcznie, bo sekrety w tym repo żyją w
 * `.dev.vars` (konwencja Cloudflare/wrangler), a Vite `loadEnv` ładuje tylko
 * pliki `.env*`. Wspieramy oba: `.env.local` i `.dev.vars`.
 */
function loadEnvFile(file: string): Record<string, string> {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return {};

  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Lokalnie sekrety idą z pliku; w CI obu plików brak → fileEnv puste, test
// czyta prawdziwy process.env (sekrety z GitHub Secrets).
// Precedencja: .dev.vars wygrywa z .env.local (konwencja Cloudflare to .dev.vars);
// Vitest merge'uje `env` NA process.env, więc CI-fallback nadal działa.
const fileEnv = { ...loadEnvFile('.env.local'), ...loadEnvFile('.dev.vars') };

export default defineConfig({
  test: {
    // node, NIE jsdom — test hituje realny Supabase przez sieć.
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.{test,spec}.{ts,tsx}'],
    // Odseparowane od domyślnego `npm run test` (vitest.config.ts → tests/unit/**),
    // żeby drogi/sieciowy run nie wchodził do offline'owego unit loopa.
    env: fileEnv,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
