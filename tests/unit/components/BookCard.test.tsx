import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BookCard from '../../../src/components/BookCard';
import type { ShelfBookDTO } from '../../../src/lib/books/schema';

const BOOK_ID = '00000000-0000-4000-8000-000000000050';

const baseBook: ShelfBookDTO = {
  id: BOOK_ID,
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  cover_url: null,
  published_year: 1961,
  position_index: 1,
  is_read: false,
};

describe('BookCard', () => {
  it('renderuje tytuł i autora', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} />);
    expect(screen.getByText('Solaris')).toBeInTheDocument();
    expect(screen.getByText('Stanisław Lem')).toBeInTheDocument();
  });

  it('renderuje rok wydania', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} />);
    expect(screen.getByText('1961')).toBeInTheDocument();
  });

  it('placeholder gdy cover_url null — aria-label z tytułem i autorem', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} />);
    const placeholder = screen.getByRole('img', { name: /Solaris.*Lem/i });
    expect(placeholder).toBeInTheDocument();
  });

  it('renderuje okładkę gdy cover_url nie null', () => {
    const book = { ...baseBook, cover_url: 'https://example.com/cover.jpg' };
    render(<BookCard book={book} onToggleRead={vi.fn()} />);
    const img = screen.getByAltText(/Solaris/);
    expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
  });

  it('toggle button aria-pressed=false gdy nie przeczytana', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} />);
    const btn = screen.getByTestId(`toggle-read-${BOOK_ID}`);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn.textContent).toContain('Nie przeczytana');
  });

  it('toggle button aria-pressed=true gdy przeczytana', () => {
    const book = { ...baseBook, is_read: true };
    render(<BookCard book={book} onToggleRead={vi.fn()} />);
    const btn = screen.getByTestId(`toggle-read-${BOOK_ID}`);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn.textContent).toContain('Przeczytana');
  });

  it('klik toggle wywołuje onToggleRead z id i current value', () => {
    const onToggle = vi.fn();
    render(<BookCard book={baseBook} onToggleRead={onToggle} />);
    fireEvent.click(screen.getByTestId(`toggle-read-${BOOK_ID}`));
    expect(onToggle).toHaveBeenCalledWith(BOOK_ID, false);
  });

  it('brak autora — alt tylko tytuł', () => {
    const book = { ...baseBook, authors: [] };
    render(<BookCard book={book} onToggleRead={vi.fn()} />);
    const placeholder = screen.getByRole('img', { name: 'Solaris' });
    expect(placeholder).toBeInTheDocument();
  });
});
