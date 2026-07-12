// Lazy import (nie statyczny) — Vite SSR pre-bundling @anthropic-ai/sdk psuje się
// w Cloudflare Workers build (patrz src/lib/vision/client.ts, ten sam wzorzec).
import type Anthropic from '@anthropic-ai/sdk';

import { AI_RESOLUTION_SYSTEM_PROMPT } from './prompt';
import { AiResolutionResultSchema, type AiResolutionResult } from './schema';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;
const MAX_WEB_SEARCH_USES = 3;
// Sonnet pricing: $3/1M input tokens, $15/1M output tokens (duplikat vision/client.ts —
// moduły domenowe w tym repo nie współdzielą stałych między src/lib/<domain>/).
const COST_IN_PER_M = 3;
const COST_OUT_PER_M = 15;
const COST_PER_WEB_SEARCH = 0.01;

export type AiResolutionProviderConfig = {
  apiKey: string;
  model?: string | null;
  /** M27-style: id klucza (user_api_keys.id) do atrybucji kosztów per klucz */
  keyId?: string | null;
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
function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function calcCost(usage: Anthropic.Usage): number {
  const searchCount = usage.server_tool_use?.web_search_requests ?? 0;
  return (
    (usage.input_tokens / 1_000_000) * COST_IN_PER_M +
    (usage.output_tokens / 1_000_000) * COST_OUT_PER_M +
    searchCount * COST_PER_WEB_SEARCH
  );
}

export async function resolveBookViaAI(
  query: AiResolutionQuery,
  config: AiResolutionProviderConfig,
): Promise<AiResolutionOutcome> {
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
    parsed = JSON.parse(stripCodeFences(text));
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
