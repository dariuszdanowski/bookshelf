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
  photo_id: null,
  detection_id: null,
  isbn_13: '9788373191723',
  isbn_10: null,
  publisher: 'Wydawnictwo Literackie',
  user_cover_url: null,
  cover_photo_url: null,
  cover_source: 'auto',
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

  it('zepsuta okładka (onError) → fallback do placeholdera, nie pokazuje połamanego <img>', () => {
    const book = { ...baseBook, cover_url: 'https://broken.example/x.jpg' };
    const { container } = render(<BookCard book={book} onToggleRead={vi.fn()} />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: /Solaris/ })).toBeInTheDocument(); // placeholder
  });

  it('cover_source=url → pokazuje user_cover_url (override)', () => {
    const book = {
      ...baseBook,
      cover_url: 'https://auto.jpg',
      user_cover_url: 'https://user.jpg',
      cover_source: 'url' as const,
    };
    render(<BookCard book={book} onToggleRead={vi.fn()} />);
    expect(screen.getByAltText(/Solaris/)).toHaveAttribute('src', 'https://user.jpg');
  });

  it('cover_source=photo → pokazuje cover_photo_url', () => {
    const book = {
      ...baseBook,
      cover_url: 'https://auto.jpg',
      cover_photo_url: 'https://photo.jpg',
      cover_source: 'photo' as const,
    };
    render(<BookCard book={book} onToggleRead={vi.fn()} />);
    expect(screen.getByAltText(/Solaris/)).toHaveAttribute('src', 'https://photo.jpg');
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

  it('klik w okładkę otwiera podgląd szczegółów (ISBN, wydawca)', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} />);
    expect(screen.queryByTestId('book-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`book-cover-button-${BOOK_ID}`));
    expect(screen.getByTestId('book-modal')).toBeInTheDocument();
    expect(screen.getByDisplayValue('9788373191723')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Wydawnictwo Literackie')).toBeInTheDocument();
  });

  it('brak autora — alt tylko tytuł', () => {
    const book = { ...baseBook, authors: [] };
    render(<BookCard book={book} onToggleRead={vi.fn()} />);
    const placeholder = screen.getByRole('img', { name: 'Solaris' });
    expect(placeholder).toBeInTheDocument();
  });

  // S-15: link „Źródłowe zdjęcie" → /photos/[photo_id]
  it('renderuje link „Źródłowe zdjęcie" gdy photo_id jest present', () => {
    const book = { ...baseBook, photo_id: '11111111-0000-4000-8000-000000000099' };
    render(<BookCard book={book} onToggleRead={vi.fn()} />);
    const link = screen.getByTestId(`source-photo-link-${BOOK_ID}`);
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/photos/11111111-0000-4000-8000-000000000099');
    expect(link.textContent).toContain('Źródłowe zdjęcie');
  });

  it('NIE renderuje linku „Źródłowe zdjęcie" gdy photo_id jest null', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} />);
    expect(screen.queryByTestId(`source-photo-link-${BOOK_ID}`)).not.toBeInTheDocument();
  });

  // S-37: deep-link z fokusem na detekcji źródłowej
  it('link zawiera ?detection= gdy detection_id present', () => {
    const book = {
      ...baseBook,
      photo_id: '11111111-0000-4000-8000-000000000099',
      detection_id: '22222222-0000-4000-8000-000000000077',
    };
    render(<BookCard book={book} onToggleRead={vi.fn()} />);
    expect(screen.getByTestId(`source-photo-link-${BOOK_ID}`)).toHaveAttribute(
      'href',
      '/photos/11111111-0000-4000-8000-000000000099?detection=22222222-0000-4000-8000-000000000077',
    );
  });

  // S-08: opcjonalne propsy shelfName/spineColor (wyniki wyszukiwarki)
  it('NIE renderuje badge półki ani swatcha gdy propsy nie podane (regress ShelfBooksIsland)', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} />);
    expect(screen.queryByTestId(`shelf-badge-${BOOK_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`spine-swatch-${BOOK_ID}`)).not.toBeInTheDocument();
  });

  it('renderuje badge nazwy półki gdy shelfName podany', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} shelfName="Salon" />);
    expect(screen.getByTestId(`shelf-badge-${BOOK_ID}`).textContent).toBe('Salon');
  });

  it('renderuje swatch koloru gdy spineColor podany (z aria-label)', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} spineColor="czerwony" />);
    const swatch = screen.getByTestId(`spine-swatch-${BOOK_ID}`);
    expect(swatch).toBeInTheDocument();
    expect(swatch).toHaveAttribute('aria-label', 'Kolor grzbietu: czerwony');
  });

  // book-delete: przycisk „Usuń" + ConfirmDialog
  it('NIE renderuje przycisku „Usuń" gdy onDelete nie podany', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} />);
    expect(screen.queryByTestId(`delete-book-${BOOK_ID}`)).not.toBeInTheDocument();
  });

  it('renderuje „Usuń" gdy onDelete podany; klik otwiera dialog potwierdzenia', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByTestId(`delete-book-dialog-${BOOK_ID}`)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`delete-book-${BOOK_ID}`));
    expect(screen.getByTestId(`delete-book-dialog-${BOOK_ID}`)).toBeInTheDocument();
  });

  it('potwierdzenie wywołuje onDelete z id i zamyka dialog', () => {
    const onDelete = vi.fn();
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId(`delete-book-${BOOK_ID}`));
    fireEvent.click(screen.getByTestId(`delete-book-dialog-${BOOK_ID}-confirm`));
    expect(onDelete).toHaveBeenCalledWith(BOOK_ID);
    expect(screen.queryByTestId(`delete-book-dialog-${BOOK_ID}`)).not.toBeInTheDocument();
  });

  it('anulowanie NIE wywołuje onDelete i zamyka dialog', () => {
    const onDelete = vi.fn();
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId(`delete-book-${BOOK_ID}`));
    fireEvent.click(screen.getByTestId(`delete-book-dialog-${BOOK_ID}-cancel`));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId(`delete-book-dialog-${BOOK_ID}`)).not.toBeInTheDocument();
  });

  // S-34: tryby widoku — pełny CRUD w każdym układzie
  const shelves = [
    { id: 'sh-1', name: 'Salon', location: null, position_index: 0, book_count: 0 },
    { id: 'sh-2', name: 'Sypialnia', location: null, position_index: 1, book_count: 0 },
  ] as never;

  it('tryb list: renderuje book-row + komplet akcji (read/move/delete/edit-cover)', () => {
    render(
      <BookCard
        book={baseBook}
        onToggleRead={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        viewMode="list"
        currentShelfId="sh-1"
        shelves={shelves}
      />,
    );
    expect(screen.getByTestId(`book-card-${BOOK_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`book-row-${BOOK_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`toggle-read-${BOOK_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`move-book-${BOOK_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`delete-book-${BOOK_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`book-cover-button-${BOOK_ID}`)).toBeInTheDocument();
  });

  it('tryb list: delete → dialog → confirm wywołuje onDelete', () => {
    const onDelete = vi.fn();
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} onDelete={onDelete} viewMode="list" />);
    fireEvent.click(screen.getByTestId(`delete-book-${BOOK_ID}`));
    fireEvent.click(screen.getByTestId(`delete-book-dialog-${BOOK_ID}-confirm`));
    expect(onDelete).toHaveBeenCalledWith(BOOK_ID);
  });

  it('tryb list: klik okładki otwiera modal edycji', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} viewMode="list" />);
    expect(screen.queryByTestId('book-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`book-cover-button-${BOOK_ID}`));
    expect(screen.getByTestId('book-modal')).toBeInTheDocument();
  });

  it('tryb tiles: renderuje book-tile + read/delete + edit-cover', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} onDelete={vi.fn()} viewMode="tiles" />);
    expect(screen.getByTestId(`book-card-${BOOK_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`book-tile-${BOOK_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`toggle-read-${BOOK_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`delete-book-${BOOK_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`book-cover-button-${BOOK_ID}`)).toBeInTheDocument();
  });

  it('tryb tiles: toggle read wywołuje onToggleRead', () => {
    const onToggle = vi.fn();
    render(<BookCard book={baseBook} onToggleRead={onToggle} viewMode="tiles" />);
    fireEvent.click(screen.getByTestId(`toggle-read-${BOOK_ID}`));
    expect(onToggle).toHaveBeenCalledWith(BOOK_ID, false);
  });

  it('domyślny tryb (bez viewMode) = cards: brak book-row i book-tile', () => {
    render(<BookCard book={baseBook} onToggleRead={vi.fn()} />);
    expect(screen.queryByTestId(`book-row-${BOOK_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`book-tile-${BOOK_ID}`)).not.toBeInTheDocument();
  });
});
