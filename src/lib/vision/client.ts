import Anthropic from '@anthropic-ai/sdk';
import { env } from 'cloudflare:workers';

import { VISION_SYSTEM_PROMPT } from './prompt';
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

function tryParseDetections(text: string): { ok: true; data: Detection[] } | { ok: false } {
  try {
    const result = DetectionSchema.safeParse(JSON.parse(text));
    return result.success ? { ok: true, data: result.data } : { ok: false };
  } catch {
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

  const firstParsed = tryParseDetections(extractText(first.content));
  if (firstParsed.ok) {
    return {
      ok: true,
      detections: firstParsed.data,
      model: first.model,
      costUsd: calcCost(first.usage),
      latencyMs: Date.now() - start,
    };
  }

  // Retry once with extended thinking (ZodError/JSON-parse-fail fallback)
  const retry = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS },
    system: VISION_SYSTEM_PROMPT,
    messages,
  });

  const retryParsed = tryParseDetections(extractText(retry.content));
  const totalCost = calcCost(first.usage) + calcCost(retry.usage);

  if (retryParsed.ok) {
    return {
      ok: true,
      detections: retryParsed.data,
      model: retry.model,
      costUsd: totalCost,
      latencyMs: Date.now() - start,
    };
  }

  return { ok: false, reason: 'parse_failure', latencyMs: Date.now() - start };
}
