// Lazy import (nie statyczny) — Vite SSR pre-bundling @anthropic-ai/sdk psuje się
// w Cloudflare Workers build (patrz src/lib/vision/client.ts, ten sam wzorzec).
import type Anthropic from '@anthropic-ai/sdk';

import { AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT, AI_RESOLUTION_SYSTEM_PROMPT } from './prompt';
import { AiResolutionResultSchema, type AiResolutionResult } from './schema';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
// resolution-openai-compatible-provider: duplikat vision/client.ts DEFAULT_OPENAI_COMPAT_MODEL —
// moduły domenowe w tym repo nie współdzielą stałych między src/lib/<domain>/.
const DEFAULT_OPENAI_COMPAT_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 2048;
const MAX_WEB_SEARCH_USES = 3;
// Sonnet pricing: $3/1M input tokens, $15/1M output tokens (duplikat vision/client.ts —
// moduły domenowe w tym repo nie współdzielą stałych między src/lib/<domain>/).
const COST_IN_PER_M = 3;
const COST_OUT_PER_M = 15;
const COST_PER_WEB_SEARCH = 0.01;

export type AiResolutionProviderConfig = {
  /** Opcjonalne — brak (undefined) domyślnie oznacza 'anthropic' (dotychczasowe zachowanie modułu). */
  provider?: 'anthropic' | 'openai' | 'openrouter' | 'openai_compatible';
  apiKey: string;
  model?: string | null;
  baseUrl?: string | null;
  /** M27-style: id klucza (user_api_keys.id) do atrybucji kosztów per klucz */
  keyId?: string | null;
  /** resolution-openai-compatible-provider: per-klucz override timeoutu/limitu tokenów dla openai-compat brancha */
  requestTimeoutMs?: number | null;
  maxTokensOverride?: number | null;
};

export type AiResolutionQuery = {
  rawTitle: string;
  rawAuthor: string | null;
  publisher?: string | null;
};

export type AiResolutionOutcome =
  | {
      ok: true;
      result: AiResolutionResult;
      model: string;
      costUsd: number;
      searchCount: number;
      latencyMs: number;
    }
  | {
      ok: false;
      reason: 'parse_failure' | 'api_error';
      latencyMs: number;
      errorMessage?: string;
    };

async function makeClient(apiKey: string) {
  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk');
  return new AnthropicSDK({ apiKey });
}

