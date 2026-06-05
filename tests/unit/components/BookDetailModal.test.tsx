import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BookDetailModal, { type BookDetailData } from '../../../src/components/BookDetailModal';

const fullBook: BookDetailData = {
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
  isbn13: '9788373191723',
  isbn10: null,
  publisher: 'Wydawnictwo Literackie',
  publishedYear: 1961,
  source: 'google_books',
  matchScore: 0.92,
};

describe('BookDetailModal', () => {
  it('renderuje tytuł, autora i metadane', () => {
    render(<BookDetailModal book={fullBook} onClose={vi.fn()} />);
    expect(screen.getByTestId('book-detail-modal')).toBeInTheDocument();
    expect(screen.getByText('Solaris')).toBeInTheDocument();
    expect(screen.getByText('Stanisław Lem')).toBeInTheDocument();
    expect(screen.getByText('9788373191723')).toBeInTheDocument();
    expect(screen.getByText('1961')).toBeInTheDocument();
    expect(screen.getByText('Wydawnictwo Literackie')).toBeInTheDocument();
    expect(screen.getByText('Google Books')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
  });

  it('okładka używa dużego wariantu (-L.jpg)', () => {
    render(<BookDetailModal book={fullBook} onClose={vi.fn()} />);
    const img = screen.getByTestId('book-detail-cover') as HTMLImageElement;
    expect(img.src).toContain('-L.jpg');
  });

  it('placeholder gdy brak okładki', () => {
    render(<BookDetailModal book={{ ...fullBook, coverUrl: null }} onClose={vi.fn()} />);
    expect(screen.getByTestId('book-detail-cover-placeholder')).toBeInTheDocument();
  });

  it('komunikat gdy brak metadanych', () => {
    render(
      <BookDetailModal
        book={{ title: 'Coś', authors: [], coverUrl: null }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/Brak dodatkowych metadanych/)).toBeInTheDocument();
  });

  it('klik X woła onClose', () => {
    const onClose = vi.fn();
    render(<BookDetailModal book={fullBook} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('book-detail-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape woła onClose', () => {
    const onClose = vi.fn();
    render(<BookDetailModal book={fullBook} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('BookDetailModal — edycja okładki (S-33)', () => {
  afterEach(() => vi.restoreAllMocks());

  const slots = {
    cover_url: 'https://auto.jpg',
    user_cover_url: null,
    cover_photo_url: null,
    cover_source: 'auto' as const,
    isbn: '9788373191723',
  };

  it('panel edycji NIEwidoczny bez editableBookId (propozycja read-only)', () => {
    render(<BookDetailModal book={fullBook} onClose={vi.fn()} />);
    expect(screen.queryByTestId('cover-edit-toggle')).not.toBeInTheDocument();
  });

  it('z editableBookId: wklej URL + flaga „URL" + Zapisz → PATCH user_cover_url', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 })
    );
    const onCoverUpdated = vi.fn();
    render(
      <BookDetailModal
        book={fullBook}
        onClose={vi.fn()}
        editableBookId="b1"
        coverSlots={slots}
        onCoverUpdated={onCoverUpdated}
      />
    );
    fireEvent.click(screen.getByTestId('cover-edit-toggle'));
    fireEvent.change(screen.getByTestId('cover-url-input'), { target: { value: 'https://my-cover.jpg' } });
    fireEvent.click(screen.getByTestId('cover-source-url'));
    fireEvent.click(screen.getByTestId('cover-save'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, opt]) => typeof url === 'string' && url.includes('/api/books/b1') && (opt as RequestInit)?.method === 'PATCH'
      );
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
      expect(body.user_cover_url).toBe('https://my-cover.jpg');
      expect(body.cover_source).toBe('url');
    });
    await waitFor(() => expect(onCoverUpdated).toHaveBeenCalled());
  });

  it('„Sprawdź automatycznie" disabled gdy brak ISBN', () => {
    render(
      <BookDetailModal
        book={fullBook}
        onClose={vi.fn()}
        editableBookId="b1"
        coverSlots={{ ...slots, isbn: null }}
        onCoverUpdated={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('cover-edit-toggle'));
    expect(screen.getByTestId('cover-autocheck')).toBeDisabled();
  });
});

describe('BookDetailModal — akcje (szukaj w sieci / zdjęcie półki / identyfikacja)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('„Szukaj w sieci" — link Google z tytułem+autorem (zawsze, też propozycja)', () => {
    render(<BookDetailModal book={fullBook} onClose={vi.fn()} />);
    const link = screen.getByTestId('modal-web-search');
    expect(link).toHaveAttribute('target', '_blank');
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('google.com/search');
    expect(decodeURIComponent(href)).toContain('Solaris');
    expect(decodeURIComponent(href)).toContain('Stanisław Lem');
  });

  it('„Źródłowe zdjęcie" tylko gdy podano sourcePhotoId', () => {
    const { rerender } = render(<BookDetailModal book={fullBook} onClose={vi.fn()} />);
    expect(screen.queryByTestId('modal-source-photo')).not.toBeInTheDocument();
    rerender(<BookDetailModal book={fullBook} onClose={vi.fn()} sourcePhotoId="photo-9" />);
    expect(screen.getByTestId('modal-source-photo')).toHaveAttribute('href', '/photos/photo-9');
  });

  it('„Szukaj po tytule" tylko z editableBookId; szukaj → wyniki → Użyj woła apply', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { candidates: [{ source: 'national_library', externalId: 'bn-1', title: 'Przytulajka', authors: ['Krawczyk, Agnieszka'], isbn13: '9788379768578', isbn10: null, publisher: 'Czwarta Strona', publishedYear: 2018, coverUrl: null, matchScore: 0.9 }] } }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { applied: true } }), { status: 200 }));

    render(<BookDetailModal book={fullBook} onClose={vi.fn()} editableBookId="b1" />);
    expect(screen.getByTestId('identify-toggle')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('identify-toggle'));
    fireEvent.click(screen.getByTestId('identify-search'));

    const useBtn = await waitFor(() => screen.getByTestId('identify-apply-0'));
    fireEvent.click(useBtn);

    await waitFor(() => {
      const applyCall = fetchMock.mock.calls.find(
        ([url, opt]) => typeof url === 'string' && url.includes('/api/books/b1/identify') &&
          JSON.parse((opt as RequestInit).body as string).mode === 'apply'
      );
      expect(applyCall).toBeDefined();
    });
  });

  it('panel identyfikacji NIEwidoczny bez editableBookId', () => {
    render(<BookDetailModal book={fullBook} onClose={vi.fn()} />);
    expect(screen.queryByTestId('identify-toggle')).not.toBeInTheDocument();
  });
});
