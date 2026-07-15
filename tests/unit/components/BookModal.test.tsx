import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookModal from '../../../src/components/BookModal';

// Mock supabase browser client (cover upload)
vi.mock('../../../src/lib/db/supabase.browser', () => ({
  createBrowserSupabaseClient: vi.fn(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage/cover.jpg' } }),
      })),
    },
  })),
}));

const SHELF_ID = '00000000-0000-4000-8000-000000000001';
const BOOK_ID = '00000000-0000-4000-8000-000000000050';

const BASE_BOOK = {
  id: BOOK_ID,
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  publisher: 'Solaris Press',
  publishedYear: 1961,
  isbn13: '9780156027601',
  isbn10: null,
  coverUrl: 'https://covers.openlibrary.org/b/isbn/9780156027601-M.jpg',
  cover_url: 'https://covers.openlibrary.org/b/isbn/9780156027601-M.jpg',
  user_cover_url: null,
  cover_photo_url: null,
  cover_source: 'auto' as const,
  photoId: null,
  source: 'google_books',
  matchScore: 0.92,
};

const CANDIDATE = {
  title: 'Nowa Solaris',
  authors: ['S. Lem'],
  isbn13: '9781234567890',
  isbn10: null,
  publisher: 'New Publisher',
  publishedYear: 2020,
  coverUrl: 'https://covers.openlibrary.org/b/isbn/9781234567890-M.jpg',
  source: 'google_books',
  externalId: 'gb-2',
  matchScore: 0.88,
};

/** Tworzy nowy Response per call (body ReadableStream konsumuje się raz).
 *  URL routing: purchase-hints → hintsBody (default empty), wszystko inne → body. */
