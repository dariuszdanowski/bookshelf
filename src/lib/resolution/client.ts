// Lazy import (nie statyczny) — Vite SSR pre-bundling @anthropic-ai/sdk psuje się
// w Cloudflare Workers build (patrz src/lib/vision/client.ts, ten sam wzorzec).
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { findBookCandidates } from '../matching/findCandidates';
import {
  AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT,
  AI_RESOLUTION_OPENAI_COMPAT_TOOLS_SYSTEM_PROMPT,
  AI_RESOLUTION_SYSTEM_PROMPT,
} from './prompt';
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

// ai-resolution-search-tool: search_book tool dla providerów openai/openrouter/openai_compatible
// (brak natywnego web_search) — owija findBookCandidates (Google Books + Open Library +
// Biblioteka Narodowa), pozwalając modelowi zweryfikować zgadywaną książkę zamiast polegać
// wyłącznie na wiedzy treningowej. Patrz plan: context/changes/ai-resolution-search-tool/plan.md.
const SearchBookToolArgsSchema = z.object({
  title: z.string().min(1),
  author: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
});

const SEARCH_BOOK_TOOL = {
  type: 'function',
  function: {
    name: 'search_book',
    description:
      'Szuka książki po tytule/autorze/ISBN w Google Books, Open Library i Bibliotece ' +
      'Narodowej. Zwraca do 8 najlepiej dopasowanych kandydatów z tytułem, autorami, ' +
      'ISBN, wydawcą, rokiem wydania i wynikiem dopasowania (0-1).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tytuł książki (może pochodzić z zaszumionego OCR)' },
        author: { type: ['string', 'null'], description: 'Autor, jeśli znany' },
        isbn: { type: ['string', 'null'], description: 'ISBN-10 lub ISBN-13, jeśli znany' },
      },
      required: ['title'],
    },
  },
} as const;

const MAX_TOOL_ROUNDS = 3;
// Limit równoległych tool_calls w jednej rundzie — bez tego worst-case liczby wywołań
// findBookCandidates w JEDNEJ rundzie byłby nieograniczony (zob. plan § Krytyczne szczegóły
// implementacji, F1 z /10x-plan-review).
const MAX_PARALLEL_TOOL_CALLS = 3;

type ToolCallMsg = { id: string; type: 'function'; function: { name: string; arguments: string } };

type OpenAiCompatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCallMsg[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type ChatCompletionResult =
  { ok: true; json: unknown } | { ok: false; status: number | null; outcome: AiResolutionOutcome };

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

// Pojedyncze zapytanie chat/completions z własnym, świeżym AbortController/setTimeout —
// w pętli tool-callingu każdy request (initial + każda runda) dostaje osobny kontroler,
// bo AbortController.abort() jest jednorazowy (nie da się reużyć na kolejny fetch w pętli).
// requestTimeoutMs jest więc budżetem PER REQUEST, nie budżetem na całą pętlę.
async function postOpenAiCompatChatCompletion(
  baseUrl: string,
  model: string,
  config: AiResolutionProviderConfig,
  messages: OpenAiCompatMessage[],
  tools: readonly [typeof SEARCH_BOOK_TOOL] | undefined,
  start: number,
): Promise<ChatCompletionResult> {
  const controller = config.requestTimeoutMs != null ? new AbortController() : null;
  const timeoutId =
    controller && config.requestTimeoutMs != null
      ? setTimeout(() => controller.abort(), config.requestTimeoutMs)
      : null;

  let resp: Response;
  try {
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
          messages,
          ...(tools ? { tools } : {}),
        }),
        signal: controller?.signal,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch (err) {
    console.error(
      '[resolution:openai-compat:fetch-error]',
      err instanceof Error ? err.message : String(err),
    );
    return {
      ok: false,
      status: null,
      outcome: {
        ok: false,
        reason: 'api_error',
        latencyMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('[resolution:openai-compat:http-error]', { status: resp.status, body });
    return {
      ok: false,
      status: resp.status,
      outcome: {
        ok: false,
        reason: 'api_error',
        latencyMs: Date.now() - start,
        errorMessage: `HTTP ${resp.status}`,
      },
    };
  }

  return { ok: true, json: await resp.json() };
}

type ExtractedMessage = { content: string | null; toolCalls: ToolCallMsg[] };

function extractOpenAiCompatMessage(json: unknown): ExtractedMessage | null {
  const message = (
    json as {
      choices?: { message?: { content?: unknown; tool_calls?: unknown } }[];
    }
  )?.choices?.[0]?.message;
  if (!message) return null;

  const content = typeof message.content === 'string' ? message.content : null;
  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls: ToolCallMsg[] = rawToolCalls
    .filter(
      (tc): tc is { id: string; type: 'function'; function: { name: string; arguments: string } } =>
        typeof tc?.id === 'string' &&
        tc?.type === 'function' &&
        typeof tc?.function?.name === 'string' &&
        typeof tc?.function?.arguments === 'string',
    )
    .map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

  return { content, toolCalls };
}

// resolution-openai-compatible-provider / ai-resolution-search-tool: branch dla providerów bez
// natywnego web_search (self-hosted / OpenAI-compatible modele) — model może samodzielnie
// wywołać search_book (owinięty findBookCandidates) do MAX_TOOL_ROUNDS razy zamiast polegać
// wyłącznie na wiedzy treningowej. Serwery bez wsparcia `tools` (HTTP 400 na pierwszym
// requeście) dostają fallback na dzisiejszą, jednostrzałową ścieżkę bez zmian. costUsd zawsze
// 0 (spójne z vision/client.ts::detectSpinesOpenAICompat — „system nie płaci za klucz usera");
// findBookCandidates jest darmowe (GB/OL/BN + cache w apiCache.ts), płatny jest wyłącznie
// klucz LLM usera.
async function resolveViaOpenAICompat(
  query: AiResolutionQuery,
  config: AiResolutionProviderConfig,
): Promise<AiResolutionOutcome> {
  const start = Date.now();
  const baseUrl = config.baseUrl ?? 'https://api.openai.com';
  const model = config.model ?? DEFAULT_OPENAI_COMPAT_MODEL;

  let messages: OpenAiCompatMessage[] = [
    { role: 'system', content: AI_RESOLUTION_OPENAI_COMPAT_TOOLS_SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(query) },
  ];

  let round = 0;
  let searchCount = 0;
  let toolsEnabled = true;
  let fallbackAttempted = false;

  while (true) {
    const useTools = toolsEnabled && round < MAX_TOOL_ROUNDS;
    const fetchResult = await postOpenAiCompatChatCompletion(
      baseUrl,
      model,
      config,
      messages,
      useTools ? [SEARCH_BOOK_TOOL] : undefined,
      start,
    );

    if (!fetchResult.ok) {
      // Fallback bez `tools` dotyczy WYŁĄCZNIE pierwszego requestu (round === 0, przed
      // jakąkolwiek udaną rundą z tools) na HTTP 400 — dzisiejsze zachowanie dla serwerów
      // bez wsparcia function-calling. HTTP 400 w trakcie pętli (po co najmniej jednej
      // udanej rundzie z tools) NIE triggeruje fallbacku, serwer już potwierdził wsparcie.
      if (round === 0 && !fallbackAttempted && fetchResult.status === 400) {
        fallbackAttempted = true;
        toolsEnabled = false;
        messages = [
          { role: 'system', content: AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(query) },
        ];
        continue;
      }
      return fetchResult.outcome;
    }

    const message = extractOpenAiCompatMessage(fetchResult.json);
    if (!message) {
      console.error('[resolution:openai-compat:no-content]', JSON.stringify(fetchResult.json));
      return { ok: false, reason: 'parse_failure', latencyMs: Date.now() - start };
    }

    if (useTools && message.toolCalls.length > 0) {
      console.log('[resolution:openai-compat:tool-call]', {
        round: round + 1,
        toolCallCount: message.toolCalls.length,
      });
      messages = [
        ...messages,
        { role: 'assistant', content: message.content, tool_calls: message.toolCalls },
      ];

      for (let i = 0; i < message.toolCalls.length; i++) {
        const toolCall = message.toolCalls[i];

        if (i >= MAX_PARALLEL_TOOL_CALLS) {
          messages = [
            ...messages,
            {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: '{"error": "too many parallel tool calls in one round, max 3"}',
            },
          ];
          continue;
        }

        const argsResult = (() => {
          try {
            const rawArgs: unknown = JSON.parse(toolCall.function.arguments);
            return SearchBookToolArgsSchema.safeParse(rawArgs);
          } catch {
            return null;
          }
        })();

        if (!argsResult || !argsResult.success) {
          messages = [
            ...messages,
            { role: 'tool', tool_call_id: toolCall.id, content: '{"error": "invalid arguments"}' },
          ];
          continue;
        }

        searchCount += 1;
        const { candidates, rateLimited } = await findBookCandidates(
          argsResult.data.title,
          argsResult.data.author ?? query.rawAuthor ?? null,
          argsResult.data.isbn ?? null,
        );
        const trimmedCandidates = candidates.map((c) => ({
          title: c.title,
          authors: c.authors,
          isbn10: c.isbn10,
          isbn13: c.isbn13,
          publisher: c.publisher,
          publishedYear: c.publishedYear,
          matchScore: c.matchScore,
        }));
        const toolContent =
          trimmedCandidates.length === 0 && rateLimited
            ? { candidates: trimmedCandidates, rateLimited: true }
            : { candidates: trimmedCandidates };

        messages = [
          ...messages,
          { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(toolContent) },
        ];
      }

      round += 1;
      continue;
    }

    const latencyMs = Date.now() - start;
    const text = message.content ?? '';
    console.log('[resolution:openai-compat:raw-response]', text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractLastJsonCandidate(text));
    } catch (err) {
      console.error('[resolution:openai-compat:json-fail]', String(err));
      return { ok: false, reason: 'parse_failure', latencyMs };
    }

    const parsedResult = AiResolutionResultSchema.safeParse(parsed);
    if (!parsedResult.success) {
      console.error(
        '[resolution:openai-compat:parse-fail]',
        JSON.stringify(parsedResult.error.issues),
      );
      return { ok: false, reason: 'parse_failure', latencyMs };
    }

    return { ok: true, result: parsedResult.data, model, costUsd: 0, searchCount, latencyMs };
  }
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
