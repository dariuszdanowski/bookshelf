import { env } from 'cloudflare:workers';

import type { BookSearchResult } from './schema';

// Bump przy zmianie kształtu BookCandidate/BookSearchResult (schema.ts) — inaczej
// stare wpisy KV serwują niekompatybilny kształt do 30 dni po deployu (S-51).
export const CACHE_KEY_VERSION = 'v1';

export const CACHE_TTL_OK_SECONDS = 60 * 60 * 24 * 30; // 30 dni
export const CACHE_TTL_EMPTY_SECONDS = 60 * 60 * 24; // 1 dzień

/**
 * Opakowuje fetcher zwracający BookSearchResult w odczyt/zapis Workers KV.
 * Transparentne dla wywołującego — bez bindingu (dev/CI/Vitest) woła fetcher()
 * bezpośrednio. rate_limited/network NIGDY nie trafiają do KV (S-39 retry musi
 * móc próbować ponownie).
 */
export async function withApiCache(
  cacheKey: string,
  fetcher: () => Promise<BookSearchResult>,
): Promise<BookSearchResult> {
  const kv = env?.BOOK_API_CACHE_KV;
  if (!kv) return fetcher();

  const key = `${CACHE_KEY_VERSION}:${cacheKey}`;

  try {
    const cached = await kv.get<BookSearchResult>(key, 'json');
    if (cached) return cached;
  } catch (e) {
    console.error('[apiCache] KV read failed', {
      err: e instanceof Error ? e.message : String(e),
    });
  }

  const result = await fetcher();

  try {
    if (result.ok) {
      await kv.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_OK_SECONDS });
    } else if (result.reason === 'empty') {
      await kv.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_EMPTY_SECONDS });
    }
  } catch (e) {
    console.error('[apiCache] KV write failed', {
      err: e instanceof Error ? e.message : String(e),
    });
  }

  return result;
}
