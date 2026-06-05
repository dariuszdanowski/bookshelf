import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from '../../../../../src/pages/api/books/[id]';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const BOOK_ID = '00000000-0000-4000-8000-000000000050';

type PgError = { code?: string; name: string; message: string } | null;
type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

 
let capturedUpdate: any;

function makeContext(opts: {
  id?: string;
  body?: unknown;
  updateResult?: { data: Record<string, unknown> | null; error: PgError };
  user?: boolean;
}) {
  const updateResult = opts.updateResult ?? {
    data: { id: BOOK_ID, is_read: true, cover_url: null, user_cover_url: null, cover_photo_url: null, cover_source: 'auto' },
    error: null,
  };
  const updateSpy = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(updateResult),
      })),
    })),
  }));
  const fromMock = vi.fn(() => ({ update: updateSpy }));
  capturedUpdate = updateSpy;

  const request = new Request('http://localhost/api/books/' + (opts.id ?? BOOK_ID), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body ?? { is_read: true }),
  });

  return {
    params: { id: opts.id ?? BOOK_ID },
    request,
    locals: {
      user: opts.user !== false ? { id: USER_ID, email: 'test@example.com' } : null,
      supabase: { from: fromMock } as never,
    },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('PATCH /api/books/[id]', () => {
  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false });
    const res = await PATCH(ctx);
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('404 gdy id nie jest UUID', async () => {
    const ctx = makeContext({ id: 'not-a-uuid' });
    const res = await PATCH(ctx);
    expect(res.status).toBe(404);
  });

  it('400 gdy brak is_read', async () => {
    const ctx = makeContext({ body: {} });
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('400 gdy is_read jest stringiem', async () => {
    const ctx = makeContext({ body: { is_read: 'true' } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
  });

  it('400 gdy dodatkowe pola (.strict)', async () => {
    const ctx = makeContext({ body: { is_read: true, title: 'hack' } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
  });

  it('200 z id i is_read przy toggle na true', async () => {
    const ctx = makeContext({ body: { is_read: true } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.id).toBe(BOOK_ID);
    expect(json.data!.is_read).toBe(true);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('200 z is_read: false przy toggle na false', async () => {
    const ctx = makeContext({
      body: { is_read: false },
      updateResult: { data: { id: BOOK_ID, is_read: false }, error: null },
    });
    const res = await PATCH(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.is_read).toBe(false);
  });

  it('200 PATCH user_cover_url (wklejony URL) + cover_source=url', async () => {
    const ctx = makeContext({
      body: { user_cover_url: 'https://example.com/cover.jpg', cover_source: 'url' },
      updateResult: {
        data: { id: BOOK_ID, is_read: false, cover_url: null, user_cover_url: 'https://example.com/cover.jpg', cover_photo_url: null, cover_source: 'url' },
        error: null,
      },
    });
    const res = await PATCH(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.user_cover_url).toBe('https://example.com/cover.jpg');
    expect(json.data!.cover_source).toBe('url');
    // update dostał tylko obecne pola
    expect(capturedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ user_cover_url: 'https://example.com/cover.jpg', cover_source: 'url' })
    );
    expect(capturedUpdate.mock.calls[0][0]).not.toHaveProperty('is_read');
  });

  it('200 PATCH cover_photo_url + cover_source=photo', async () => {
    const ctx = makeContext({
      body: { cover_photo_url: 'https://x.supabase.co/cover.png', cover_source: 'photo' },
    });
    const res = await PATCH(ctx);
    expect(res.status).toBe(200);
    expect(capturedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ cover_photo_url: 'https://x.supabase.co/cover.png', cover_source: 'photo' })
    );
  });

  it('200 clear user_cover_url (null) — przywróć automatyczną', async () => {
    const ctx = makeContext({ body: { user_cover_url: null, cover_source: 'auto' } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(200);
    expect(capturedUpdate.mock.calls[0][0]).toMatchObject({ user_cover_url: null, cover_source: 'auto' });
  });

  it('400 gdy user_cover_url nie jest URL', async () => {
    const ctx = makeContext({ body: { user_cover_url: 'nie-url' } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
  });

  it('400 gdy zły cover_source', async () => {
    const ctx = makeContext({ body: { cover_source: 'xyz' } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
  });

  it('400 gdy puste body (brak pól)', async () => {
    const ctx = makeContext({ body: {} });
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
  });

  it('404 gdy PGRST116 (brak rekordu / cudza książka)', async () => {
    const ctx = makeContext({
      updateResult: { data: null, error: { code: 'PGRST116', name: 'PostgrestError', message: 'no rows' } },
    });
    const res = await PATCH(ctx);
    expect(res.status).toBe(404);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('NOT_FOUND');
  });

  it('500 przy innym błędzie Supabase', async () => {
    const ctx = makeContext({
      updateResult: { data: null, error: { code: 'XXXXX', name: 'PostgrestError', message: 'fail' } },
    });
    const res = await PATCH(ctx);
    expect(res.status).toBe(500);
  });
});
