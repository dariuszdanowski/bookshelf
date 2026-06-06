import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../../../../src/pages/api/books/index';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SHELF_ID = '00000000-0000-4000-8000-0000000000aa';
const BOOK_ID = '00000000-0000-4000-8000-0000000000bb';

type PgError = { code?: string; name: string; message: string } | null;
type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

function makeContext(opts: {
  body?: unknown;
  user?: boolean;
  shelfResult?: { data: { id: string } | null; error: PgError }; // getPurchasedShelfId
  dupResult?: { data: { id: string } | null; error: PgError }; // isbn dup check
  bookInsert?: { data: { id: string } | null; error: PgError };
  entryError?: PgError; // shelf_entries insert error
}) {
  const shelfResult = opts.shelfResult ?? { data: { id: SHELF_ID }, error: null };
  const dupResult = opts.dupResult ?? { data: null, error: null };
  const bookInsert = opts.bookInsert ?? { data: { id: BOOK_ID }, error: null };
  const deleteEqFn = vi.fn().mockResolvedValue({ data: null, error: null });
  const booksInsertSpy = vi.fn(() => ({
    select: vi.fn(() => ({ single: vi.fn().mockResolvedValue(bookInsert) })),
  }));

  const fromMock = vi.fn((table: string) => {
    if (table === 'shelves') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(shelfResult) })),
        })),
      };
    }
    if (table === 'books') {
      return {
        // dup-check: select → eq → eq → maybeSingle
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(dupResult) })),
          })),
        })),
        // insert: insert → select → single
        insert: booksInsertSpy,
        // rollback: delete → eq
        delete: vi.fn(() => ({ eq: deleteEqFn })),
      };
    }
    if (table === 'shelf_entries') {
      return {
        // max position: select → eq → eq → order → limit → maybeSingle
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { position_index: 2 }, error: null }) })),
              })),
            })),
          })),
        })),
        insert: vi.fn().mockResolvedValue({ error: opts.entryError ?? null }),
      };
    }
    return {};
  });

  const request = new Request('http://localhost/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body ?? { title: 'Wiedźmin' }),
  });

  return {
    ctx: {
      request,
      locals: {
        user: opts.user !== false ? { id: USER_ID, email: 't@test' } : null,
        supabase: { from: fromMock } as never,
      },
    } as never,
    deleteEqFn,
    fromMock,
    booksInsertSpy,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/books (Flow B manual)', () => {
  it('401 gdy brak użytkownika', async () => {
    const { ctx } = makeContext({ user: false });
    const res = await POST(ctx);
    expect(res.status).toBe(401);
  });

  it('400 gdy brak title', async () => {
    const { ctx } = makeContext({ body: { authors: ['X'] } });
    const res = await POST(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('400 gdy dodatkowe pole (.strict)', async () => {
    const { ctx } = makeContext({ body: { title: 'X', user_id: 'hack' } });
    const res = await POST(ctx);
    expect(res.status).toBe(400);
  });

  it('201 z book_id i shelf_id przy sukcesie (title only)', async () => {
    const { ctx } = makeContext({ body: { title: 'Solaris' } });
    const res = await POST(ctx);
    expect(res.status).toBe(201);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.book_id).toBe(BOOK_ID);
    expect(json.data!.shelf_id).toBe(SHELF_ID);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('201 z podaną purchase_date', async () => {
    const { ctx } = makeContext({ body: { title: 'Diuna', purchase_date: '2026-01-15' } });
    const res = await POST(ctx);
    expect(res.status).toBe(201);
  });

  it('500 gdy brak półki Zakupione', async () => {
    const { ctx } = makeContext({ shelfResult: { data: null, error: null } });
    const res = await POST(ctx);
    expect(res.status).toBe(500);
  });

  it('201 dodanie ręczne na wskazaną półkę (shelf_id, bez zdjęcia)', async () => {
    const { ctx } = makeContext({ body: { title: 'Allah 2.0', authors: ['Mieszko Zagańczyk'], shelf_id: SHELF_ID, cover_url: 'https://c.jpg' } });
    const res = await POST(ctx);
    expect(res.status).toBe(201);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.shelf_id).toBe(SHELF_ID);
  });

  it('404 gdy wskazana półka nie istnieje / cudza', async () => {
    const { ctx } = makeContext({ body: { title: 'X', shelf_id: SHELF_ID }, shelfResult: { data: null, error: null } });
    const res = await POST(ctx);
    expect(res.status).toBe(404);
  });

  it('persistuje sloty okładki (unify-add-cover): cover_source + user_cover_url + cover_photo_url', async () => {
    const { ctx, booksInsertSpy } = makeContext({
      body: {
        title: 'Z okładką',
        shelf_id: SHELF_ID,
        cover_url: 'https://auto.jpg',
        user_cover_url: 'https://user.jpg',
        cover_photo_url: 'https://x.supabase.co/photo.jpg',
        cover_source: 'url',
      },
    });
    const res = await POST(ctx);
    expect(res.status).toBe(201);
    expect(booksInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        cover_url: 'https://auto.jpg',
        user_cover_url: 'https://user.jpg',
        cover_photo_url: 'https://x.supabase.co/photo.jpg',
        cover_source: 'url',
      })
    );
  });

  it('cover_source domyślnie auto gdy nie podano', async () => {
    const { ctx, booksInsertSpy } = makeContext({ body: { title: 'Bez slotów', shelf_id: SHELF_ID } });
    await POST(ctx);
    expect(booksInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ cover_source: 'auto' }));
  });

  it('400 gdy cover_url nie jest URL', async () => {
    const { ctx } = makeContext({ body: { title: 'X', cover_url: 'nie-url' } });
    const res = await POST(ctx);
    expect(res.status).toBe(400);
  });

  it('409 gdy isbn_13 już w katalogu (pre-check)', async () => {
    const { ctx } = makeContext({
      body: { title: 'Dup', isbn_13: '9780000000001' },
      dupResult: { data: { id: 'existing' }, error: null },
    });
    const res = await POST(ctx);
    expect(res.status).toBe(409);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('CONFLICT');
  });

  it('409 gdy books insert rzuca 23505 (backstop)', async () => {
    const { ctx } = makeContext({
      body: { title: 'X', isbn_13: '9780000000002' },
      bookInsert: { data: null, error: { code: '23505', name: 'PostgrestError', message: 'dup' } },
    });
    const res = await POST(ctx);
    expect(res.status).toBe(409);
  });

  it('500 + rollback gdy shelf_entries insert padnie', async () => {
    const { ctx, deleteEqFn } = makeContext({
      body: { title: 'X' },
      entryError: { code: '23503', name: 'PostgrestError', message: 'fk fail' },
    });
    const res = await POST(ctx);
    expect(res.status).toBe(500);
    // rollback: books.delete().eq('id', BOOK_ID)
    expect(deleteEqFn).toHaveBeenCalledWith('id', BOOK_ID);
  });
});
