import { env } from 'cloudflare:workers';

/**
 * Detekcja środowiska Supabase, do którego podpięty jest serwer.
 * Cel: zero pomyłki "mutuję local czy prod". Wynik napędza badge w UI
 * (EnvBadge.astro) + prefix w <title> + jednorazowy log startupowy.
 *
 * Kryterium: `PUBLIC_SUPABASE_URL` zawiera `127.0.0.1`/`localhost` → local.
 * Cokolwiek innego → prod. Brak URL → unknown (bootstrap fail).
 */
export type DbEnvironment = 'local' | 'prod' | 'unknown';

function readSupabaseUrl(): string {
  return (env?.PUBLIC_SUPABASE_URL ?? import.meta.env.PUBLIC_SUPABASE_URL ?? '') as string;
}

// Local = loopback ALBO prywatne IPv4 (RFC1918). Workaround dla WSL2 NAT:
// switch-env.mjs podstawia WSL IP (np. 192.168.x.x) gdy Astro biegnie w Windows
// a Supabase w WSL — wtedy URL nie jest 127.0.0.1, ale to wciąż local stack.
const LOCAL_HOST_RE = /:\/\/(?:127\.0\.0\.1|localhost|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/;

export function detectDbEnvironment(): DbEnvironment {
  const url = readSupabaseUrl();
  if (!url) return 'unknown';
  if (LOCAL_HOST_RE.test(url)) return 'local';
  return 'prod';
}

export function getSupabaseUrl(): string {
  return readSupabaseUrl();
}

export const ENV_LABEL: Record<DbEnvironment, string> = {
  local: 'LOCAL DB',
  prod: 'PROD DB',
  unknown: 'UNKNOWN DB',
};

export function getStudioUrl(): string | null {
  const url = readSupabaseUrl();
  if (!url) return null;
  if (LOCAL_HOST_RE.test(url)) {
    return url.replace(':54321', ':54323');
  }
  // prod: https://<ref>.supabase.co → dashboard
  try {
    const { hostname } = new URL(url);
    const ref = hostname.split('.')[0];
    return `https://supabase.com/dashboard/project/${ref}`;
  } catch {
    return null;
  }
}
