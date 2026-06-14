import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../../../../src/pages/api/books/purchase-hints';

const USER_ID = '00000000-0000-4000-8000-000000000001';

type ApiJson = {
  data?: { hints: string[] };
  error?: { code: string; message: string };
};

function chain(resolved: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'not', 'order', 'limit']) {
    obj[m] = vi.fn(() => obj);
  }
  obj.then = (onF: (v: unknown) => unknown) => Promise.resolve(resolved).then(onF);
  return obj;
}

function makeContext(opts: {
  user?: boolean;
  type?: string | null;
  dbResult?: { data: unknown; error: unknown };
}) {
  const booksChain = chain(opts.dbResult ?? { data: [], error: null });
  const fromMock = vi.fn(() => booksChain);

  const typeParam = opts.type === undefined ? 'event' : opts.type;
  const urlStr =
    typeParam === null
      ? 'http://localhost/api/books/purchase-hints'
      : `http://localhost/api/books/purchase-hints?type=${typeParam}`;

  return {
    url: new URL(urlStr),
    locals: {
      user: opts.user !== false ? { id: USER_ID, email: 'test@example.com' } : null,
      supabase: { from: fromMock } as never,
    },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/books/purchase-hints', () => {
  it('401 gdy brak użytkownika', async () => {
    const res = await GET(makeContext({ user: false }));
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('400 gdy brak parametru type', async () => {
    const res = await GET(makeContext({ type: null }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('400 gdy type ma nieprawidłową wartość', async () => {
    const res = await GET(makeContext({ type: 'isbn' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('200 type=event → { data: { hints: [] } } gdy brak danych', async () => {
    const res = await GET(makeContext({ type: 'event', dbResult: { data: [], error: null } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.hints).toEqual([]);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('200 type=city → deduplikuje i zwraca posortowane wartości', async () => {
    const dbRows = [
      { purchase_city: 'Kraków' },
      { purchase_city: 'Warszawa' },
      { purchase_city: 'Kraków' }, // duplikat — powinien być odfiltrowany
    ];
    const res = await GET(makeContext({ type: 'city', dbResult: { data: dbRows, error: null } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.hints).toEqual(['Kraków', 'Warszawa']);
  });

  it('200 type=event → zwraca unikalne eventy', async () => {
    const dbRows = [{ purchase_event: 'Targi Książki' }, { purchase_event: 'Festiwal Czytania' }];
    const res = await GET(makeContext({ type: 'event', dbResult: { data: dbRows, error: null } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!.hints).toEqual(['Targi Książki', 'Festiwal Czytania']);
  });

  it('500 gdy błąd supabase', async () => {
    const res = await GET(
      makeContext({
        type: 'event',
        dbResult: { data: null, error: { name: 'E', message: 'x', code: 'XX' } },
      }),
    );
    expect(res.status).toBe(500);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('INTERNAL_ERROR');
  });
});