function buildUserPrompt(query: AiResolutionQuery): string {
  const lines = [`Tytuł (OCR): ${query.rawTitle}`];
  if (query.rawAuthor) lines.push(`Autor (OCR): ${query.rawAuthor}`);
  if (query.publisher) lines.push(`Wydawnictwo (OCR): ${query.publisher}`);
  return lines.join('\n');
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// Claude wraps JSON in markdown code fences despite prompt instructions — strip before parsing.
// `^` regex anchor requires leading whitespace to be stripped in the SAME pattern (a
// self-hosted model observed replying with a leading "\n" before the fence — `^` doesn't
// match past it, leaving "```json" attached to the JSON and breaking JSON.parse).
function stripCodeFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

// Defense-in-depth: web_search tool ma silną tendencję do dołączania cytowań
// źródeł i narracyjnego podsumowania obok (albo zamiast) czystego JSON, mimo
// instrukcji promptu (zmierzone manualnie — patrz prompt.ts v2). AiResolutionResult
// jest płaskim obiektem bez zagnieżdżonych `{}` (authors to tablica, nie obiekt),
// więc wystarczy wyciągnąć OSTATNI blok `{...}` z odpowiedzi zamiast ufać, że
// cała odpowiedź to czysty JSON.
function extractLastJsonCandidate(text: string): string {
  const matches = stripCodeFences(text).match(/\{[^{}]*\}/g);
  if (matches && matches.length > 0) return matches[matches.length - 1];
  return stripCodeFences(text);
}

function calcCost(usage: Anthropic.Usage): number {
  const searchCount = usage.server_tool_use?.web_search_requests ?? 0;
  return (
    (usage.input_tokens / 1_000_000) * COST_IN_PER_M +
    (usage.output_tokens / 1_000_000) * COST_OUT_PER_M +
    searchCount * COST_PER_WEB_SEARCH
  );
}

// resolution-openai-compatible-provider: branch dla providerów bez natywnego
// web_search (self-hosted / OpenAI-compatible modele) — identyfikacja wyłącznie
// z wiedzy treningowej modelu. searchCount i costUsd zawsze 0 (spójne z
// vision/client.ts::detectSpinesOpenAICompat — „system nie płaci za klucz usera").
async function resolveViaOpenAICompat(
  query: AiResolutionQuery,
  config: AiResolutionProviderConfig,
): Promise<AiResolutionOutcome> {
  const start = Date.now();
  const baseUrl = config.baseUrl ?? 'https://api.openai.com';
  const model = config.model ?? DEFAULT_OPENAI_COMPAT_MODEL;

  const controller = config.requestTimeoutMs != null ? new AbortController() : null;
  const timeoutId =
    controller && config.requestTimeoutMs != null
      ? setTimeout(() => controller.abort(), config.requestTimeoutMs)
      : null;

  let json: unknown;
  try {
    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: config.maxTokensOverride ?? MAX_TOKENS,
          messages: [
            { role: 'system', content: AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(query) },
          ],
        }),
        signal: controller?.signal,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[resolution:openai-compat:http-error]', { status: resp.status, body });
      return {
        ok: false,
        reason: 'api_error',
        latencyMs: Date.now() - start,
        errorMessage: `HTTP ${resp.status}`,
      };
    }
    json = await resp.json();
  } catch (err) {
    console.error(
      '[resolution:openai-compat:fetch-error]',
      err instanceof Error ? err.message : String(err),
    );
    return {
      ok: false,
      reason: 'api_error',
      latencyMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const latencyMs = Date.now() - start;
  const content: unknown = (json as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    console.error('[resolution:openai-compat:no-content]', JSON.stringify(json));
    return { ok: false, reason: 'parse_failure', latencyMs };
  }
  console.log('[resolution:openai-compat:raw-response]', content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractLastJsonCandidate(content));
  } catch (err) {
    console.error('[resolution:openai-compat:json-fail]', String(err));
    return { ok: false, reason: 'parse_failure', latencyMs };
  }

  const result = AiResolutionResultSchema.safeParse(parsed);
  if (!result.success) {
    console.error('[resolution:openai-compat:parse-fail]', JSON.stringify(result.error.issues));
    return { ok: false, reason: 'parse_failure', latencyMs };
  }

  return { ok: true, result: result.data, model, costUsd: 0, searchCount: 0, latencyMs };
}

export async function resolveBookViaAI(
  query: AiResolutionQuery,
  config: AiResolutionProviderConfig,
): Promise<AiResolutionOutcome> {
  const provider = config.provider ?? 'anthropic';
  if (provider !== 'anthropic') return resolveViaOpenAICompat(query, config);

  const start = Date.now();
  const model = config.model ?? DEFAULT_MODEL;

  let response: Anthropic.Message;
  try {
    const client = await makeClient(config.apiKey);
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: AI_RESOLUTION_SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCH_USES }],
      messages: [{ role: 'user', content: buildUserPrompt(query) }],
    });
  } catch (err) {
    console.error('[resolution:api-error]', err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      reason: 'api_error',
      latencyMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const latencyMs = Date.now() - start;
  const searchCount = response.usage.server_tool_use?.web_search_requests ?? 0;
  const costUsd = calcCost(response.usage);

  const text = extractText(response.content);
  console.log('[resolution:raw-response]', text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractLastJsonCandidate(text));
  } catch (err) {
    console.error('[resolution:json-fail]', String(err));
    return { ok: false, reason: 'parse_failure', latencyMs };
  }

  const result = AiResolutionResultSchema.safeParse(parsed);
  if (!result.success) {
    console.error('[resolution:parse-fail]', JSON.stringify(result.error.issues));
    return { ok: false, reason: 'parse_failure', latencyMs };
  }

  return {
    ok: true,
    result: result.data,
    model: response.model,
    costUsd,
    searchCount,
    latencyMs,
  };
}
