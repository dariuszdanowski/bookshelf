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
  track?: { resolutionCallsInsertPayload: unknown[]; dailyWindowStart?: string };
  profileBudget?: {
    ai_resolution_max_calls_per_photo?: number;
    ai_resolution_max_calls_per_day?: number;
    ai_resolution_daily_reset_at?: string | null;
  };
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
            single: vi.fn().mockResolvedValue({
              data: { ai_enabled: aiEnabled, ...opts?.profileBudget },
              error: null,
            }),
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
              return {
                gte: vi.fn((_col: string, windowStart: string) => {
                  if (opts?.track) opts.track.dailyWindowStart = windowStart;
                  return Promise.resolve({ count: dayCount, error: null });
                }),
              };
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

function makeContext(
  supabase: ReturnType<typeof makeSupabase>,
  user = true,
  id = DETECTION_ID,
  body?: unknown,
) {
  return {
    params: { id },
    locals: { user: user ? ({ id: USER_ID } as never) : null, supabase },
    // per-call-byok-key-override: body opcjonalne — brak (undefined) reprodukuje
    // dzisiejsze wywołania UI (fetch bez body), request.json() rzuca, endpoint
    // łapie i traktuje jako "brak override" (zob. resolve.ts krytyczne szczegóły).
    request:
      body === undefined
        ? undefined
        : ({ json: () => Promise.resolve(body) } as unknown as Request),
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

  // per-call-byok-key-override: body opcjonalne { apiKeyId } — override per-request.
  it('brak body — getActiveProviderConfig wołany bez keyId (zachowanie dzisiejsze)', async () => {
    await POST(makeContext(makeSupabase(), true, DETECTION_ID, undefined));
    expect(mockGetActiveProviderConfig).toHaveBeenCalledWith(expect.anything(), USER_ID, undefined);
  });

  it('body z apiKeyId — przekazuje go do getActiveProviderConfig jako keyId', async () => {
    const OTHER_KEY_ID = '00000000-0000-4000-8000-000000000099';
    await POST(makeContext(makeSupabase(), true, DETECTION_ID, { apiKeyId: OTHER_KEY_ID }));
    expect(mockGetActiveProviderConfig).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      OTHER_KEY_ID,
    );
  });

  it('apiKeyId podany, ale getActiveProviderConfig zwraca null — 404 NOT_FOUND (nie 403)', async () => {
    const OTHER_KEY_ID = '00000000-0000-4000-8000-000000000099';
    mockGetActiveProviderConfig.mockResolvedValueOnce(null);
    const res = await POST(
      makeContext(makeSupabase(), true, DETECTION_ID, { apiKeyId: OTHER_KEY_ID }),
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('body niepoprawny JSON — traktowany jak brak override, nie 400', async () => {
    const badRequest = { json: () => Promise.reject(new Error('invalid json')) };
    const res = await POST({
      params: { id: DETECTION_ID },
      locals: { user: { id: USER_ID } as never, supabase: makeSupabase() },
      request: badRequest as unknown as Request,
    } as never);
    expect(res.status).not.toBe(400);
    expect(mockGetActiveProviderConfig).toHaveBeenCalledWith(expect.anything(), USER_ID, undefined);
  });

  it('fallback do defaultów gdy profil nie ma nowych pól (regresja mocka bez budgetu)', async () => {
    const res = await POST(
      makeContext(makeSupabase({ resolutionCallsCount: { day: 20, photo: 0 } })),
    );
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toContain('20/20');
  });

  it('respektuje custom limit dzienny z profilu (niższy niż default)', async () => {
    const res = await POST(
      makeContext(
        makeSupabase({
          resolutionCallsCount: { day: 1, photo: 0 },
          profileBudget: {
            ai_resolution_max_calls_per_day: 1,
            ai_resolution_max_calls_per_photo: 3,
          },
        }),
      ),
    );
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('RESOLUTION_BUDGET_EXCEEDED');
    expect(json.error.message).toContain('1/1');
  });

  it('respektuje custom limit per-zdjęcie z profilu (wyższy niż default)', async () => {
    const res = await POST(
      makeContext(
        makeSupabase({
          resolutionCallsCount: { day: 0, photo: 5 },
          profileBudget: {
            ai_resolution_max_calls_per_photo: 10,
            ai_resolution_max_calls_per_day: 20,
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
  });

  it('komunikat 429 zawiera realne liczby dziennego i per-zdjęcie limitu', async () => {
    const res = await POST(
      makeContext(
        makeSupabase({
          resolutionCallsCount: { day: 0, photo: 3 },
          profileBudget: {
            ai_resolution_max_calls_per_photo: 3,
            ai_resolution_max_calls_per_day: 20,
          },
        }),
      ),
    );
    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toContain('dziennie: 0/20');
    expect(json.error.message).toContain('na zdjęcie: 3/3');
  });

  it('reset_at w przeszłości (sprzed dzisiejszej północy) ignorowany — okno liczone od północy', async () => {
    const track: { resolutionCallsInsertPayload: unknown[]; dailyWindowStart?: string } = {
      resolutionCallsInsertPayload: [],
    };
    await POST(
      makeContext(
        makeSupabase({
          track,
          profileBudget: { ai_resolution_daily_reset_at: '2020-01-01T00:00:00.000Z' },
        }),
      ),
    );
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    expect(track.dailyWindowStart).toBe(midnight.toISOString());
  });

  it('reset_at po dzisiejszej północy zawęża okno liczenia', async () => {
    const track: { resolutionCallsInsertPayload: unknown[]; dailyWindowStart?: string } = {
      resolutionCallsInsertPayload: [],
    };
    const future = new Date();
    future.setUTCHours(23, 59, 0, 0);
    await POST(
      makeContext(
        makeSupabase({
          track,
          profileBudget: { ai_resolution_daily_reset_at: future.toISOString() },
        }),
      ),
    );
    expect(track.dailyWindowStart).toBe(future.toISOString());
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
