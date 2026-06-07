import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../../../../src/pages/api/shelves/[id]/photos';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SHELF_ID = '00000000-0000-4000-8000-000000000002';
const PHOTO_ID_1 = '00000000-0000-4000-8000-000000000010';
const RUN_ID_1 = '00000000-0000-4000-8000-000000000090';
const STORAGE_PATH_1 = `${USER_ID}/photo1.jpg`;

const basePhoto = {
  id: PHOTO_ID_1,
  storage_path: STORAGE_PATH_1,
  status: 'processed',
  created_at: '2026-05-28T10:00:00Z',
  file_hash_sha256: 'a'.repeat(64),
};

const baseRun = {
  id: RUN_ID_1,
  photo_id: PHOTO_ID_1,
  model: 'claude-sonnet-4-6',
  created_at: '2026-05-28T10:05:00Z',
  cost_usd: 0.005,
};

function makeSupabase(opts: {
  shelfResult?: {
    data: { id: string } | null;
    error: { code?: string; name?: string; message?: string } | null;
  };
  photosResult?: {
    data:
      | {
          id: string;
          storage_path: string;
          status: string;
          created_at: string;
          file_hash_sha256?: string | null;
        }[]
      | null;
    error: null;
  };
  succeededRunsResult?: { data: (typeof baseRun)[] | null; error: null };
  runningRunsResult?: { data: { photo_id: string }[] | null; error?: null };
  detCountsResult?: {
    data: { vision_run_id: string; status: string; book_candidates: { id: string }[] }[] | null;
    error: null;
  };
  signedUrlsResult?: { data: { path: string | null; signedUrl: string }[] | null; error?: null };
}) {
  const {
    shelfResult = { data: { id: SHELF_ID }, error: null },
    photosResult = { data: [basePhoto], error: null },
    succeededRunsResult = { data: [baseRun], error: null },
    runningRunsResult = { data: [], error: null },
    detCountsResult = { data: [], error: null },
    signedUrlsResult = {
      data: [{ path: STORAGE_PATH_1, signedUrl: 'https://signed.url/photo1.jpg' }],
      error: null,
    },
  } = opts;

  const mockStorage = {
    from: vi.fn(() => ({
      createSignedUrls: vi.fn().mockResolvedValue(signedUrlsResult),
    })),
  };

  const fromFn = vi.fn((table: string) => {
    if (table === 'shelves') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue(shelfResult) })),
        })),
      };
    }

    if (table === 'photos') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue(photosResult),
          })),
        })),
      };
    }

    if (table === 'vision_runs') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn((_col: string, val: string) => {
              if (val === 'succeeded') {
                return {
                  order: vi.fn(() => ({
                    order: vi.fn().mockResolvedValue(succeededRunsResult),
                  })),
                };
              }
              // 'running' — second batch query
              return {
                gt: vi.fn().mockResolvedValue(runningRunsResult),
              };
            }),
          })),
        })),
      };
    }

    if (table === 'detections') {
      return {
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue(detCountsResult),
        })),
      };
    }

    return {};
  });

  return {
    supabase: { from: fromFn, storage: mockStorage } as never,
    fromFn,
    mockStorage,
  };
}

