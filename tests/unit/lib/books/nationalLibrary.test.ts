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
      { '020': { ind1: ' ', ind2: ' ', subfields: [{ a: '9788308073087' }, { q: '(oprawa twarda) :' }] } },
      { '100': { ind1: '1', ind2: ' ', subfields: [{ a: 'Keret, Etgar' }, { d: '(1967- )' }, { e: 'Autor' }] } },
      { '245': { ind1: '1', ind2: '0', subfields: [{ a: 'Usterka na skraju galaktyki /' }, { c: 'Etgar Keret ; tłumaczyła Agnieszka Maciejowska.' }] } },
      { '260': { ind1: ' ', ind2: ' ', subfields: [{ a: 'Kraków :' }, { b: 'Wydawnictwo Literackie,' }, { c: '2020.' }] } },
      { '700': { ind1: '1', ind2: ' ', subfields: [{ a: 'Maciejowska, Agnieszka' }, { e: 'Tłumaczenie' }] } },
    ],
  },
};

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status })
  );
}

afterEach(() => vi.restoreAllMocks());

describe('searchNationalLibrary', () => {
  it('mapuje rekord BN: tytuł z 245$a, autor z 100$a (bez tłumacza), ISBN, wydawca, rok', async () => {
    mockFetch({ bibs: [keretBib] });
    const result = await searchNationalLibrary({ title: 'Usterka na skraju galaktyki', author: 'Etgar Keret' });
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

  it('do filtra title wysyła tylko słowa BEZ diakrytyków (gotcha 400 BN)', async () => {
    const spy = mockFetch({ bibs: [] });
    await searchNationalLibrary({ title: 'Wielki ogarniacz życia', author: 'Bukowa' });
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('title=Wielki+ogarniacz'); // „życia" (ż) odrzucone
    expect(url).not.toContain('życia');
    expect(decodeURIComponent(url)).not.toContain('ż');
  });

  it('pomija zapytanie tytułowe gdy tytuł w całości diakrytykowy (np. „Wiedźmin")', async () => {
    const spy = mockFetch({ bibs: [] });
    const result = await searchNationalLibrary({ title: 'Wiedźmin', author: null });
    expect(spy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it('ISBN → exact lookup przez isbnIssn (cyfry, brak ryzyka 400)', async () => {
    const spy = mockFetch({ bibs: [keretBib] });
    await searchNationalLibrary({ title: 'cokolwiek', isbn: '978-83-08-07308-7' });
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('isbnIssn=9788308073087'); // myślniki zdjęte
    expect(url).not.toContain('title=');
  });

  it('HTTP 400 (buggy filtr BN) → reason network, bez crasha', async () => {
    mockFetch({}, 400);
    const result = await searchNationalLibrary({ title: 'Solaris' });
    expect(result).toEqual({ ok: false, reason: 'network' });
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
