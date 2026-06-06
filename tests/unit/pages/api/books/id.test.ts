import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH, DELETE } from '../../../../../src/pages/api/books/[id]';

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

  it('400 gdy nieznane pole (.strict)', async () => {
    const ctx = makeContext({ body: { is_read: true, evil_field: 'hack' } });
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

  it('200 PATCH cover_url (slot auto) — unify-book-save', async () => {
    const ctx = makeContext({ body: { cover_url: 'https://auto.example/c.jpg', cover_source: 'auto' } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(200);
    expect(capturedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ cover_url: 'https://auto.example/c.jpg', cover_source: 'auto' })
    );
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

  it('200 PATCH metadanych (title, authors, publisher, year, isbn)', async () => {
    const ctx = makeContext({
      body: {
        title: 'Nowy Tytuł',
        authors: ['Jan Kowalski', 'Anna Nowak'],
        publisher: 'Wydawnictwo X',
        published_year: 2020,
        isbn_13: '9788300000000',
      },
    });
    const res = await PATCH(ctx);
    expect(res.status).toBe(200);
    expect(capturedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nowy Tytuł', authors: ['Jan Kowalski', 'Anna Nowak'], publisher: 'Wydawnictwo X', published_year: 2020, isbn_13: '9788300000000' })
    );
  });

  it('200 clear publisher/isbn (null)', async () => {
    const ctx = makeContext({ body: { publisher: null, isbn_13: null } });
    const res = await PATCH(ctx);
    expect(res.status).toBe(200);
    expect(capturedUpdate.mock.calls[0][0]).toMatchObject({ publisher: null, isbn_13: null });
  });

  it('400 gdy isbn_13 nie ma 13 cyfr', async () => {
    const res = await PATCH(makeContext({ body: { isbn_13: '123' } }));
    expect(res.status).toBe(400);
  });

  it('400 gdy pusty title', async () => {
    const res = await PATCH(makeContext({ body: { title: '' } }));
    expect(res.status).toBe(400);
  });

  it('400 gdy rok poza zakresem', async () => {
    const res = await PATCH(makeContext({ body: { published_year: 3000 } }));
    expect(res.status).toBe(400);
  });

  it('400 przy duplikacie ISBN (23505)', async () => {
    const ctx = makeContext({
      body: { isbn_13: '9788300000000' },
      updateResult: { data: null, error: { code: '23505', name: 'PostgrestError', message: 'duplicate' } },
    });
    const res = await PATCH(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
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


let removeSpy: any;

let deleteSpy: any;

function makeDeleteContext(opts: {
  id?: string;
  selectResult?: { data: Record<string, unknown> | null; error: PgError };
  deleteError?: PgError;
  removeError?: PgError;
  user?: boolean;
}) {
  const selectResult = opts.selectResult ?? { data: { id: BOOK_ID, cover_photo_url: null }, error: null };
  deleteSpy = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: opts.deleteError ?? null }) }));
  const selectChain = {
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(selectResult) })) })),
    delete: deleteSpy,
  };
  const fromMock = vi.fn(() => selectChain);
  removeSpy = vi.fn().mockResolvedValue({ error: opts.removeError ?? null });
  const storage = { from: vi.fn(() => ({ remove: removeSpy })) };

  return {
    params: { id: opts.id ?? BOOK_ID },
    locals: {
      user: opts.user !== false ? { id: USER_ID, email: 'test@example.com' } : null,
      supabase: { from: fromMock, storage } as never,
    },
  } as never;
}

describe('DELETE /api/books/[id]', () => {
  it('401 gdy brak użytkownika', async () => {
    const res = await DELETE(makeDeleteContext({ user: false }));
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('404 gdy id nie jest UUID', async () => {
    const res = await DELETE(makeDeleteContext({ id: 'not-a-uuid' }));
    expect(res.status).toBe(404);
  });

  it('404 gdy książka nie istnieje / cudza (maybeSingle → null)', async () => {
    const res = await DELETE(makeDeleteContext({ selectResult: { data: null, error: null } }));
    expect(res.status).toBe(404);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('NOT_FOUND');
  });

  it('200 deleted:true bez okładki — delete wywołany, storage.remove NIE', async () => {
    const res = await DELETE(makeDeleteContext({ selectResult: { data: { id: BOOK_ID, cover_photo_url: null }, error: null } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.deleted).toBe(true);
    expect(deleteSpy).toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('200 z cleanupem okładki — storage.remove dostaje ścieżkę po /book-covers/', async () => {
    const res = await DELETE(makeDeleteContext({
      selectResult: {
        data: { id: BOOK_ID, cover_photo_url: 'https://x.supabase.co/storage/v1/object/public/book-covers/uid-1/abc.jpg' },
        error: null,
      },
    }));
    expect(res.status).toBe(200);
    expect(removeSpy).toHaveBeenCalledWith(['uid-1/abc.jpg']);
  });

  it('200 nawet gdy storage.remove błądzi (best-effort, sierota)', async () => {
    const res = await DELETE(makeDeleteContext({
      selectResult: { data: { id: BOOK_ID, cover_photo_url: 'https://x/storage/v1/object/public/book-covers/uid/a.jpg' }, error: null },
      removeError: { name: 'StorageError', message: 'fail' },
    }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.deleted).toBe(true);
  });

  it('500 gdy delete błądzi', async () => {
    const res = await DELETE(makeDeleteContext({ deleteError: { code: 'XXXXX', name: 'PostgrestError', message: 'fail' } }));
    expect(res.status).toBe(500);
  });

  it('500 gdy pre-check select błądzi', async () => {
    const res = await DELETE(makeDeleteContext({ selectResult: { data: null, error: { code: 'XXXXX', name: 'PostgrestError', message: 'fail' } } }));
    expect(res.status).toBe(500);
  });
});
