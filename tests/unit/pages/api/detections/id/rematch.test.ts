import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../../../../../../src/pages/api/detections/[id]/rematch';

vi.mock('../../../../../../src/lib/books/googleBooks', () => ({
  searchGoogleBooks: vi.fn(),
}));
vi.mock('../../../../../../src/lib/books/openLibrary', () => ({
  searchOpenLibrary: vi.fn(),
  searchOpenLibraryByTitle: vi.fn(),
}));
vi.mock('../../../../../../src/lib/books/nationalLibrary', () => ({
  searchNationalLibrary: vi.fn(),
}));

import { searchGoogleBooks } from '../../../../../../src/lib/books/googleBooks';
import {
  searchOpenLibrary,
  searchOpenLibraryByTitle,
} from '../../../../../../src/lib/books/openLibrary';
import { searchNationalLibrary } from '../../../../../../src/lib/books/nationalLibrary';

const DET_ID = '00000000-0000-4000-8000-000000000020';
const CAND_ID = '00000000-0000-4000-8000-000000000030';

type ApiJson = { data?: Record<string, unknown>; error?: { code: string; message: string } };

const MOCK_GOOGLE_CANDIDATE = {
  source: 'google_books' as const,
  externalId: 'gb-1',
  title: 'Przerwana kołysanka',
  authors: ['Natasza Socha'],
  isbn10: null,
  isbn13: '9788383100012',
  publisher: null,
  publishedYear: 2022,
  coverUrl: null,
  description: null,
};

// plan-review F2: findBookCandidates() syntetyzuje coverUrl z ISBN gdy źródło go
// nie ma (src/lib/matching/findCandidates.ts:123-128) — żeby przetestować
// „nowy wynik NAPRAWDĘ nie ma okładki" (nie tylko `coverUrl: null` z API),
// kandydat musi też nie mieć ISBN.
const MOCK_CANDIDATE_NO_ISBN_NO_COVER = {
  source: 'google_books' as const,
  externalId: 'gb-nocover',
  title: 'Przerwana kołysanka',
  authors: ['Natasza Socha'],
  isbn10: null,
  isbn13: null,
  publisher: null,
  publishedYear: 2022,
  coverUrl: null,
  description: null,
};

function makeSupabase(opts: {
  detection?: { id: string; status: string; raw_title?: string } | null;
  existingCandidates?: { match_score: number; rank: number; cover_url?: string | null }[];
  existingBooks?: {
    id: string;
    title: string;
    authors: string[];
    isbn_13: string | null;
    isbn_10: string | null;
  }[];
  updateResult?: { error: null | { name: string; message: string; code?: string } };
  deleteResult?: { error: null | { name: string; message: string } };
  insertResult?: { data: { id: string }[] | null; error: null | { name: string; message: string } };
  correctionInsertResult?: { error: null | { name: string; message: string; code?: string } };
}) {
  const detection =
    opts.detection !== undefined ? opts.detection : { id: DET_ID, status: 'pending' };
  const existingCandidates = opts.existingCandidates ?? [];
  const existingBooks = opts.existingBooks ?? [];
  const correctionsInsertMock = vi
    .fn()
    .mockResolvedValue(opts.correctionInsertResult ?? { error: null });
  const candidatesInsertMock = vi.fn((rows: unknown) => ({
    select: vi.fn().mockResolvedValue(
      opts.insertResult ?? {
        data: (rows as { cover_url: string | null }[]).map((r, idx) => ({
          id: idx === 0 ? CAND_ID : `${CAND_ID}-${idx}`,
          source: 'google_books',
          external_id: 'gb-1',
          title: 'Przerwana kołysanka',
          authors: ['Natasza Socha'],
          isbn_10: null,
          isbn_13: '9788383100012',
          publisher: null,
          published_year: 2022,
          cover_url: r.cover_url,
          match_score: 0.95,
          rank: idx + 1,
        })),
        error: null,
      },
    ),
  }));

  return {
    from: vi.fn((table: string) => {
      if (table === 'detections') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: detection, error: null }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(opts.updateResult ?? { error: null }),
          })),
        };
      }
      if (table === 'book_candidates') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: existingCandidates, error: null }),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(opts.deleteResult ?? { error: null }),
          })),
          insert: candidatesInsertMock,
        };
      }
      if (table === 'books') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: existingBooks, error: null }),
          })),
        };
      }
      if (table === 'corrections') {
        return { insert: correctionsInsertMock };
      }
      return {};
    }),
    correctionsInsertMock,
    candidatesInsertMock,
  };
}