function makeContext(
  supabase: ReturnType<typeof makeSupabase>['supabase'],
  shelfId = SHELF_ID,
  user: { id: string } | null = { id: USER_ID },
) {
  return {
    params: { id: shelfId },
    locals: { supabase, user: user as never },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/shelves/[id]/photos', () => {
  it('returns 401 for unauthenticated request', async () => {
    const { supabase } = makeSupabase({});
    const res = await GET(makeContext(supabase, SHELF_ID, null) as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 404 for malformed UUID', async () => {
    const { supabase } = makeSupabase({});
    const res = await GET(makeContext(supabase, 'not-a-uuid') as never);
    expect(res.status).toBe(404);
  });

  it('returns 404 when shelf not found (PGRST116)', async () => {
    const { supabase } = makeSupabase({
      shelfResult: { data: null, error: { code: 'PGRST116', name: 'Err', message: 'no rows' } },
    });
    const res = await GET(makeContext(supabase) as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns empty photos array when shelf has no photos', async () => {
    const { supabase } = makeSupabase({ photosResult: { data: [], error: null } });
    const res = await GET(makeContext(supabase) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { photos: unknown[] } };
    expect(json.data.photos).toHaveLength(0);
  });

  it('stage=uploaded — no succeeded runs, no running runs', async () => {
    const { supabase } = makeSupabase({
      succeededRunsResult: { data: [], error: null },
      runningRunsResult: { data: [], error: null },
    });
    const res = await GET(makeContext(supabase) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { photos: { stage: string }[] } };
    expect(json.data.photos[0].stage).toBe('uploaded');
  });

  it('stage=processing — no succeeded runs, has running run for this photo', async () => {
    const { supabase } = makeSupabase({
      succeededRunsResult: { data: [], error: null },
      runningRunsResult: { data: [{ photo_id: PHOTO_ID_1 }], error: null },
    });
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as {
      data: { photos: { stage: string; has_running_run: boolean }[] };
    };
    expect(json.data.photos[0].stage).toBe('processing');
    expect(json.data.photos[0].has_running_run).toBe(true);
  });

  it('stage=vision_done — succeeded run exists, 0 matched detections', async () => {
    const { supabase } = makeSupabase({
      detCountsResult: {
        data: [{ vision_run_id: RUN_ID_1, status: 'pending', book_candidates: [] }],
        error: null,
      },
    });
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as {
      data: { photos: { stage: string; detected_count: number; matched_count: number }[] };
    };
    expect(json.data.photos[0].stage).toBe('vision_done');
    expect(json.data.photos[0].detected_count).toBe(1);
    expect(json.data.photos[0].matched_count).toBe(0);
  });

  it('stage=match_done — succeeded run, ≥1 matched, 0 confirmed', async () => {
    const { supabase } = makeSupabase({
      detCountsResult: {
        data: [
          { vision_run_id: RUN_ID_1, status: 'matched', book_candidates: [{ id: 'bc-1' }] },
          { vision_run_id: RUN_ID_1, status: 'pending', book_candidates: [] },
        ],
        error: null,
      },
    });
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as {
      data: { photos: { stage: string; matched_count: number; confirmed_count: number }[] };
    };
    expect(json.data.photos[0].stage).toBe('match_done');
    expect(json.data.photos[0].matched_count).toBe(1);
    expect(json.data.photos[0].confirmed_count).toBe(0);
  });

  it('stage=confirmed — ≥1 detection with status=confirmed', async () => {
    const { supabase } = makeSupabase({
      detCountsResult: {
        data: [
          { vision_run_id: RUN_ID_1, status: 'confirmed', book_candidates: [{ id: 'bc-1' }] },
          { vision_run_id: RUN_ID_1, status: 'matched', book_candidates: [{ id: 'bc-2' }] },
        ],
        error: null,
      },
    });
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as {
      data: { photos: { stage: string; confirmed_count: number }[] };
    };
    expect(json.data.photos[0].stage).toBe('confirmed');
    expect(json.data.photos[0].confirmed_count).toBe(1);
  });

  it('includes latest_vision_run metadata when succeeded run exists', async () => {
    const { supabase } = makeSupabase({});
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as {
      data: { photos: { latest_vision_run: { id: string; model: string | null } | null }[] };
    };
    expect(json.data.photos[0].latest_vision_run).not.toBeNull();
    expect(json.data.photos[0].latest_vision_run?.id).toBe(RUN_ID_1);
    expect(json.data.photos[0].latest_vision_run?.model).toBe('claude-sonnet-4-6');
  });

  it('latest_vision_run is null when no succeeded run', async () => {
    const { supabase } = makeSupabase({ succeededRunsResult: { data: [], error: null } });
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as {
      data: { photos: { latest_vision_run: null }[] };
    };
    expect(json.data.photos[0].latest_vision_run).toBeNull();
  });

  it('includes signed thumbnail_url from storage (fallback do oryginału bez miniatury — M15)', async () => {
    const { supabase } = makeSupabase({});
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as { data: { photos: { thumbnail_url: string | null }[] } };
    expect(json.data.photos[0].thumbnail_url).toBe('https://signed.url/photo1.jpg');
  });

  // M15: lista preferuje miniaturę <storage_path>.thumb.jpg nad oryginałem
  it('M15: preferuje signed URL miniatury, gdy thumb istnieje w Storage', async () => {
    const { supabase } = makeSupabase({
      signedUrlsResult: {
        data: [
          { path: `${STORAGE_PATH_1}.thumb.jpg`, signedUrl: 'https://signed.url/photo1.thumb.jpg' },
          { path: STORAGE_PATH_1, signedUrl: 'https://signed.url/photo1.jpg' },
        ],
        error: null,
      },
    });
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as { data: { photos: { thumbnail_url: string | null }[] } };
    expect(json.data.photos[0].thumbnail_url).toBe('https://signed.url/photo1.thumb.jpg');
  });

  it('M15: batch sign zawiera ścieżki miniatur PRZED oryginałami (2N paths)', async () => {
    const { supabase, mockStorage } = makeSupabase({});
    await GET(makeContext(supabase) as never);
    const fromResult = mockStorage.from.mock.results[0]!.value as {
      createSignedUrls: ReturnType<typeof vi.fn>;
    };
    expect(fromResult.createSignedUrls).toHaveBeenCalledWith(
      [`${STORAGE_PATH_1}.thumb.jpg`, STORAGE_PATH_1],
      3600,
    );
  });

  it('thumbnail_url is null when storage returns no signed url for path', async () => {
    const { supabase } = makeSupabase({
      signedUrlsResult: { data: [], error: null },
    });
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as { data: { photos: { thumbnail_url: string | null }[] } };
    expect(json.data.photos[0].thumbnail_url).toBeNull();
  });

  it('legacy_no_hash=false when file_hash_sha256 present', async () => {
    const { supabase } = makeSupabase({});
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as { data: { photos: { legacy_no_hash: boolean }[] } };
    expect(json.data.photos[0].legacy_no_hash).toBe(false);
  });

  it('legacy_no_hash=true when file_hash_sha256 is null', async () => {
    const { supabase } = makeSupabase({
      photosResult: { data: [{ ...basePhoto, file_hash_sha256: null }], error: null },
    });
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as { data: { photos: { legacy_no_hash: boolean }[] } };
    expect(json.data.photos[0].legacy_no_hash).toBe(true);
  });

  it('stage=uploaded for photo with only failed runs (no succeeded)', async () => {
    // Simulates recovery: all runs failed → stage should be uploaded, not something else
    const { supabase } = makeSupabase({
      succeededRunsResult: { data: [], error: null },
      runningRunsResult: { data: [], error: null },
    });
    const res = await GET(makeContext(supabase) as never);
    const json = (await res.json()) as { data: { photos: { stage: string }[] } };
    expect(json.data.photos[0].stage).toBe('uploaded');
  });
});
