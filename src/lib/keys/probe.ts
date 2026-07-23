import type { z } from 'zod';
import type { ProviderEnum } from './schema';

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

type ModelsRequest = { url: string; headers: Record<string, string> };

/**
 * Buduje URL + nagłówki dla GET /v1/models per provider. Współdzielone przez
 * probeKey (tylko sprawdza res.ok) i listModels (parsuje pełną listę) — jedno
 * miejsce znające kształt auth per provider.
 */
function resolveModelsRequest(
  provider: z.infer<typeof ProviderEnum>,
  apiKey: string,
  baseUrl?: string | null,
): ModelsRequest | null {
  switch (provider) {
    case 'anthropic':
      return {
        url: ANTHROPIC_MODELS_URL,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      };
    case 'openai':
      return { url: OPENAI_MODELS_URL, headers: { Authorization: `Bearer ${apiKey}` } };
    case 'openrouter':
      return { url: OPENROUTER_MODELS_URL, headers: { Authorization: `Bearer ${apiKey}` } };
    case 'openai_compatible':
      if (!baseUrl) return null;
      return { url: `${baseUrl}/v1/models`, headers: { Authorization: `Bearer ${apiKey}` } };
  }
}

/**
 * Weryfikuje klucz API przez GET /v1/models na endpoint providera.
 * Nie generuje kosztów LLM (probe-only). Zwraca 'ok' gdy 2xx, 'error' w
 * każdym innym przypadku (4xx/5xx/network error/missing baseUrl).
 */
export async function probeKey(
  provider: z.infer<typeof ProviderEnum>,
  apiKey: string,
  baseUrl?: string | null,
): Promise<'ok' | 'error'> {
  try {
    const req = resolveModelsRequest(provider, apiKey, baseUrl);
    if (!req) return 'error';
    const res = await fetch(req.url, { headers: req.headers });
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

export type ProviderModelInfo = { id: string; available: boolean };

// Wartości status/state uznawane za "niedostępny" (lowercased porównanie).
// Brak pola / nierozpoznana wartość → domyślnie dostępny (standard OpenAI
// /v1/models nie ma pojęcia dostępności — sama obecność w liście nią jest).
const UNAVAILABLE_STATUS_VALUES = new Set([
  'offline',
  'unavailable',
  'down',
  'disabled',
  'inactive',
  'error',
]);

function extractAvailability(entry: Record<string, unknown>): boolean {
  if (typeof entry.available === 'boolean') return entry.available;
  if (typeof entry.is_available === 'boolean') return entry.is_available;
  const statusLike = entry.status ?? entry.state;
  if (typeof statusLike === 'string') {
    return !UNAVAILABLE_STATUS_VALUES.has(statusLike.toLowerCase());
  }
  return true;
}

/**
 * Odpytuje GET /v1/models i zwraca listę modeli ze znacznikiem dostępności.
 * 10s timeout (lokalny/relay serwer może nigdy nie odpowiedzieć) — probeKey
 * celowo zostaje bez tej zmiany, zero zmiany jego zewnętrznego zachowania.
 */
export async function listModels(
  provider: z.infer<typeof ProviderEnum>,
  apiKey: string,
  baseUrl?: string | null,
): Promise<{ ok: boolean; models: ProviderModelInfo[] }> {
  const req = resolveModelsRequest(provider, apiKey, baseUrl);
  if (!req) return { ok: false, models: [] };

  try {
    const res = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, models: [] };

    const json: unknown = await res.json();
    const rawList: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray((json as { data?: unknown })?.data)
        ? (json as { data: unknown[] }).data
        : [];

    const models = rawList
      .filter(
        (entry): entry is Record<string, unknown> =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as Record<string, unknown>).id === 'string',
      )
      .map((entry) => ({ id: entry.id as string, available: extractAvailability(entry) }));

    models.sort((a, b) => Number(b.available) - Number(a.available) || a.id.localeCompare(b.id));

    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  }
}
