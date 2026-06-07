// Static import replaced with import type + lazy loader below.
// Reason: Vite SSR optimizer fails to pre-bundle @anthropic-ai/sdk (CJS with dynamic
// require). Dynamic import inside async functions bypasses the static dep graph,
// so Vite never tries to create deps_ssr/@anthropic-ai_sdk.js.
import type Anthropic from '@anthropic-ai/sdk';

import { REFINE_VISION_SYSTEM_PROMPT, VISION_SYSTEM_PROMPT } from './prompt';
import { DetectionSchema, type Detection } from './schema';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_COMPAT_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 4096;
const THINKING_BUDGET_TOKENS = 1536;
// Sonnet pricing: $3/1M input tokens, $15/1M output tokens
const COST_IN_PER_M = 3;
const COST_OUT_PER_M = 15;

export type VisionProviderConfig = {
  provider: 'anthropic' | 'openai' | 'openrouter' | 'openai_compatible';
  apiKey: string;
  model?: string | null;
  baseUrl?: string | null;
  /** M27: id klucza (user_api_keys.id) do atrybucji kosztów per klucz */
  keyId?: string | null;
};

async function makeClient(apiKey: string) {
  const { default: AnthropicSDK } = await import('@anthropic-ai/sdk');
  return new AnthropicSDK({ apiKey });
}

export type VisionResult =
  | { ok: true; detections: Detection[]; model: string; costUsd: number; latencyMs: number }
  | { ok: false; reason: 'parse_failure'; latencyMs: number };

function buildUserContent(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
): Anthropic.MessageParam['content'] {
  return [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    { type: 'text', text: 'Wymień książki na zdjęciu.' },
  ];
}

function buildRefineUserContent(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
): Anthropic.MessageParam['content'] {
  return [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    {
      type: 'text',
      text: 'To jest crop pojedynczego grzbietu. Zwróć jedną najlepszą propozycję albo [].',
    },
  ];
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function calcCost(usage: { input_tokens: number; output_tokens: number }): number {
  return (
    (usage.input_tokens / 1_000_000) * COST_IN_PER_M +
    (usage.output_tokens / 1_000_000) * COST_OUT_PER_M
  );
}

// Claude wraps JSON in markdown code fences despite prompt instructions — strip before parsing
export function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function tryParseDetections(
  text: string,
  attempt: 'first' | 'retry',
): { ok: true; data: Detection[] } | { ok: false } {
  console.log(`[vision:raw-response:${attempt}]`, text);
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    const result = DetectionSchema.safeParse(parsed);
    if (!result.success) {
      console.error(`[vision:parse-fail:${attempt}]`, JSON.stringify(result.error.issues));
    }
    return result.success ? { ok: true, data: result.data } : { ok: false };
  } catch (e) {
    console.error(`[vision:json-fail:${attempt}]`, String(e));
    return { ok: false };
  }
}