function mockFetch(
  body: object,
  status = 200,
  { hintsBody = { data: { hints: [] } } }: { hintsBody?: object } = {},
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('/api/books/purchase-hints')) {
      return Promise.resolve(new Response(JSON.stringify(hintsBody), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch({ data: { candidates: [] } });
});

// ---------------------------------------------------------------------------
// add mode

describe('BookModal — tryb add', () => {
  it('renderuje pusty formularz', () => {
    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);
    expect(screen.getByTestId('book-modal')).toBeTruthy();
    expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('book-modal-save')).toBeTruthy();
  });

  it('przycisk Zapisz disabled gdy tytuł pusty', () => {
    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);
    const btn = screen.getByTestId('book-modal-save') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('walidacja: tytuł wymagany — submit nie wołuje fetch /api/books gdy pusty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await new Promise((r) => setTimeout(r, 50));
    const booksCalls = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && url === '/api/books',
    );
    expect(booksCalls).toHaveLength(0);
  });

  it('POST /api/books przy zapisie', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    mockFetch({ data: { id: BOOK_ID } });

    render(<BookModal mode="add" shelfId={SHELF_ID} onSaved={onSaved} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('book-field-title'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();

    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const postCall = fetchSpy.mock.calls.find(([url]) => url === '/api/books') as
      [string, RequestInit] | undefined;
    expect(postCall).toBeDefined();
    expect((postCall![1] as { method: string }).method).toBe('POST');
    const body = JSON.parse((postCall![1] as { body: string }).body);
    expect(body.shelf_id).toBe(SHELF_ID);
    expect(body.title).toBe('Test');
  });

  it('„Wyszukaj po danych" → prefill pól z kandydata', async () => {
    mockFetch({ data: { candidates: [CANDIDATE] } });

    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);

    // W trybie add SearchPanel ma hideForm=true — wpisz dane w głównym formularzu,
    // klik „Wyszukaj po danych" auto-odpala wyszukiwanie po initialTitle/initialIsbn.
    fireEvent.change(screen.getByTestId('book-field-title'), { target: { value: 'Solaris' } });
    fireEvent.click(screen.getByTestId('search-candidates-toggle'));

    await waitFor(() => screen.getByTestId('candidates-use-0'));
    fireEvent.click(screen.getByTestId('candidates-use-0'));

    expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe(
      CANDIDATE.title,
    );
    expect((screen.getByTestId('book-field-isbn13') as HTMLInputElement).value).toBe(
      CANDIDATE.isbn13,
    );
  });

  it('„Wyszukaj po danych" disabled przy pustych polach, enabled po wpisaniu tytułu', () => {
    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);
    const toggle = screen.getByTestId('search-candidates-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('book-field-title'), { target: { value: 'Solaris' } });
    expect(toggle.disabled).toBe(false);
  });

  it('auto-search przekazuje autora z głównego formularza do /api/books/candidates', async () => {
    const fetchSpy = mockFetch({ data: { candidates: [CANDIDATE] } });
    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('book-field-title'), {
      target: { value: 'Ostatnie życzenie' },
    });
    fireEvent.change(screen.getByTestId('book-field-authors'), {
      target: { value: 'Andrzej Sapkowski' },
    });
    fireEvent.click(screen.getByTestId('search-candidates-toggle'));

    await waitFor(() =>
      fetchSpy.mock.calls.some(([url]: [unknown]) => url === '/api/books/candidates'),
    );
    const candidatesCall = fetchSpy.mock.calls.find(
      ([url]: [unknown]) => url === '/api/books/candidates',
    ) as [string, RequestInit];
    const body = JSON.parse((candidatesCall[1] as { body: string }).body);
    expect(body.title).toBe('Ostatnie życzenie');
    expect(body.author).toBe('Andrzej Sapkowski');
  });

  it('cover parity: renderuje CoverEditor (3 sloty) jak w edit', () => {
    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);
    expect(screen.getByTestId('add-cover-section')).toBeTruthy();
    expect(screen.getByTestId('add-cover-source-auto')).toBeTruthy();
    expect(screen.getByTestId('add-cover-source-url')).toBeTruthy();
    expect(screen.getByTestId('add-cover-source-photo')).toBeTruthy();
    expect(screen.getByTestId('add-cover-url-input')).toBeTruthy();
    expect(screen.getByTestId('add-cover-autocheck')).toBeTruthy();
  });

  it('POST zawiera sloty okładki gdy podano URL + źródło url', async () => {
    const onSaved = vi.fn();
    mockFetch({ data: { id: BOOK_ID } });
    render(<BookModal mode="add" shelfId={SHELF_ID} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('book-field-title'), { target: { value: 'Z okładką' } });
    fireEvent.change(screen.getByTestId('add-cover-url-input'), {
      target: { value: 'https://user.jpg' },
    });
    fireEvent.click(screen.getByTestId('add-cover-source-url'));
    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const fetchSpy2 = globalThis.fetch as ReturnType<typeof vi.fn>;
    const postCall2 = fetchSpy2.mock.calls.find(([url]) => url === '/api/books') as
      [string, RequestInit] | undefined;
    const body = JSON.parse((postCall2![1] as { body: string }).body);
    expect(body.user_cover_url).toBe('https://user.jpg');
    expect(body.cover_source).toBe('url');
  });

  it('POST zawiera purchase fields gdy ustawione', async () => {
    const onSaved = vi.fn();
    mockFetch({ data: { id: BOOK_ID } });
    render(<BookModal mode="add" shelfId={SHELF_ID} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('book-field-title'), { target: { value: 'Test zakup' } });
    fireEvent.change(screen.getByTestId('purchase-price'), { target: { value: '29.99' } });
    fireEvent.change(screen.getByTestId('purchase-city'), { target: { value: 'Kraków' } });
    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const postCall = fetchSpy.mock.calls.find(([url]) => url === '/api/books') as
      [string, RequestInit] | undefined;
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as { body: string }).body);
    expect(body.purchase_price).toBe(29.99);
    expect(body.purchase_city).toBe('Kraków');
  });

  it('błąd 409 wyświetla komunikat o duplikacie', async () => {
    mockFetch({ error: { code: 'CONFLICT', message: 'Masz już tę książkę.' } }, 409);
    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('book-field-title'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByTestId('book-modal-save'));
    await waitFor(() => screen.getByTestId('book-modal-error'));
    expect(screen.getByTestId('book-modal-error').textContent).toContain('Masz już tę książkę.');
  });
});

// ---------------------------------------------------------------------------
// edit mode

