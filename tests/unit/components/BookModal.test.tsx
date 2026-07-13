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
// propose mode

describe('BookModal — tryb propose (read-only)', () => {
  it('renderuje pola jako read-only', () => {
    render(<BookModal mode="propose" book={BASE_BOOK} onClose={vi.fn()} />);
    const titleInput = screen.getByTestId('book-field-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Solaris');
    expect(titleInput.readOnly).toBe(true);
  });

  it('brak przycisku Zapisz', () => {
    render(<BookModal mode="propose" book={BASE_BOOK} onClose={vi.fn()} />);
    expect(screen.queryByTestId('book-modal-save')).toBeNull();
  });

  it('brak panelu wyszukiwania kandydatów', () => {
    render(<BookModal mode="propose" book={BASE_BOOK} onClose={vi.fn()} />);
    expect(screen.queryByTestId('search-candidates-toggle')).toBeNull();
  });

  it('pokazuje „Szukaj w sieci"', () => {
    render(<BookModal mode="propose" book={BASE_BOOK} onClose={vi.fn()} />);
    expect(screen.getByTestId('book-modal-web-search')).toBeTruthy();
  });

  it('Escape zamyka modal', async () => {
    const onClose = vi.fn();
    render(<BookModal mode="propose" book={BASE_BOOK} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// propose mode — edycja okładki kandydata (candidate-cover-override)

const DETECTION_ID = '00000000-0000-4000-8000-000000000070';
const CANDIDATE_ID_VALUE = '00000000-0000-4000-8000-000000000071';
const CANDIDATE_BOOK = {
  ...BASE_BOOK,
  id: CANDIDATE_ID_VALUE,
  detectionId: DETECTION_ID,
};

describe('BookModal — tryb propose: edycja okładki kandydata', () => {
  it('CoverEditor (3 sloty) jest widoczny — dziś brak w propose', () => {
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);
    expect(screen.getByTestId('propose-cover-section')).toBeTruthy();
    expect(screen.getByTestId('propose-cover-source-auto')).toBeTruthy();
    expect(screen.getByTestId('propose-cover-source-url')).toBeTruthy();
    expect(screen.getByTestId('propose-cover-source-photo')).toBeTruthy();
    expect(screen.getByTestId('propose-cover-url-input')).toBeTruthy();
  });

  it('klik „Zapisz okładkę" wysyła PATCH z candidate_id/cover_url i woła onCoverSaved', async () => {
    mockFetch({ data: { candidate_id: CANDIDATE_BOOK.id, cover_url: 'https://user.jpg' } });
    const onCoverSaved = vi.fn();
    render(
      <BookModal
        mode="propose"
        book={CANDIDATE_BOOK}
        onCoverSaved={onCoverSaved}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('propose-cover-url-input'), {
      target: { value: 'https://user.jpg' },
    });
    fireEvent.click(screen.getByTestId('propose-cover-save'));

    await waitFor(() =>
      expect(onCoverSaved).toHaveBeenCalledWith({ coverUrl: 'https://user.jpg' }),
    );

    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const patchCall = fetchSpy.mock.calls.find(
      ([url]) => url === `/api/detections/${DETECTION_ID}/cover`,
    ) as [string, RequestInit];
    expect(patchCall).toBeDefined();
    expect((patchCall[1] as { method: string }).method).toBe('PATCH');
    const body = JSON.parse((patchCall[1] as { body: string }).body);
    expect(body.candidate_id).toBe(CANDIDATE_BOOK.id);
    expect(body.cover_url).toBe('https://user.jpg');

    await waitFor(() => screen.getByTestId('propose-cover-saved'));
  });

  it('modal NIE zamyka się automatycznie po zapisie okładki', async () => {
    mockFetch({ data: { candidate_id: CANDIDATE_BOOK.id, cover_url: 'https://user.jpg' } });
    const onClose = vi.fn();
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={onClose} />);

    fireEvent.change(screen.getByTestId('propose-cover-url-input'), {
      target: { value: 'https://user.jpg' },
    });
    fireEvent.click(screen.getByTestId('propose-cover-save'));

    await waitFor(() => screen.getByTestId('propose-cover-saved'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('błąd zapisu pokazuje propose-cover-error, nie woła onCoverSaved', async () => {
    mockFetch({ error: { message: 'Nie znaleziono kandydata.' } }, 404);
    const onCoverSaved = vi.fn();
    render(
      <BookModal
        mode="propose"
        book={CANDIDATE_BOOK}
        onCoverSaved={onCoverSaved}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('propose-cover-save'));

    await waitFor(() => screen.getByTestId('propose-cover-error'));
    expect(screen.getByTestId('propose-cover-error').textContent).toContain(
      'Nie znaleziono kandydata.',
    );
    expect(onCoverSaved).not.toHaveBeenCalled();
  });

  it('przycisk „Zapisz okładkę" disabled gdy brak id/detectionId kandydata (defensywnie)', () => {
    render(<BookModal mode="propose" book={BASE_BOOK} onClose={vi.fn()} />);
    const btn = screen.getByTestId('propose-cover-save') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('wpisanie URL od razu przełącza slot na „Wklejony URL" (bez osobnego kliku)', () => {
    render(<BookModal mode="propose" book={CANDIDATE_BOOK} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('propose-cover-url-input'), {
      target: { value: 'https://user.jpg' },
    });
    expect(screen.getByTestId('propose-cover-source-url').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('wybranie pustego slotu „Wklejony URL" (kandydat ma auto-okładkę) zapisuje brak okładki — bez fallbacku na auto (zgłoszenie usera)', async () => {
    // CANDIDATE_BOOK dziedziczy z BASE_BOOK auto cover_url niepusty — dokładnie
    // scenariusz, w którym pickCover() cichcem wracał do auto mimo wybranego,
    // pustego slotu „url".
    mockFetch({ data: { candidate_id: CANDIDATE_BOOK.id, cover_url: null } });
    const onCoverSaved = vi.fn();
    render(
      <BookModal
        mode="propose"
        book={CANDIDATE_BOOK}
        onCoverSaved={onCoverSaved}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('propose-cover-source-url'));
    fireEvent.click(screen.getByTestId('propose-cover-save'));

    await waitFor(() => expect(onCoverSaved).toHaveBeenCalledWith({ coverUrl: null }));

    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const patchCall = fetchSpy.mock.calls.find(
      ([url]) => url === `/api/detections/${DETECTION_ID}/cover`,
    ) as [string, RequestInit];
    const body = JSON.parse((patchCall[1] as { body: string }).body);
    expect(body.cover_url).toBeNull();
  });
});
