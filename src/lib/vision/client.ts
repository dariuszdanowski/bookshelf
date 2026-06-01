import Anthropic from '@anthropic-ai/sdk';
import { env } from 'cloudflare:workers';

import { REFINE_VISION_SYSTEM_PROMPT, VISION_SYSTEM_PROMPT } from './prompt';
import { DetectionSchema, type Detection } from './schema';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const THINKING_BUDGET_TOKENS = 1536;
// Sonnet pricing: $3/1M input tokens, $15/1M output tokens
const COST_IN_PER_M = 3;
const COST_OUT_PER_M = 15;

export type VisionResult =
  | { ok: true; detections: Detection[]; model: string; costUsd: number; latencyMs: number }
  | { ok: false; reason: 'parse_failure'; latencyMs: number };

function buildUserContent(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
): Anthropic.MessageParam['content'] {
  return [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    { type: 'text', text: 'Wymień książki na zdjęciu.' },
  ];
}

function buildRefineUserContent(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
): Anthropic.MessageParam['content'] {
  return [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    { type: 'text', text: 'To jest crop pojedynczego grzbietu. Zwróć jedną najlepszą propozycję albo [].' },
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
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

function tryParseDetections(
  text: string,
  attempt: 'first' | 'retry'
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

export async function detectSpines(input: {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<VisionResult> {
  const apiKey = env?.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;
  const client = new Anthropic({ apiKey });
  const start = Date.now();

  console.log('[vision:request]', {
    model: MODEL,
    mediaType: input.mediaType,
    base64Bytes: input.base64.length,
    systemPrompt: VISION_SYSTEM_PROMPT,
  });

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildUserContent(input.base64, input.mediaType) },
  ];

  // First attempt (no thinking)
  const first = await client.messages.create({
    model: MODEL,
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
    model: MODEL,
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

export async function detectSingleSpineFromCrop(input: {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<RefineVisionResult> {
  const apiKey = env?.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;
  const client = new Anthropic({ apiKey });
  const start = Date.now();

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildRefineUserContent(input.base64, input.mediaType) },
  ];

  const first = await client.messages.create({
    model: MODEL,
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
    model: MODEL,
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