// OpenAI-compatible path: single-attempt fetch, no retry-with-thinking, costUsd = 0.
async function detectSpinesOpenAICompat(
  input: { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' },
  config: VisionProviderConfig,
  systemPrompt: string,
  userText: string,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const baseUrl = config.baseUrl ?? 'https://api.openai.com';
  const model = config.model ?? DEFAULT_OPENAI_COMPAT_MODEL;
  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${input.mediaType};base64,${input.base64}` },
            },
            { type: 'text', text: userText },
          ],
        },
      ],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('[vision:openai-compat:http-error]', { status: resp.status, body });
    return { ok: false };
  }
  const json = await resp.json();
  const content: unknown = (json as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    console.error('[vision:openai-compat:no-content]', JSON.stringify(json));
    return { ok: false };
  }
  return { ok: true, text: content };
}

export async function detectSpines(
  input: { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' },
  config: VisionProviderConfig,
): Promise<VisionResult> {
  const start = Date.now();

  if (config.provider !== 'anthropic') {
    const result = await detectSpinesOpenAICompat(
      input,
      config,
      VISION_SYSTEM_PROMPT,
      'Wymień książki na zdjęciu.',
    );
    const latencyMs = Date.now() - start;
    if (!result.ok) return { ok: false, reason: 'parse_failure', latencyMs };
    const parsed = tryParseDetections(result.text, 'first');
    if (!parsed.ok) return { ok: false, reason: 'parse_failure', latencyMs };
    return {
      ok: true,
      detections: parsed.data,
      model: config.model ?? DEFAULT_OPENAI_COMPAT_MODEL,
      costUsd: 0,
      latencyMs,
    };
  }

  // Anthropic path
  const client = await makeClient(config.apiKey);
  const model = config.model ?? DEFAULT_ANTHROPIC_MODEL;

  console.log('[vision:request]', {
    model,
    mediaType: input.mediaType,
    base64Bytes: input.base64.length,
    systemPrompt: VISION_SYSTEM_PROMPT,
  });

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildUserContent(input.base64, input.mediaType) },
  ];

  const first = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: VISION_SYSTEM_PROMPT,
    messages,
  });

  const firstParsed = tryParseDetections(extractText(first.content), 'first');
  if (firstParsed.ok) {
    console.log('[vision:success:first]', {
      detectionCount: firstParsed.data.length,
      costUsd: calcCost(first.usage),
      latencyMs: Date.now() - start,
    });
    return {
      ok: true,
      detections: firstParsed.data,
      model: first.model,
      costUsd: calcCost(first.usage),
      latencyMs: Date.now() - start,
    };
  }

  // Retry once with extended thinking (ZodError/JSON-parse-fail fallback)
  console.log('[vision:retry-with-thinking]');
  const retry = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS },
    system: VISION_SYSTEM_PROMPT,
    messages,
  });

  const retryParsed = tryParseDetections(extractText(retry.content), 'retry');
  const totalCost = calcCost(first.usage) + calcCost(retry.usage);

  if (retryParsed.ok) {
    console.log('[vision:success:retry]', {
      detectionCount: retryParsed.data.length,
      costUsd: totalCost,
      latencyMs: Date.now() - start,
    });
    return {
      ok: true,
      detections: retryParsed.data,
      model: retry.model,
      costUsd: totalCost,
      latencyMs: Date.now() - start,
    };
  }

  console.error('[vision:parse-failure-final]', { latencyMs: Date.now() - start, totalCost });
  return { ok: false, reason: 'parse_failure', latencyMs: Date.now() - start };
}

export type RefineVisionResult =
  | { ok: true; detection: Detection; model: string; costUsd: number; latencyMs: number }
  | { ok: false; reason: 'parse_failure'; latencyMs: number };

export async function detectSingleSpineFromCrop(
  input: { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' },
  config: VisionProviderConfig,
): Promise<RefineVisionResult> {
  const start = Date.now();

  if (config.provider !== 'anthropic') {
    const result = await detectSpinesOpenAICompat(
      input,
      config,
      REFINE_VISION_SYSTEM_PROMPT,
      'To jest crop pojedynczego grzbietu. Zwróć jedną najlepszą propozycję albo [].',
    );
    const latencyMs = Date.now() - start;
    if (!result.ok) return { ok: false, reason: 'parse_failure', latencyMs };
    const parsed = tryParseDetections(result.text, 'first');
    if (!parsed.ok || parsed.data.length === 0)
      return { ok: false, reason: 'parse_failure', latencyMs };
    return {
      ok: true,
      detection: parsed.data[0],
      model: config.model ?? DEFAULT_OPENAI_COMPAT_MODEL,
      costUsd: 0,
      latencyMs,
    };
  }

  // Anthropic path
  const client = await makeClient(config.apiKey);
  const model = config.model ?? DEFAULT_ANTHROPIC_MODEL;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildRefineUserContent(input.base64, input.mediaType) },
  ];

  const first = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: REFINE_VISION_SYSTEM_PROMPT,
    messages,
  });

  const firstParsed = tryParseDetections(extractText(first.content), 'first');
  if (firstParsed.ok && firstParsed.data.length > 0) {
    return {
      ok: true,
      detection: firstParsed.data[0],
      model: first.model,
      costUsd: calcCost(first.usage),
      latencyMs: Date.now() - start,
    };
  }

  const retry = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS },
    system: REFINE_VISION_SYSTEM_PROMPT,
    messages,
  });

  const retryParsed = tryParseDetections(extractText(retry.content), 'retry');
  const totalCost = calcCost(first.usage) + calcCost(retry.usage);

  if (retryParsed.ok && retryParsed.data.length > 0) {
    return {
      ok: true,
      detection: retryParsed.data[0],
      model: retry.model,
      costUsd: totalCost,
      latencyMs: Date.now() - start,
    };
  }

  return { ok: false, reason: 'parse_failure', latencyMs: Date.now() - start };
}
