import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchNationalLibrary } from '../../../../src/lib/books/nationalLibrary';

// Realny kształt rekordu BN (skrót z data.bn.org.pl dla „Usterka na skraju galaktyki").
const keretBib = {
  id: 1000000795638,
  isbnIssn: '9788308073087',
  publisher: 'Wydawnictwo Literackie Wydawnictwo Literackie,',
  publicationYear: '2020',
  title: 'Usterka na skraju galaktyki / Taḳalah bi-ḳetseh ha-galaḳsyah',
  author: 'Keret, Etgar (1967- ) Maciejowska, Agnieszka',
  marc: {
    fields: [
      { '001': 'b1000000795638' },
      {
        '020': {
          ind1: ' ',
          ind2: ' ',
          subfields: [{ a: '9788308073087' }, { q: '(oprawa twarda) :' }],
        },
      },
      {
        '100': {
          ind1: '1',
          ind2: ' ',
          subfields: [{ a: 'Keret, Etgar' }, { d: '(1967- )' }, { e: 'Autor' }],
        },
      },
      {
        '245': {
          ind1: '1',
          ind2: '0',
          subfields: [
            { a: 'Usterka na skraju galaktyki /' },
            { c: 'Etgar Keret ; tłumaczyła Agnieszka Maciejowska.' },
          ],
        },
      },
      {
        '260': {
          ind1: ' ',
          ind2: ' ',
          subfields: [{ a: 'Kraków :' }, { b: 'Wydawnictwo Literackie,' }, { c: '2020.' }],
        },
      },
      {
        '700': {
          ind1: '1',
          ind2: ' ',
          subfields: [{ a: 'Maciejowska, Agnieszka' }, { e: 'Tłumaczenie' }],
        },
      },
    ],
  },
};

function mockFetch(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.restoreAllMocks());

