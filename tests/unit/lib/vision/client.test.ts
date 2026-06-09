import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted ensures mockCreate is initialized before vi.mock factory runs (ESM hoisting)
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

import {
  detectSingleSpineFromCrop,
  detectSpines,
  stripCodeFences,
  type VisionProviderConfig,
} from '../../../../src/lib/vision/client';
import { SPINE_COLORS } from '../../../../src/lib/vision/prompt';

const anthropicConfig: VisionProviderConfig = { provider: 'anthropic', apiKey: 'sk-test' };

function makeAnthropicResponse(textContent: string, inputTokens = 100, outputTokens = 50) {
  return {
    content: [{ type: 'text', text: textContent }],
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

const validDetection = {
  position: 1,
  title: 'Solaris',
  author: 'Stanisław Lem',
  confidence: 0.95,
  spine_color: SPINE_COLORS[0], // 'czerwony'
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('detectSpines', () => {
  it('returns detections and cost on happy path', async () => {
    const validJson = JSON.stringify([validDetection]);
    mockCreate.mockResolvedValueOnce(makeAnthropicResponse(validJson, 1000, 500));

    const result = await detectSpines(
      { base64: 'abc123', mediaType: 'image/jpeg' },
      anthropicConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].title).toBe('Solaris');
    expect(result.detections[0].author).toBe('Stanisław Lem');
    expect(result.model).toBe('claude-sonnet-4-6');
    // 1000/M * $3 + 500/M * $15 = $0.003 + $0.0075 = $0.0105
    expect(result.costUsd).toBeCloseTo(0.0105, 6);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('sends image before text in first call', async () => {
    mockCreate.mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify([])));

    await detectSpines({ base64: 'imgdata', mediaType: 'image/png' }, anthropicConfig);

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content[0].type).toBe('image');
    expect(call.messages[0].content[0].source.data).toBe('imgdata');
    expect(call.messages[0].content[0].source.media_type).toBe('image/png');
    expect(call.messages[0].content[1].type).toBe('text');
  });

  it('retries with thinking when first parse fails and second succeeds', async () => {
    const invalidJson = 'not valid json at all';
    const validJson = JSON.stringify([validDetection]);

    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(invalidJson, 100, 50))
      .mockResolvedValueOnce(makeAnthropicResponse(validJson, 200, 100));

    const result = await detectSpines(
      { base64: 'abc123', mediaType: 'image/jpeg' },
      anthropicConfig,
    );

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        thinking: { type: 'enabled', budget_tokens: 1536 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detections[0].title).toBe('Solaris');
    // Cost accumulates: both calls
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('accumulates cost from both attempts on retry success', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse('bad', 1000, 500)) // first fail
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify([validDetection]), 2000, 1000)); // retry success

    const result = await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, anthropicConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // first: 1000/M*3 + 500/M*15 = 0.003 + 0.0075 = 0.0105
    // retry: 2000/M*3 + 1000/M*15 = 0.006 + 0.015 = 0.021
    // total: 0.0315
    expect(result.costUsd).toBeCloseTo(0.0315, 6);
  });

  it('returns parse_failure when both attempts fail', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse('bad json'))
      .mockResolvedValueOnce(makeAnthropicResponse('{}')); // valid JSON but not array

    const result = await detectSpines(
      { base64: 'abc123', mediaType: 'image/jpeg' },
      anthropicConfig,
    );

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('parse_failure');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns parse_failure when first parse valid JSON but wrong schema', async () => {
    const wrongShape = JSON.stringify([{ title: 'Book' }]); // missing required fields
    const alsoWrong = JSON.stringify({ books: [] }); // object, not array

    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(wrongShape))
      .mockResolvedValueOnce(makeAnthropicResponse(alsoWrong));

    const result = await detectSpines({ base64: 'img', mediaType: 'image/webp' }, anthropicConfig);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('parse_failure');
  });

  it('propagates Anthropic API errors without catching', async () => {
    const apiError = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    mockCreate.mockRejectedValueOnce(apiError);

    await expect(
      detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, anthropicConfig),
    ).rejects.toThrow('Rate limit exceeded');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('uses model field from response', async () => {
    const response = makeAnthropicResponse(JSON.stringify([validDetection]));
    response.model = 'claude-sonnet-4-6-custom';
    mockCreate.mockResolvedValueOnce(response);

    const result = await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, anthropicConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBe('claude-sonnet-4-6-custom');
  });

  it('parses response wrapped in ```json code fences', async () => {
    const fenced = '```json\n' + JSON.stringify([validDetection]) + '\n```';
    mockCreate.mockResolvedValueOnce(makeAnthropicResponse(fenced));

    const result = await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, anthropicConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detections[0].title).toBe('Solaris');
  });

  it('parses response wrapped in plain ``` code fences', async () => {
    const fenced = '```\n' + JSON.stringify([validDetection]) + '\n```';
    mockCreate.mockResolvedValueOnce(makeAnthropicResponse(fenced));

    const result = await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, anthropicConfig);

    expect(result.ok).toBe(true);
  });

  it('OpenAI-compat path: returns detections with costUsd=0 on success', async () => {
    const openaiConfig: VisionProviderConfig = { provider: 'openai', apiKey: 'sk-openai-test' };
    const validJson = JSON.stringify([validDetection]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: validJson } }] }),
      }),
    );

    const result = await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, openaiConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detections[0].title).toBe('Solaris');
    expect(result.costUsd).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('OpenAI-compat path: returns parse_failure when HTTP error', async () => {
    const openaiConfig: VisionProviderConfig = { provider: 'openrouter', apiKey: 'sk-or-test' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      }),
    );

    const result = await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, openaiConfig);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('parse_failure');

    vi.unstubAllGlobals();
  });

  it('OpenAI-compat path: returns parse_failure when response parse fails', async () => {
    const openaiConfig: VisionProviderConfig = {
      provider: 'openai_compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://custom.api.example.com',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'not valid json' } }] }),
      }),
    );

    const result = await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, openaiConfig);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('parse_failure');

    vi.unstubAllGlobals();
  });

  it('OpenAI-compat path: uses custom baseUrl from config', async () => {
    const openaiConfig: VisionProviderConfig = {
      provider: 'openai_compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://custom.example.com',
    };
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify([validDetection]) } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, openaiConfig);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.example.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });

  it('identity-response (v7): no bbox/orientation → bbox null, title preserved', async () => {
    const identityDetection = {
      position: 1,
      title: 'Solaris',
      author: 'Stanisław Lem',
      confidence: 0.92,
      spine_color: SPINE_COLORS[0],
      // no bbox, no orientation — identity-first v7 model output
    };
    mockCreate.mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify([identityDetection])));

    const result = await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, anthropicConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].title).toBe('Solaris');
    expect(result.detections[0].bbox).toBeNull();
    expect(result.detections[0].confidence).toBe(0.92);
  });

  it('backward-compat: response with bbox still parses correctly', async () => {
    const detectionWithBbox = {
      position: 1,
      title: 'Dune',
      author: 'Frank Herbert',
      confidence: 0.88,
      spine_color: SPINE_COLORS[1],
      bbox: [0.12, 0.24, 0.17, 0.82],
    };
    mockCreate.mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify([detectionWithBbox])));

    const result = await detectSpines({ base64: 'img', mediaType: 'image/jpeg' }, anthropicConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detections[0].bbox).toEqual([0.12, 0.24, 0.17, 0.82]);
    expect(result.detections[0].title).toBe('Dune');
  });
});

