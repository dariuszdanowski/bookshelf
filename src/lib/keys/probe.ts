import type { z } from 'zod';
import type { ProviderEnum } from './schema';

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Weryfikuje klucz API przez GET /v1/models na endpoint providera.
 * Nie generuje kosztów LLM (probe-only). Zwraca 'ok' gdy 2xx, 'error' w
 * każdym innym przypadku (4xx/5xx/network error/missing baseUrl).
 */
export async function probeKey(
  provider: z.infer<typeof ProviderEnum>,
  apiKey: string,
  baseUrl?: string | null
): Promise<'ok' | 'error'> {
  try {
    let url: string;
    let headers: Record<string, string>;

    switch (provider) {
      case 'anthropic':
        url = ANTHROPIC_MODELS_URL;
        headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
        break;
      case 'openai':
        url = OPENAI_MODELS_URL;
        headers = { Authorization: `Bearer ${apiKey}` };
        break;
      case 'openrouter':
        url = OPENROUTER_MODELS_URL;
        headers = { Authorization: `Bearer ${apiKey}` };
        break;
      case 'openai_compatible':
        if (!baseUrl) return 'error';
        url = `${baseUrl}/v1/models`;
        headers = { Authorization: `Bearer ${apiKey}` };
        break;
    }

    const res = await fetch(url, { headers });
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
