import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../../../../../src/pages/api/books/[id]/move';

const BOOK_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_SHELF = '11111111-1111-4111-8111-111111111111';
const CURRENT_SHELF = '22222222-2222-4222-8222-222222222222';

type PgError = { code?: string; message?: string; name?: string } | null;

function makeContext(opts: {
  id?: string;
  body?: unknown;
  user?: unknown;
  book?: { id: string } | null;
  bookError?: PgError;
  shelf?: { id: string } | null;
  shelfError?: PgError;
  currentEntry?: { id: string; shelf_id: string } | null;
  currentError?: PgError;
  maxRow?: { position_index: number | null } | null;
  insertError?: PgError;
  updateError?: PgError;
}) {
  const booksFrom = {
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({
            data: opts.book === undefined ? { id: BOOK_ID } : opts.book,
            error: opts.bookError ?? null,
          }),
      }),
    }),
  };

  const shelvesFrom = {
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({
            data: opts.shelf === undefined ? { id: TARGET_SHELF } : opts.shelf,
            error: opts.shelfError ?? null,
          }),
      }),
    }),
  };

  // shelf_entries: 1st select → current entry, 2nd select → max position row.
  let seSelectCount = 0;
  const insertFn = vi.fn(() => Promise.resolve({ error: opts.insertError ?? null }));
  const updateEqFn = vi.fn(() => Promise.resolve({ error: opts.updateError ?? null }));
  const updateFn = vi.fn(() => ({ eq: updateEqFn }));

  function seSelectChain() {
    seSelectCount += 1;
    const first = seSelectCount === 1;
    const result = first
      ? {
          data:
            opts.currentEntry === undefined
              ? { id: 'entry-1', shelf_id: CURRENT_SHELF }
              : opts.currentEntry,
          error: opts.currentError ?? null,
        }
      : { data: opts.maxRow === undefined ? { position_index: 3 } : opts.maxRow, error: null };
    const chain: Record<string, unknown> = {
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(result),
    };
    return chain;
  }

  const shelfEntriesFrom = {
    select: () => seSelectChain(),
    insert: insertFn,
    update: updateFn,
  };

  const fromFn = vi.fn((table: string) => {
    if (table === 'books') return booksFrom;
    if (table === 'shelves') return shelvesFrom;
    return shelfEntriesFrom;
  });

  const id = opts.id ?? BOOK_ID;
  const request = new Request(`http://localhost/api/books/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:
      typeof opts.body === 'string'
        ? opts.body
        : JSON.stringify(opts.body ?? { shelf_id: TARGET_SHELF }),
  });

  return {
    context: {
      request,
      params: { id },
      locals: {
        supabase: { from: fromFn } as never,
        user: opts.user === undefined ? ({ id: 'user-1', email: 't@test' } as never) : (opts.user as never),
      },
    },
    insertFn,
    updateFn,
    updateEqFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/books/:id/move', () => {
  it('returns 401 when unauthenticated', async () => {
    const { context } = makeContext({ user: null });
    const res = await POST(context as never);
    expect(res.status).toBe(401);
  });

  it('returns 404 for malformed UUID', async () => {
    const { context } = makeContext({ id: 'not-a-uuid' });
    const res = await POST(context as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 when shelf_id missing', async () => {
    const { context } = makeContext({ body: {} });
    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when shelf_id not a uuid', async () => {
    const { context } = makeContext({ body: { shelf_id: 'nope' } });
    const res = await POST(context as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when book not found / not owned', async () => {
    const { context } = makeContext({ book: null });
    const res = await POST(context as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/Książka/);
  });

  it('returns 404 when target shelf not found / not owned', async () => {
    const { context } = makeContext({ shelf: null });
    const res = await POST(context as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/Półka/);
  });

  it('returns 409 when book has no current location', async () => {
    const { context } = makeContext({ currentEntry: null });
    const res = await POST(context as never);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('CONFLICT');
    expect(json.error.message).toMatch(/bieżącej lokalizacji/);
  });

  it('returns 409 when target shelf equals current shelf', async () => {
    const { context } = makeContext({
      currentEntry: { id: 'entry-1', shelf_id: TARGET_SHELF },
    });
    const res = await POST(context as never);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/już jest na tej półce/);
  });

  it('returns 500 when insert of new entry fails', async () => {
    const { context, insertFn } = makeContext({
      insertError: { code: '99999', message: 'boom', name: 'PostgrestError' },
    });
    const res = await POST(context as never);
    expect(res.status).toBe(500);
    expect(insertFn).toHaveBeenCalled();
  });

  it('moves the book: insert new current (max+1) + mark old historical, returns 200', async () => {
    const { context, insertFn, updateEqFn } = makeContext({
      currentEntry: { id: 'entry-1', shelf_id: CURRENT_SHELF },
      maxRow: { position_index: 3 },
    });
    const res = await POST(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { book_id: string; shelf_id: string } };
    expect(json.data).toEqual({ book_id: BOOK_ID, shelf_id: TARGET_SHELF });
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        book_id: BOOK_ID,
        shelf_id: TARGET_SHELF,
        position_index: 4,
        is_current: true,
      })
    );
    expect(updateEqFn).toHaveBeenCalledWith('id', 'entry-1');
  });

  it('positions at 1 when target shelf is empty', async () => {
    const { context, insertFn } = makeContext({
      currentEntry: { id: 'entry-1', shelf_id: CURRENT_SHELF },
      maxRow: null,
    });
    const res = await POST(context as never);
    expect(res.status).toBe(200);
    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({ position_index: 1 }));
  });
});
