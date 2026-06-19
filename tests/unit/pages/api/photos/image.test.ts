import { describe, expect, it, vi } from 'vitest';

import { GET } from '../../../../../src/pages/api/photos/[id]/image';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const PHOTO_ID = '00000000-0000-4000-8000-000000000010';
const STORAGE_PATH = `${USER_ID}/photo1.jpg`;
const THUMB_PATH = `${STORAGE_PATH}.thumb.jpg`;

function makeBlob() {
  return { arrayBuffer: async () => new ArrayBuffer(8) };
}

function makeSupabase(downloads: Record<string, { data: unknown; error: unknown }>) {
  const downloadFn = vi.fn(
    async (path: string) => downloads[path] ?? { data: null, error: { message: 'not found' } },
  );
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { storage_path: STORAGE_PATH }, error: null }),
      })),
    })),
  }));
  return {
    supabase: { from, storage: { from: vi.fn(() => ({ download: downloadFn })) } } as never,
    downloadFn,
  };
}

function ctx(supabase: unknown, url: string) {
  return {
    params: { id: PHOTO_ID },
    request: new Request(url),
    locals: { user: { id: USER_ID }, supabase },
  };
}

describe('GET /api/photos/[id]/image', () => {
  it('?thumb=1 serwuje miniaturę gdy istnieje (image/jpeg)', async () => {
    const { supabase, downloadFn } = makeSupabase({
      [THUMB_PATH]: { data: makeBlob(), error: null },
    });
    const res = await GET(ctx(supabase, 'http://x/api/photos/id/image?thumb=1') as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(downloadFn).toHaveBeenCalledWith(THUMB_PATH);
  });

  it('?thumb=1 fallback do oryginału gdy miniatury brak', async () => {
    const { supabase, downloadFn } = makeSupabase({
      [STORAGE_PATH]: { data: makeBlob(), error: null },
    });
    const res = await GET(ctx(supabase, 'http://x/api/photos/id/image?thumb=1') as never);
    expect(res.status).toBe(200);
    expect(downloadFn).toHaveBeenCalledWith(THUMB_PATH); // najpierw próba miniatury
    expect(downloadFn).toHaveBeenCalledWith(STORAGE_PATH); // potem fallback
  });

  it('bez ?thumb serwuje oryginał (nie próbuje miniatury)', async () => {
    const { supabase, downloadFn } = makeSupabase({
      [STORAGE_PATH]: { data: makeBlob(), error: null },
    });
    const res = await GET(ctx(supabase, 'http://x/api/photos/id/image') as never);
    expect(res.status).toBe(200);
    expect(downloadFn).not.toHaveBeenCalledWith(THUMB_PATH);
    expect(downloadFn).toHaveBeenCalledWith(STORAGE_PATH);
  });

  it('401 bez zalogowanego usera', async () => {
    const { supabase } = makeSupabase({});
    const res = await GET({
      params: { id: PHOTO_ID },
      request: new Request('http://x/api/photos/id/image'),
      locals: { user: null, supabase },
    } as never);
    expect(res.status).toBe(401);
  });
});