describe('searchNationalLibrary', () => {
  it('mapuje rekord BN: tytuł z 245$a, autor z 100$a (bez tłumacza), ISBN, wydawca, rok', async () => {
    mockFetch({ bibs: [keretBib] });
    const result = await searchNationalLibrary({
      title: 'Usterka na skraju galaktyki',
      author: 'Etgar Keret',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.candidates[0];
    expect(c.source).toBe('national_library');
    expect(c.title).toBe('Usterka na skraju galaktyki'); // 245$a, zdjęte " /"
    expect(c.authors).toEqual(['Keret, Etgar']); // 100$a — bez 700 (tłumacz)
    expect(c.isbn13).toBe('9788308073087');
    expect(c.publisher).toBe('Wydawnictwo Literackie'); // 260$b, zdjęty przecinek
    expect(c.publishedYear).toBe(2020);
    expect(c.coverUrl).toBeNull(); // BN bez okładek — OL enrichment downstream
  });

  it('do filtra title wysyła PEŁNY tytuł z polskimi znakami (BN obsługuje diakrytyki)', async () => {
    // Realny case: „TOAST za Odważnych" — poprzedni kod stripował „Odważnych" (ą/ż)
    // i wysyłał tylko „TOAST za", przez co BN nie znajdowało książki.
    const spy = mockFetch({ bibs: [] });
    await searchNationalLibrary({ title: 'TOAST za Odważnych', author: 'Magdalena Jedrysek' });
    const params = new URL(spy.mock.calls[0][0] as string).searchParams;
    expect(params.get('title')).toBe('TOAST za Odważnych'); // pełny tytuł z ą/ż
  });

  it('normalizuje cyrylicki homoglif w tytule (deCyrillic) — „Przytulajkа"→„Przytulajka"', async () => {
    const spy = mockFetch({ bibs: [] });
    // „Przytulajk" + cyrylickie „а" (U+0430) — realny case z vision-OCR.
    await searchNationalLibrary({ title: 'Przytulajkа', author: 'Agnieszka Krawczyk' });
    const url = spy.mock.calls[0][0] as string;
    expect(decodeURIComponent(url)).toContain('title=Przytulajka'); // łacińskie a
    expect(url).not.toContain('%D0%B0'); // brak cyrylickiego а w zapytaniu
  });

  it('tytuł z samymi polskimi znakami (np. „Wiedźmin") → BN wysyła go bezpośrednio', async () => {
    // BN obsługuje ź — fetch jest wołany z pełnym tytułem; bibs=[] → reason empty.
    const spy = mockFetch({ bibs: [] });
    const result = await searchNationalLibrary({ title: 'Wiedźmin', author: null });
    expect(spy).toHaveBeenCalled();
    const params = new URL(spy.mock.calls[0][0] as string).searchParams;
    expect(params.get('title')).toBe('Wiedźmin');
    expect(result.ok).toBe(false);
  });

  it('ISBN → exact lookup przez isbnIssn (cyfry, brak ryzyka 400)', async () => {
    const spy = mockFetch({ bibs: [keretBib] });
    await searchNationalLibrary({ title: 'cokolwiek', isbn: '978-83-08-07308-7' });
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('isbnIssn=9788308073087'); // myślniki zdjęte
    expect(url).not.toContain('title=');
  });

  it('HTTP 400 na primary i fallback → reason network, bez crasha', async () => {
    mockFetch({}, 400); // mockResolvedValue — obowiązuje dla obu wywołań
    const result = await searchNationalLibrary({ title: 'Solaris' });
    expect(result).toEqual({ ok: false, reason: 'network' });
  });

  it('kaskada wariantów: title+author → title-only → tytuł+nazwisko → ... (stop na hit)', async () => {
    // Realny case: „TOAST za Odważnych" / „Magdalena Jedrysek" (OCR-owy autor bez ę).
    // BN AND-filter (title+fullAuthor) zwraca 0 bo BN przechowuje „Jędrsynek, Magdalena".
    // Wariant 2 (sam tytuł) trafia → stop.
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ bibs: [] }), { status: 200 })) // wariant 1: title+author → empty
      .mockResolvedValueOnce(new Response(JSON.stringify({ bibs: [keretBib] }), { status: 200 })); // wariant 2: sam tytuł → hit
    const result = await searchNationalLibrary({
      title: 'TOAST za Odważnych',
      author: 'Magdalena Jedrysek',
    });
    expect(spy).toHaveBeenCalledTimes(2); // stop po 2 zapytaniach
    const v1 = new URL(spy.mock.calls[0][0] as string).searchParams;
    expect(v1.get('title')).toBe('TOAST za Odważnych');
    expect(v1.get('author')).toBe('Magdalena Jedrysek'); // wariant 1: z autorem
    const v2 = new URL(spy.mock.calls[1][0] as string).searchParams;
    expect(v2.get('title')).toBe('TOAST za Odważnych');
    expect(v2.get('author')).toBeNull(); // wariant 2: sam tytuł (bez autora)
    expect(result.ok).toBe(true);
  });

  it('kaskada wariantów: wszystkie puste → reason empty (bez safe-query call)', async () => {
    // Gdy BN nie znajduje nic w żadnym wariancie → empty, bez dodatkowego safe-query.
    // mockImplementation (nie mockResolvedValue) — każde wywołanie tworzy nowy Response
    // (Response.json() konsumuje body jednorazowo; reużycie tego samego obiektu → błąd).
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ bibs: [] }), { status: 200 })),
      );
    const result = await searchNationalLibrary({ title: 'Solaris', author: 'Lem' });
    expect(result).toEqual({ ok: false, reason: 'empty' });
    expect(spy).toHaveBeenCalled();
  });

  it('kaskada dociera do „sam autor" gdy tytuł i 1.słowo puste (tylko autor znany)', async () => {
    // Patologiczny case: title='' (po cleanSearchTitle); autor podany.
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ bibs: [keretBib] }), { status: 200 }));
    const result = await searchNationalLibrary({ title: '', author: 'Etgar Keret' });
    expect(spy).toHaveBeenCalledTimes(1);
    const p = new URL(spy.mock.calls[0][0] as string).searchParams;
    expect(p.get('title')).toBeNull();
    expect(p.get('author')).toBe('Etgar Keret'); // wariant „sam autor"
    expect(result.ok).toBe(true);
  });

  it('HTTP 400 na primary → retry z safe query (bez diakrytyków); safe trafia', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ bibs: [keretBib] }), { status: 200 }));
    const result = await searchNationalLibrary({ title: 'Wielki ogarniacz życia' });
    expect(spy).toHaveBeenCalledTimes(2);
    // primary: pełny tytuł z ż
    const primaryParams = new URL(spy.mock.calls[0][0] as string).searchParams;
    expect(primaryParams.get('title')).toContain('życia');
    // fallback: „życia" (ż) odfiltrowane
    const fallbackParams = new URL(spy.mock.calls[1][0] as string).searchParams;
    expect(fallbackParams.get('title')).toContain('Wielki');
    expect(fallbackParams.get('title')).not.toContain('życia');
    expect(result.ok).toBe(true);
  });

  it('pusta lista bibs → reason empty', async () => {
    mockFetch({ bibs: [] });
    const result = await searchNationalLibrary({ title: 'Solaris' });
    expect(result).toEqual({ ok: false, reason: 'empty' });
  });

  it('429 → reason rate_limited', async () => {
    mockFetch({}, 429);
    const result = await searchNationalLibrary({ title: 'Solaris' });
    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });
});
