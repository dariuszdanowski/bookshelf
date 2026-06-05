import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
