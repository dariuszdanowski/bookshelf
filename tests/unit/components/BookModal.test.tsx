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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: { candidates: [] } }), { status: 200 })
  );
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

  it('walidacja: tytuł wymagany — submit nie wołuje fetch gdy pusty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POST /api/books przy zapisie', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { id: BOOK_ID } }), { status: 200 })
    );

    render(<BookModal mode="add" shelfId={SHELF_ID} onSaved={onSaved} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('book-field-title'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();

    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/books');
    expect((opts as { method: string }).method).toBe('POST');
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.shelf_id).toBe(SHELF_ID);
    expect(body.title).toBe('Test');
  });

  it('„Wyszukaj po danych" → prefill pól z kandydata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { candidates: [CANDIDATE] } }), { status: 200 })
    );

    render(<BookModal mode="add" shelfId={SHELF_ID} onClose={vi.fn()} />);

    // Otwórz panel
    fireEvent.click(screen.getByTestId('search-candidates-toggle'));
    fireEvent.change(screen.getByTestId('candidates-title'), { target: { value: 'Solaris' } });
    fireEvent.click(screen.getByTestId('candidates-search'));

    await waitFor(() => screen.getByTestId('candidates-use-0'));
    fireEvent.click(screen.getByTestId('candidates-use-0'));

    expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe(CANDIDATE.title);
    expect((screen.getByTestId('book-field-isbn13') as HTMLInputElement).value).toBe(CANDIDATE.isbn13);
  });

  it('błąd 409 wyświetla komunikat o duplikacie', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Masz już tę książkę.' } }), { status: 409 })
    );
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
    expect((screen.getByTestId('book-field-isbn13') as HTMLInputElement).value).toBe('9780156027601');
  });

  it('PATCH /api/books/:id przy zapisie', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { id: BOOK_ID } }), { status: 200 })
    );

    render(<BookModal mode="edit" book={BASE_BOOK} onSaved={onSaved} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('book-field-title'), { target: { value: 'Solaris Updated' } });
    fireEvent.click(screen.getByTestId('book-modal-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/books/${BOOK_ID}`);
    expect((opts as { method: string }).method).toBe('PATCH');
  });

  it('prefill z kandydata w edit mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { candidates: [CANDIDATE] } }), { status: 200 })
    );

    render(<BookModal mode="edit" book={BASE_BOOK} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('search-candidates-toggle'));
    fireEvent.change(screen.getByTestId('candidates-title'), { target: { value: 'Nowa' } });
    fireEvent.click(screen.getByTestId('candidates-search'));

    await waitFor(() => screen.getByTestId('candidates-use-0'));
    fireEvent.click(screen.getByTestId('candidates-use-0'));

    expect((screen.getByTestId('book-field-title') as HTMLInputElement).value).toBe(CANDIDATE.title);
  });

  it('pokazuje przycisk „Źródłowe zdjęcie" gdy photoId ustawione', () => {
    render(<BookModal mode="edit" book={{ ...BASE_BOOK, photoId: 'photo-uuid-123' }} onClose={vi.fn()} />);
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
