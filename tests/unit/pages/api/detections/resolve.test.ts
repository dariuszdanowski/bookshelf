import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetActiveProviderConfig = vi.hoisted(() => vi.fn());
const mockResolveBookViaAI = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/lib/keys/getActiveProviderConfig', () => ({
  getActiveProviderConfig: mockGetActiveProviderConfig,
}));

vi.mock('../../../../../src/lib/resolution/client', () => ({
  resolveBookViaAI: mockResolveBookViaAI,
}));

import { POST } from '../../../../../src/pages/api/detections/[id]/resolve';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const DETECTION_ID = '00000000-0000-4000-8000-000000000010';
const PHOTO_ID = '00000000-0000-4000-8000-000000000020';

const detectionRow = {
  id: DETECTION_ID,
  photo_id: PHOTO_ID,
  raw_title: 'Zlodziej ksiazek',
  raw_author: null,
};

const anthropicConfig = { provider: 'anthropic' as const, apiKey: 'sk-test', keyId: 'key-1' };
const openaiCompatConfig = {
  provider: 'openai_compatible' as const,
  apiKey: 'sk-test',
  baseUrl: 'https://relay.example.com',
  keyId: 'key-2',
};

const foundResult = {
  status: 'found' as const,
  title: 'Złodziejka książek',
  authors: ['Markus Zusak'],
  isbn10: null,
  isbn13: null,
  publisher: null,
  publishedYear: null,
  confidence: 0.9,
};

function makeSupabase(opts?: {
  aiEnabled?: boolean;
  detectionResult?: { data: typeof detectionRow | null; error: { code?: string } | null };
  resolutionCallsCount?: { day: number; photo: number };
  track?: { resolutionCallsInsertPayload: unknown[] };
}) {
  const aiEnabled = opts?.aiEnabled ?? true;
  const detectionResult = opts?.detectionResult ?? { data: detectionRow, error: null };
  const dayCount = opts?.resolutionCallsCount?.day ?? 0;
  const photoCount = opts?.resolutionCallsCount?.photo ?? 0;

  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { ai_enabled: aiEnabled }, error: null }),
          })),
        })),
      };
    }

    if (table === 'detections') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(detectionResult) })),
        })),
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      };
    }

    if (table === 'resolution_calls') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((field: string) => {
            if (field === 'user_id') {
              return { gte: vi.fn().mockResolvedValue({ count: dayCount, error: null }) };
            }
            // field === 'photo_id' — .eq() resolves directly, no .gte chain (matches resolve.ts)
            return Promise.resolve({ count: photoCount, error: null });
          }),
        })),
        insert: vi.fn((payload: unknown) => {
          if (opts?.track) opts.track.resolutionCallsInsertPayload.push(payload);
          return Promise.resolve({ error: null });
        }),
      };
    }

    if (table === 'corrections') {
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    }

    if (table === 'book_candidates') {
      return {
        delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'candidate-1',
                source: 'ai_resolution',
                external_id: `ai-resolution:${DETECTION_ID}`,
                title: foundResult.title,
                authors: foundResult.authors,
                isbn_10: null,
                isbn_13: null,
                publisher: null,
                published_year: null,
                cover_url: null,
                match_score: 0.5,
                rank: 1,
              },
              error: null,
            }),
          })),
        })),
      };
    }

    if (table === 'books') {
      return {
        select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      };
    }

    return {};
  });

  return { from } as unknown as { from: typeof from };
}

function makeContext(supabase: ReturnType<typeof makeSupabase>, user = true, id = DETECTION_ID) {
  return {
    params: { id },
    locals: { user: user ? ({ id: USER_ID } as never) : null, supabase },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveProviderConfig.mockResolvedValue(anthropicConfig);
  mockResolveBookViaAI.mockResolvedValue({
    ok: true,
    result: foundResult,
    model: 'claude-sonnet-4-6',
    costUsd: 0.05,
    searchCount: 1,
    latencyMs: 1200,
  });
});

describe('POST /api/detections/[id]/resolve', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await POST(makeContext(makeSupabase(), false));
    expect(res.status).toBe(401);
  });

  it('returns 403 AI_DISABLED when profile.ai_enabled = false', async () => {
    const res = await POST(makeContext(makeSupabase({ aiEnabled: false })));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('AI_DISABLED');
  });

  it('returns 403 NO_API_KEY when no active key', async () => {
    mockGetActiveProviderConfig.mockResolvedValueOnce(null);
    const res = await POST(makeContext(makeSupabase()));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NO_API_KEY');
  });

  it('returns 404 for malformed detection id', async () => {
    const res = await POST(makeContext(makeSupabase(), true, 'bad-uuid'));
    expect(res.status).toBe(404);
  });

  it('returns 200 applied=true on successful resolution (anthropic)', async () => {
    const res = await POST(makeContext(makeSupabase()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { applied: boolean; resolution: { status: string } };
    };
    expect(json.data.applied).toBe(true);
    expect(json.data.resolution.status).toBe('found');
  });

  // resolution-openai-compatible-provider: guard providera zdjęty — dawniej ta
  // ścieżka zwracała 403 AI_RESOLUTION_PROVIDER_UNSUPPORTED.
  it('nie zwraca już 403 AI_RESOLUTION_PROVIDER_UNSUPPORTED dla openai_compatible', async () => {
    mockGetActiveProviderConfig.mockResolvedValueOnce(openaiCompatConfig);
    const res = await POST(makeContext(makeSupabase()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { applied: boolean } };
    expect(json.data.applied).toBe(true);
  });

  it('przekazuje pełny providerConfig (z provider/baseUrl) do resolveBookViaAI', async () => {
    mockGetActiveProviderConfig.mockResolvedValueOnce(openaiCompatConfig);
    await POST(makeContext(makeSupabase()));

    expect(mockResolveBookViaAI).toHaveBeenCalledWith(
      expect.objectContaining({ rawTitle: 'Zlodziej ksiazek' }),
      expect.objectContaining({
        provider: 'openai_compatible',
        baseUrl: 'https://relay.example.com',
      }),
    );
  });

  it('zapisuje provider w resolution_calls insert', async () => {
    mockGetActiveProviderConfig.mockResolvedValueOnce(openaiCompatConfig);
    const track = { resolutionCallsInsertPayload: [] as unknown[] };
    await POST(makeContext(makeSupabase({ track })));

    expect(track.resolutionCallsInsertPayload).toHaveLength(1);
    expect(track.resolutionCallsInsertPayload[0]).toMatchObject({ provider: 'openai_compatible' });
  });

  it('returns 429 gdy budget dzienny wyczerpany', async () => {
    const res = await POST(
      makeContext(makeSupabase({ resolutionCallsCount: { day: 20, photo: 0 } })),
    );
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('RESOLUTION_BUDGET_EXCEEDED');
  });

  it('returns 200 applied=false gdy AI zwraca not_found', async () => {
    mockResolveBookViaAI.mockResolvedValueOnce({
      ok: true,
      result: { status: 'not_found', reason: 'brak pewności' },
      model: 'claude-sonnet-4-6',
      costUsd: 0.02,
      searchCount: 1,
      latencyMs: 900,
    });
    const res = await POST(makeContext(makeSupabase()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { applied: boolean; resolution: { status: string } };
    };
    expect(json.data.applied).toBe(false);
    expect(json.data.resolution.status).toBe('not_found');
  });
});