describe('BookModal — tryb edit', () => {
  it('renderuje prefillowane pola', () => {
    render(<BookModal mode="edit" book={BASE_BOOK} onClose={vi.fn()} />);
    expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe('Solaris');
    expect((screen.getByTestId('book-field-isbn13') as HTMLInputElement).value).toBe(
      '9780156027601',
    );
  });

  it('sekcja okładki zawsze rozwinięta — brak toggle „Zmień okładkę" i osobnego „Zapisz okładkę"', () => {
    render(<BookModal mode="edit" book={BASE_BOOK} onClose={vi.fn()} />);
    expect(screen.getByTestId('edit-cover-section')).toBeTruthy();
    expect(screen.queryByTestId('edit-cover-toggle')).toBeNull();
    expect(screen.queryByTestId('edit-cover-save')).toBeNull();
  });

  it('unify-book-save: jeden „Zapisz" → PATCH metadane + sloty okładki', async () => {
    const onSaved = vi.fn();
    mockFetch({ data: { id: BOOK_ID } });
    render(<BookModal mode="edit" book={BASE_BOOK} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('edit-cover-url-input'), {
      target: { value: 'https://user.jpg' },
    });
    fireEvent.click(screen.getByTestId('edit-cover-source-url'));
    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const fetchSpy3 = globalThis.fetch as ReturnType<typeof vi.fn>;
    const patchCall = fetchSpy3.mock.calls.find(([url]) => url === `/api/books/${BOOK_ID}`) as [
      string,
      RequestInit,
    ];
    expect(patchCall).toBeDefined();
    expect((patchCall[1] as { method: string }).method).toBe('PATCH');
    const body = JSON.parse((patchCall[1] as { body: string }).body);
    expect(body.title).toBe('Solaris'); // metadane w tym samym zapisie
    expect(body.user_cover_url).toBe('https://user.jpg');
    expect(body.cover_source).toBe('url');
  });

  it('PATCH /api/books/:id przy zapisie', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    mockFetch({ data: { id: BOOK_ID } });

    render(<BookModal mode="edit" book={BASE_BOOK} onSaved={onSaved} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('book-field-title'), {
      target: { value: 'Solaris Updated' },
    });
    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const fetchSpy4 = globalThis.fetch as ReturnType<typeof vi.fn>;
    const patchCall2 = fetchSpy4.mock.calls.find(([url]) => url === `/api/books/${BOOK_ID}`) as [
      string,
      RequestInit,
    ];
    expect(patchCall2).toBeDefined();
    expect((patchCall2[1] as { method: string }).method).toBe('PATCH');
  });

  it('PATCH zawiera purchase fields gdy zmienione', async () => {
    const onSaved = vi.fn();
    mockFetch({ data: { id: BOOK_ID } });
    render(<BookModal mode="edit" book={BASE_BOOK} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('purchase-date'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByTestId('purchase-event'), { target: { value: 'Targi Książki' } });
    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const patchCall = fetchSpy.mock.calls.find(([url]) => url === `/api/books/${BOOK_ID}`) as [
      string,
      RequestInit,
    ];
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall[1] as { body: string }).body);
    expect(body.purchase_date).toBe('2026-06-01');
    expect(body.purchase_event).toBe('Targi Książki');
  });

  it('prefill z kandydata w edit mode — bez zdublowanych pól (hideForm)', async () => {
    mockFetch({ data: { candidates: [CANDIDATE] } });

    render(<BookModal mode="edit" book={BASE_BOOK} onClose={vi.fn()} />);
    // W edit, tak jak w add, panel ma hideForm — klik toggle auto-szuka po danych
    // już wpisanych w głównym formularzu (BASE_BOOK ma tytuł + ISBN).
    fireEvent.click(screen.getByTestId('search-candidates-toggle'));

    // REGRESJA: brak zdublowanego formularza tytuł/ISBN/autor w panelu.
    expect(screen.queryByTestId('candidates-title')).toBeNull();
    expect(screen.queryByTestId('candidates-search')).toBeNull();

    await waitFor(() => screen.getByTestId('candidates-use-0'));
    fireEvent.click(screen.getByTestId('candidates-use-0'));

    expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe(
      CANDIDATE.title,
    );
  });

  it('auto-search w edit szuka też po autorze książki', async () => {
    const fetchSpy = mockFetch({ data: { candidates: [CANDIDATE] } });
    render(<BookModal mode="edit" book={BASE_BOOK} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('search-candidates-toggle'));

    await waitFor(() =>
      fetchSpy.mock.calls.some(([url]: [unknown]) => url === '/api/books/candidates'),
    );
    const candidatesCall2 = fetchSpy.mock.calls.find(
      ([url]: [unknown]) => url === '/api/books/candidates',
    ) as [string, RequestInit];
    const body = JSON.parse((candidatesCall2[1] as { body: string }).body);
    expect(body.author).toBe('Stanisław Lem');
  });

  it('pokazuje przycisk „Źródłowe zdjęcie" gdy photoId ustawione', () => {
    render(
      <BookModal
        mode="edit"
        book={{ ...BASE_BOOK, photoId: 'photo-uuid-123' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('book-modal-source-photo')).toBeTruthy();
  });

  it('nie pokazuje „Źródłowe zdjęcie" gdy brak photoId', () => {
    render(<BookModal mode="edit" book={BASE_BOOK} onClose={vi.fn()} />);
    expect(screen.queryByTestId('book-modal-source-photo')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// propose mode (candidate-propose-edit-all-fields) — w pełni edytowalny,
// trzy akcje: Zapisz (PATCH /candidate) / Akceptuj propozycję (POST /confirm,
// z dirty-check dialogiem) / Anuluj.

const DETECTION_ID = '00000000-0000-4000-8000-000000000070';
const CANDIDATE_ID_VALUE = '00000000-0000-4000-8000-000000000071';
const CANDIDATE_BOOK = {
  ...BASE_BOOK,
  id: CANDIDATE_ID_VALUE,
  detectionId: DETECTION_ID,
};

/** Router fetch mock: purchase-hints zawsze pusty; inne endpointy wg mapy zawierania URL. */
function mockFetchRoutes(
  routes: [string, { body: object; status?: number }][],
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = typeof url === 'string' ? url : String(url);
    if (u.includes('/api/books/purchase-hints')) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: { hints: [] } }), { status: 200 }),
      );
    }
    const match = routes.find(([needle]) => u.includes(needle));
    if (match) {
      const [, { body, status }] = match;
      return Promise.resolve(new Response(JSON.stringify(body), { status: status ?? 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ data: { candidates: [] } }), { status: 200 }),
    );
  });
}