function makeContext(opts: {
  id?: string;
  body?: unknown;
  user?: boolean;
  supabase?: ReturnType<typeof makeSupabase>;
}) {
  return {
    params: { id: opts.id ?? DET_ID },
    request: {
      json: vi
        .fn()
        .mockResolvedValue(opts.body ?? { title: 'Przerwana kołysanka', author: 'Natasza Socha' }),
    },
    locals: {
      user: opts.user !== false ? { id: 'user-1', email: 'test@test.com' } : null,
      supabase: opts.supabase ?? makeSupabase({}),
    },
  } as never;
}

describe('POST /api/detections/[id]/rematch', () => {
  beforeEach(() => {
    // Domyślnie BN pusty — testy GB/OL nadpisują swoje, BN nie zakłóca.
    vi.mocked(searchNationalLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
  });

  it('401 gdy brak użytkownika', async () => {
    const ctx = makeContext({ user: false });
    const res = await POST(ctx);
    expect(res.status).toBe(401);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('UNAUTHENTICATED');
  });

  it('404 gdy id nie jest UUID', async () => {
    const ctx = makeContext({ id: 'not-a-uuid' });
    const res = await POST(ctx);
    expect(res.status).toBe(404);
  });

  it('400 gdy pusty tytuł i brak ISBN', async () => {
    const ctx = makeContext({ body: { title: '' } });
    const res = await POST(ctx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('200 gdy podano tylko ISBN (bez tytułu) — isbnOnly przekazany do matchingu', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [MOCK_GOOGLE_CANDIDATE],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const supabase = makeSupabase({
      detection: { id: DET_ID, status: 'pending', raw_title: 'Stary raw_title' },
    });
    const ctx = makeContext({
      supabase,
      body: { title: '', isbn: '9788383100012' },
    });
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(true);
    // raw_title nie zostaje nadpisany pustym stringiem — zachowuje istniejącą wartość.
    const detection = json.data!['detection'] as { raw_title: string };
    expect(detection.raw_title).toBe('Stary raw_title');
  });

  it('ISBN-only zastępuje ISTNIEJĄCEGO, lepiej ocenionego (ale błędnego) kandydata mimo niższego matchScore', async () => {
    // Regresja: przy pustym tytule matchScore trafienia po ISBN jest strukturalnie
    // niski (titleSim=0 → score ~0.2 wg formuły w docs/prd.md §10). Konserwatywna
    // polityka zastępowania (CONSERVATIVE_REPLACE_MARGIN=0.08) bez wyjątku dla
    // isbnOnly odrzucałaby to trafienie, jeśli istnieje starszy kandydat o wyższym
    // (ale błędnym) score — dokładnie scenariusz zgłoszony w manualnym teście #153.
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [MOCK_GOOGLE_CANDIDATE],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const supabase = makeSupabase({
      detection: { id: DET_ID, status: 'matched', raw_title: 'Nieznana' },
      // Istniejący, wysoko oceniony (ale błędny) kandydat z wcześniejszej próby.
      existingCandidates: [{ match_score: 0.6, rank: 1 }],
    });
    const ctx = makeContext({
      supabase,
      body: { title: '', isbn: '9788383100012' },
    });
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(true);
    const candidates = json.data!['candidates'] as { isbn13: string | null }[];
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].isbn13).toBe('9788383100012');
  });

  it('404 gdy detekcja nie istnieje', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({ supabase: makeSupabase({ detection: null }) });
    const res = await POST(ctx);
    expect(res.status).toBe(404);
  });

  it('happy path — zwraca kandydatów z DB id gdy Google Books zwraca wyniki', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [MOCK_GOOGLE_CANDIDATE],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(true);
    const candidates = json.data!['candidates'] as { id: string; matchScore: number }[];
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].id).toBe(CAND_ID);
    expect(candidates[0].matchScore).toBeGreaterThan(0.5);
  });

  it('applied: false gdy Google Books zwraca pustą listę', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(false);
    expect((json.data!['candidates'] as unknown[]).length).toBe(0);
  });

  it('429 gdy Google Books rate limited', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'rate_limited' });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({});
    const res = await POST(ctx);
    expect(res.status).toBe(429);
    const json = (await res.json()) as ApiJson;
    expect(json.error!.code).toBe('RATE_LIMITED');
  });

  it('aktualizuje raw_title i raw_author w DB', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [MOCK_GOOGLE_CANDIDATE],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const supabase = makeSupabase({});
    const ctx = makeContext({ supabase, body: { title: 'Nowy Tytuł', author: 'Autor' } });
    await POST(ctx);
    const updateCall = vi.mocked(supabase.from).mock.calls.find(([t]) => t === 'detections');
    expect(updateCall).toBeTruthy();
  });

  it('loguje oryginalny raw_title/raw_author do corrections PRZED nadpisaniem (weak-match-resolve-and-ocr-audit)', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [MOCK_GOOGLE_CANDIDATE],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const supabase = makeSupabase({
      detection: {
        id: DET_ID,
        status: 'pending',
        raw_title: 'Marowska Duchowska',
      } as any,
    });
    const ctx = makeContext({
      supabase,
      body: { title: 'Przerwana kołysanka', author: 'Natasza Socha' },
    });
    await POST(ctx);

    expect(supabase.correctionsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        detection_id: DET_ID,
        original_raw_title: 'Marowska Duchowska',
        corrected_title: 'Przerwana kołysanka',
        corrected_authors: ['Natasza Socha'],
        correction_type: 'rematch',
      }),
    );
  });

  it('błąd insertu corrections nie blokuje głównej odpowiedzi (non-blocking)', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [MOCK_GOOGLE_CANDIDATE],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const supabase = makeSupabase({
      correctionInsertResult: { error: { name: 'Error', message: 'boom', code: '500' } },
    });
    const ctx = makeContext({ supabase });
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(true);
  });

  it('odfiltrowuje kandydata z zupełnie innym autorem (Agnieszka Lis vs Kazimierz Arendt)', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [
        {
          source: 'google_books',
          externalId: 'gb-x',
          title: 'Poczta polska',
          authors: ['Kazimierz Arendt'],
          isbn10: null,
          isbn13: null,
          publisher: null,
          publishedYear: null,
          coverUrl: null,
          description: null,
        },
      ],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({ body: { title: 'Poczta', author: 'Agnieszka Lis' } });
    const res = await POST(ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(false);
    expect((json.data!['candidates'] as unknown[]).length).toBe(0);
  });

  it('zachowuje kandydata cross-języka ze score ≥0.25 (autor pasuje, tytuł nie) — dawne 0.55 by go odrzuciło', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [
        {
          source: 'google_books',
          externalId: 'gb-keret',
          title: 'The Bus Driver Who Wanted to Be God',
          authors: ['Etgar Keret'],
          isbn10: null,
          isbn13: '9781592640225',
          publisher: null,
          publishedYear: 2004,
          coverUrl: null,
          description: null,
        },
      ],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({
      body: { title: 'Usterka na skraju galaktyki', author: 'Etgar Keret' },
    });
    const res = await POST(ctx);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(true);
    expect((json.data!['candidates'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('dorzuca kandydata z Biblioteki Narodowej gdy GB+OL puste (polska edycja)', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchNationalLibrary).mockResolvedValue({
      ok: true,
      candidates: [
        {
          source: 'national_library',
          externalId: 'bn-1',
          title: 'Usterka na skraju galaktyki',
          authors: ['Keret, Etgar'],
          isbn10: null,
          isbn13: '9788308073087',
          publisher: 'Wydawnictwo Literackie',
          publishedYear: 2020,
          coverUrl: null,
          description: null,
        },
      ],
    });
    const ctx = makeContext({
      body: { title: 'Usterka na skraju galaktyki', author: 'Etgar Keret' },
    });
    const res = await POST(ctx);
    const json = (await res.json()) as ApiJson;
    expect(json.data!['applied']).toBe(true);
    expect((json.data!['candidates'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('przekazuje ISBN z formularza do Google Books i OpenLibrary', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({ body: { title: 'Coś', author: null, isbn: '9788308073087' } });
    await POST(ctx);
    expect(vi.mocked(searchGoogleBooks)).toHaveBeenCalledWith(
      expect.objectContaining({ isbn: '9788308073087' }),
    );
    expect(vi.mocked(searchOpenLibrary)).toHaveBeenCalledWith(
      expect.objectContaining({ isbn: '9788308073087' }),
    );
  });

  it('auto-ekstrahuje autora z „Tytuł — Imię Nazwisko" gdy pole autora puste', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const ctx = makeContext({
      body: { title: 'Sto lat samotności — Gabriel García Márquez', author: null },
    });
    await POST(ctx);
    expect(vi.mocked(searchGoogleBooks)).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sto lat samotności', author: 'Gabriel García Márquez' }),
    );
  });

  // ---------------------------------------------------------------------------
  // plan-review F2 (candidate-cover-override): dziedziczenie okładki rank-1
  // przy zastąpieniu kandydatów, żeby ręcznie ustawiona okładka nie ginęła.
  // ---------------------------------------------------------------------------

  it('dziedziczy okładkę starego rank-1 gdy nowy top wynik jej nie ma', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [MOCK_CANDIDATE_NO_ISBN_NO_COVER],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const supabase = makeSupabase({
      existingCandidates: [{ match_score: 0.9, rank: 1, cover_url: 'https://old-cover.jpg' }],
    });
    const ctx = makeContext({ supabase });
    const res = await POST(ctx);
    expect(res.status).toBe(200);

    const insertedRows = supabase.candidatesInsertMock.mock.calls[0][0] as {
      cover_url: string | null;
    }[];
    expect(insertedRows[0].cover_url).toBe('https://old-cover.jpg');
  });

  it('NIE nadpisuje okładki gdy nowy top wynik ma własną', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [{ ...MOCK_GOOGLE_CANDIDATE, coverUrl: 'https://new-cover.jpg' }],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const supabase = makeSupabase({
      existingCandidates: [{ match_score: 0.9, rank: 1, cover_url: 'https://old-cover.jpg' }],
    });
    const ctx = makeContext({ supabase });
    const res = await POST(ctx);
    expect(res.status).toBe(200);

    const insertedRows = supabase.candidatesInsertMock.mock.calls[0][0] as {
      cover_url: string | null;
    }[];
    expect(insertedRows[0].cover_url).toBe('https://new-cover.jpg');
  });

  it('brak starej okładki → nowy kandydat zostaje bez okładki (null)', async () => {
    vi.mocked(searchGoogleBooks).mockResolvedValue({
      ok: true,
      candidates: [MOCK_CANDIDATE_NO_ISBN_NO_COVER],
    });
    vi.mocked(searchOpenLibraryByTitle).mockResolvedValue({ ok: false, reason: 'empty' });
    vi.mocked(searchOpenLibrary).mockResolvedValue({ ok: false, reason: 'empty' });
    const supabase = makeSupabase({
      existingCandidates: [{ match_score: 0.9, rank: 1, cover_url: null }],
    });
    const ctx = makeContext({ supabase });
    await POST(ctx);

    const insertedRows = supabase.candidatesInsertMock.mock.calls[0][0] as {
      cover_url: string | null;
    }[];
    expect(insertedRows[0].cover_url).toBeNull();
  });
});