describe('detectSingleSpineFromCrop', () => {
  it('returns a single refined detection when parse succeeds', async () => {
    mockCreate.mockResolvedValueOnce(
      makeAnthropicResponse(JSON.stringify([validDetection]), 500, 250),
    );

    const result = await detectSingleSpineFromCrop(
      { base64: 'crop123', mediaType: 'image/jpeg' },
      anthropicConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detection.title).toBe('Solaris');
    expect(result.costUsd).toBeCloseTo(0.00525, 6);
  });

  it('retries with thinking and returns parse_failure when both attempts produce empty arrays', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify([]), 100, 50))
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify([]), 100, 50));

    const result = await detectSingleSpineFromCrop(
      { base64: 'crop123', mediaType: 'image/jpeg' },
      anthropicConfig,
    );

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('parse_failure');
  });

  it('OpenAI-compat path: returns single detection with costUsd=0', async () => {
    const openaiConfig: VisionProviderConfig = { provider: 'openai', apiKey: 'sk-openai-test' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify([validDetection]) } }],
        }),
      }),
    );

    const result = await detectSingleSpineFromCrop(
      { base64: 'crop', mediaType: 'image/jpeg' },
      openaiConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detection.title).toBe('Solaris');
    expect(result.costUsd).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe('stripCodeFences', () => {
  it('strips ```json ... ``` wrapper', () => {
    expect(stripCodeFences('```json\n[1,2,3]\n```')).toBe('[1,2,3]');
  });

  it('strips ``` ... ``` without language tag', () => {
    expect(stripCodeFences('```\n[1,2,3]\n```')).toBe('[1,2,3]');
  });

  it('leaves plain JSON untouched', () => {
    expect(stripCodeFences('[{"a":1}]')).toBe('[{"a":1}]');
  });

  it('trims surrounding whitespace', () => {
    expect(stripCodeFences('  [1,2,3]  ')).toBe('[1,2,3]');
  });

  it('strips fence with trailing whitespace on opening line', () => {
    expect(stripCodeFences('```json  \n[1]\n```')).toBe('[1]');
  });
});
