import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShelfBooksIsland from '../../../src/components/ShelfBooksIsland';

const SHELF_ID = '00000000-0000-4000-8000-000000000040';
const BOOK_ID_1 = '00000000-0000-4000-8000-000000000050';
const BOOK_ID_2 = '00000000-0000-4000-8000-000000000051';

const book1 = {
  id: BOOK_ID_1, title: 'Solaris', authors: ['Stanisław Lem'],
  cover_url: null, published_year: 1961, position_index: 1, is_read: false,
};
const book2 = {
  id: BOOK_ID_2, title: 'Diuna', authors: ['Frank Herbert'],
  cover_url: null, published_year: 1965, position_index: 2, is_read: true,
};

afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.clearAllMocks());

describe('ShelfBooksIsland', () => {
  it('pokazuje skeleton podczas ładowania', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    render(<ShelfBooksIsland shelfId={SHELF_ID} />);
    expect(screen.getByTestId('shelf-books-loading')).toBeInTheDocument();
  });

  it('renderuje grid z książkami po załadowaniu', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { books: [book1, book2] } }), { status: 200 })
    );
    render(<ShelfBooksIsland shelfId={SHELF_ID} />);
    await waitFor(() => screen.getByTestId('shelf-books-grid'));
    expect(screen.getByTestId(`book-card-${BOOK_ID_1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`book-card-${BOOK_ID_2}`)).toBeInTheDocument();
  });

  it('pokazuje empty-state gdy brak książek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { books: [] } }), { status: 200 })
    );
    render(<ShelfBooksIsland shelfId={SHELF_ID} />);
    await waitFor(() => screen.getByTestId('shelf-books-empty'));
  });

  it('pokazuje błąd przy network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'));
    render(<ShelfBooksIsland shelfId={SHELF_ID} />);
    await waitFor(() => screen.getByTestId('shelf-books-error'));
  });

  it('toggle PATCH: optimistic update — stan zmienia się natychmiast, PATCH wysyłany', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { books: [book1] } }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: BOOK_ID_1, is_read: true } }), { status: 200 })
      );

    render(<ShelfBooksIsland shelfId={SHELF_ID} />);
    const toggleBtn = await waitFor(() => screen.getByTestId(`toggle-read-${BOOK_ID_1}`));
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggleBtn);
    // Optimistic: natychmiast zmienia się aria-pressed
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes(`/api/books/${BOOK_ID_1}`)
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall![1]!.body as string) as { is_read: boolean };
      expect(body.is_read).toBe(true);
    });
  });

  it('toggle rollback: stan cofa się gdy PATCH zwraca błąd', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { books: [book1] } }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 })
      );

    render(<ShelfBooksIsland shelfId={SHELF_ID} />);
    const toggleBtn = await waitFor(() => screen.getByTestId(`toggle-read-${BOOK_ID_1}`));
    fireEvent.click(toggleBtn);

    // Po rollback wraca do false
    await waitFor(() => {
      expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