describe('BookModal — tryb propose: pola w pełni edytowalne', () => {
  it('pola NIE są read-only (tytuł edytowalny)', () => {
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);
    const titleInput = screen.getByTestId('book-field-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Solaris');
    expect(titleInput.readOnly).toBe(false);
    fireEvent.change(titleInput, { target: { value: 'Zmieniony tytuł' } });
    expect(titleInput.value).toBe('Zmieniony tytuł');
  });

  it('SearchPanel („Wyszukaj po danych") widoczny w propose', () => {
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);
    expect(screen.getByTestId('search-candidates-toggle')).toBeTruthy();
  });

  it('sekcja zakupu (PurchaseSection) widoczna w propose', () => {
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);
    expect(screen.getByTestId('purchase-price')).toBeTruthy();
    expect(screen.getByTestId('purchase-city')).toBeTruthy();
  });

  it('CoverEditor (3 sloty) widoczny w propose', () => {
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);
    expect(screen.getByTestId('propose-cover-section')).toBeTruthy();
    expect(screen.getByTestId('propose-cover-source-auto')).toBeTruthy();
    expect(screen.getByTestId('propose-cover-source-url')).toBeTruthy();
    expect(screen.getByTestId('propose-cover-source-photo')).toBeTruthy();
    expect(screen.getByTestId('propose-cover-url-input')).toBeTruthy();
  });

  it('pokazuje „Szukaj w sieci"', () => {
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);
    expect(screen.getByTestId('book-modal-web-search')).toBeTruthy();
  });

  it('pokazuje przyciski Zapisz + Akceptuj propozycję + Anuluj', () => {
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);
    expect(screen.getByTestId('book-modal-save')).toBeTruthy();
    expect(screen.getByTestId('book-modal-confirm')).toBeTruthy();
    expect(screen.getByTestId('book-modal-cancel')).toBeTruthy();
  });

  it('Zapisz + Akceptuj propozycję disabled gdy brak id/detectionId kandydata (defensywnie)', () => {
    render(<BookModal mode="propose" book={BASE_BOOK} onClose={vi.fn()} />);
    expect((screen.getByTestId('book-modal-save') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('book-modal-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Escape zamyka modal', async () => {
    const onClose = vi.fn();
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('BookModal — tryb propose: Zapisz (PATCH pełnej edycji kandydata)', () => {
  it('„Zapisz" PATCH-uje wszystkie bieżące pola do /api/detections/[id]/candidate i woła onCandidateSaved z pełnym patchem', async () => {
    mockFetchRoutes([[`/api/detections/${DETECTION_ID}/candidate`, { body: { data: {} } }]]);
    const onCandidateSaved = vi.fn();
    render(
      <BookModal
        mode="propose"
        book={CANDIDATE_BOOK}
        onCandidateSaved={onCandidateSaved}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('book-field-title'), {
      target: { value: 'Solaris (poprawiony)' },
    });
    fireEvent.change(screen.getByTestId('book-field-isbn13'), {
      target: { value: '9781111111111' },
    });
    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => expect(onCandidateSaved).toHaveBeenCalled());

    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const patchCall = fetchSpy.mock.calls.find(
      ([url]) => url === `/api/detections/${DETECTION_ID}/candidate`,
    ) as [string, RequestInit];
    expect(patchCall).toBeDefined();
    expect((patchCall[1] as { method: string }).method).toBe('PATCH');
    const body = JSON.parse((patchCall[1] as { body: string }).body);
    expect(body.candidate_id).toBe(CANDIDATE_BOOK.id);
    expect(body.title).toBe('Solaris (poprawiony)');
    expect(body.isbn_13).toBe('9781111111111');
    // cover_url + purchase_* zawsze dołączane do tego samego PATCH — scalenie z okładką
    expect(body).toHaveProperty('cover_url');
    expect(body).toHaveProperty('purchase_date');
    expect(body).toHaveProperty('purchase_price');
    expect(body).toHaveProperty('purchase_city');
    expect(body).toHaveProperty('purchase_event');

    const patch = onCandidateSaved.mock.calls[0][0];
    expect(patch.title).toBe('Solaris (poprawiony)');
    expect(patch.isbn13).toBe('9781111111111');
  });

  it('modal NIE zamyka się automatycznie po Zapisz', async () => {
    mockFetchRoutes([[`/api/detections/${DETECTION_ID}/candidate`, { body: { data: {} } }]]);
    const onClose = vi.fn();
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => screen.getByTestId('propose-saved'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('błąd zapisu pokazuje book-modal-error, nie woła onCandidateSaved', async () => {
    mockFetchRoutes([
      [
        `/api/detections/${DETECTION_ID}/candidate`,
        { body: { error: { message: 'Nie znaleziono kandydata.' } }, status: 404 },
      ],
    ]);
    const onCandidateSaved = vi.fn();
    render(
      <BookModal
        mode="propose"
        book={CANDIDATE_BOOK}
        onCandidateSaved={onCandidateSaved}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => screen.getByTestId('book-modal-error'));
    expect(screen.getByTestId('book-modal-error').textContent).toContain(
      'Nie znaleziono kandydata.',
    );
    expect(onCandidateSaved).not.toHaveBeenCalled();
  });
});

describe('BookModal — tryb propose: Zatwierdź (POST /confirm) + dirty-check', () => {
  it('bez niezapisanych zmian — Akceptuj propozycję woła od razu POST /confirm (bez PATCH)', async () => {
    mockFetchRoutes([
      [
        `/api/detections/${DETECTION_ID}/confirm`,
        { body: { data: { book_id: 'b1', shelf_id: 's1' } } },
      ],
    ]);
    const onConfirmed = vi.fn();
    const onClose = vi.fn();
    render(
      <BookModal
        mode="propose"
        book={CANDIDATE_BOOK}
        onConfirmed={onConfirmed}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('book-modal-confirm'));

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();

    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const confirmCall = fetchSpy.mock.calls.find(
      ([url]) => url === `/api/detections/${DETECTION_ID}/confirm`,
    ) as [string, RequestInit];
    expect(confirmCall).toBeDefined();
    const body = JSON.parse((confirmCall[1] as { body: string }).body);
    expect(body.candidate_id).toBe(CANDIDATE_BOOK.id);

    // Bez dirty state — PATCH /candidate nie powinien zostać wywołany.
    const patchCall = fetchSpy.mock.calls.find(
      ([url]) => url === `/api/detections/${DETECTION_ID}/candidate`,
    );
    expect(patchCall).toBeUndefined();
    expect(screen.queryByTestId('propose-confirm-dialog')).toBeNull();
  });

  it('z niezapisanymi zmianami — Akceptuj propozycję pokazuje dialog niezapisanych zmian zamiast wołać /confirm', async () => {
    mockFetchRoutes([]);
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId('book-field-title'), {
      target: { value: 'Zmieniony tytuł' },
    });
    fireEvent.click(screen.getByTestId('book-modal-confirm'));

    await waitFor(() => screen.getByTestId('propose-confirm-dialog'));

    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(
      fetchSpy.mock.calls.some(([url]) => url === `/api/detections/${DETECTION_ID}/confirm`),
    ).toBe(false);
  });

  it('Anuluj w dialogu zamyka go bez żadnej akcji sieciowej', async () => {
    mockFetchRoutes([]);
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId('book-field-title'), {
      target: { value: 'Zmieniony tytuł' },
    });
    fireEvent.click(screen.getByTestId('book-modal-confirm'));
    await waitFor(() => screen.getByTestId('propose-confirm-dialog'));

    fireEvent.click(screen.getByTestId('propose-confirm-dialog-cancel'));

    await waitFor(() => expect(screen.queryByTestId('propose-confirm-dialog')).toBeNull());
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(
      fetchSpy.mock.calls.some(
        ([url]) =>
          url === `/api/detections/${DETECTION_ID}/candidate` ||
          url === `/api/detections/${DETECTION_ID}/confirm`,
      ),
    ).toBe(false);
  });

  it('potwierdzenie w dialogu zapisuje-i-zatwierdza sekwencyjnie (PATCH przed POST /confirm)', async () => {
    mockFetchRoutes([
      [`/api/detections/${DETECTION_ID}/candidate`, { body: { data: {} } }],
      [
        `/api/detections/${DETECTION_ID}/confirm`,
        { body: { data: { book_id: 'b1', shelf_id: 's1' } } },
      ],
    ]);
    const onConfirmed = vi.fn();
    const onClose = vi.fn();
    render(
      <BookModal
        mode="propose"
        book={CANDIDATE_BOOK}
        onConfirmed={onConfirmed}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByTestId('book-field-title'), {
      target: { value: 'Zmieniony tytuł' },
    });
    fireEvent.click(screen.getByTestId('book-modal-confirm'));
    await waitFor(() => screen.getByTestId('propose-confirm-dialog'));

    fireEvent.click(screen.getByTestId('propose-confirm-dialog-confirm'));

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();

    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const patchIndex = fetchSpy.mock.calls.findIndex(
      ([url]) => url === `/api/detections/${DETECTION_ID}/candidate`,
    );
    const confirmIndex = fetchSpy.mock.calls.findIndex(
      ([url]) => url === `/api/detections/${DETECTION_ID}/confirm`,
    );
    expect(patchIndex).toBeGreaterThanOrEqual(0);
    expect(confirmIndex).toBeGreaterThan(patchIndex);
  });

  it('błąd /confirm (409) pokazuje book-modal-error, nie woła onConfirmed', async () => {
    mockFetchRoutes([
      [
        `/api/detections/${DETECTION_ID}/confirm`,
        { body: { error: { message: 'Masz już tę książkę w katalogu.' } }, status: 409 },
      ],
    ]);
    const onConfirmed = vi.fn();
    render(
      <BookModal
        mode="propose"
        book={CANDIDATE_BOOK}
        onConfirmed={onConfirmed}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('book-modal-confirm'));

    await waitFor(() => screen.getByTestId('book-modal-error'));
    expect(screen.getByTestId('book-modal-error').textContent).toContain(
      'Masz już tę książkę w katalogu.',
    );
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// „Oryginalny odczyt OCR" w propose — port z dawnego formularza wyszukiwania po
// tytule (unify-detection-edit-entrypoint, Faza 2). Dostępny niezależnie od tego,
// czy kandydat jest świeżym draftem (no-match) czy prawdziwym matchem.

describe('BookModal — Oryginalny odczyt OCR w propose', () => {
  it('niewidoczny gdy tryb != propose lub brak detectionId', () => {
    render(<BookModal mode="edit" book={BASE_BOOK} onClose={vi.fn()} />);
    expect(screen.queryByTestId('book-modal-use-original')).toBeNull();
  });

  it('z historią korekt: wypełnia title/authors najwcześniejszym original_raw_* i czyści publisher/isbn', async () => {
    mockFetchRoutes([
      [
        `/api/detections/${DETECTION_ID}/history`,
        {
          body: {
            data: {
              corrections: [
                { original_raw_title: 'Solaris OCR', original_raw_author: 'S. Lem OCR' },
                { original_raw_title: 'Solaris (rematch)', original_raw_author: 'Lem' },
              ],
            },
          },
        },
      ],
    ]);
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);

    expect((screen.getByTestId('book-field-publisher') as HTMLInputElement).value).toBe(
      'Solaris Press',
    );
    expect((screen.getByTestId('book-field-isbn13') as HTMLInputElement).value).toBe(
      '9780156027601',
    );

    fireEvent.click(screen.getByTestId('book-modal-use-original'));

    await waitFor(() =>
      expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe(
        'Solaris OCR',
      ),
    );
    expect((screen.getByTestId('book-field-authors') as HTMLInputElement).value).toBe('S. Lem OCR');
    expect((screen.getByTestId('book-field-publisher') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('book-field-isbn13') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('book-field-isbn10') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('book-modal-no-history-hint')).toBeNull();
  });

  it('bez historii: fallback do rawTitle/rawAuthor detekcji, pokazuje hint', async () => {
    mockFetchRoutes([
      [`/api/detections/${DETECTION_ID}/history`, { body: { data: { corrections: [] } } }],
    ]);
    const book = { ...CANDIDATE_BOOK, rawTitle: 'Surowy tytuł OCR', rawAuthor: 'Surowy autor' };
    render(<BookModal mode="propose" book={book} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('book-modal-use-original'));

    await waitFor(() => screen.getByTestId('book-modal-no-history-hint'));
    expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe(
      'Surowy tytuł OCR',
    );
    expect((screen.getByTestId('book-field-authors') as HTMLInputElement).value).toBe(
      'Surowy autor',
    );
    expect((screen.getByTestId('book-field-publisher') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('book-field-isbn13') as HTMLInputElement).value).toBe('');
  });

  it('błąd sieci/API pokazuje book-modal-original-error', async () => {
    mockFetchRoutes([
      [
        `/api/detections/${DETECTION_ID}/history`,
        { body: { error: { message: 'Błąd pobierania historii.' } }, status: 500 },
      ],
    ]);
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('book-modal-use-original'));

    await waitFor(() => screen.getByTestId('book-modal-original-error'));
    expect(screen.getByTestId('book-modal-original-error').textContent).toContain(
      'Błąd pobierania historii.',
    );
  });

  it('drugie kliknięcie po zapamiętaniu original nie bije ponownie do /history', async () => {
    const fetchSpy = mockFetchRoutes([
      [
        `/api/detections/${DETECTION_ID}/history`,
        {
          body: { data: { corrections: [{ original_raw_title: 'X', original_raw_author: 'Y' }] } },
        },
      ],
    ]);
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('book-modal-use-original'));
    await waitFor(() =>
      expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe('X'),
    );
    const callsAfterFirst = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]) => String(url).includes('/history'),
    ).length;

    fireEvent.change(screen.getByTestId('book-field-title'), { target: { value: 'coś innego' } });
    fireEvent.click(screen.getByTestId('book-modal-use-original'));
    await waitFor(() =>
      expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe('X'),
    );
    const callsAfterSecond = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]) => String(url).includes('/history'),
    ).length;
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});
