import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CatalogSearchIsland from '../../../src/components/CatalogSearchIsland';

const SHELF_A = '00000000-0000-4000-8000-0000000000a1';
const BOOK_1 = '00000000-0000-4000-8000-0000000000b1';

const shelvesResponse = {
  data: { shelves: [{ id: SHELF_A, name: 'Salon', location: null, position_index: 0, is_system: false, book_count: 2, created_at: '2026-01-01T00:00:00Z' }] },
};

const searchResult = (books: unknown[]) => ({ data: { books, total: books.length } });

const book1 = {
  id: BOOK_1, title: 'Solaris', authors: ['Lem'], cover_url: null, published_year: 1961,
  position_index: 1, is_read: false, shelf_id: SHELF_A, shelf_name: 'Salon', spine_color: 'niebieski',
};

/** Routuje fetch po URL: /api/shelves vs /api/books/search vs PATCH /api/books/:id */
function routeFetch(searchBody: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const u = typeof input === 'string' ? input : input.toString();
    if (u.includes('/api/books/search')) return Promise.resolve(new Response(JSON.stringify(searchBody), { status: 200 }));
    if (u.includes('/api/shelves')) return Promise.resolve(new Response(JSON.stringify(shelvesResponse), { status: 200 }));
    if (u.includes('/api/books/')) return Promise.resolve(new Response(JSON.stringify({ data: { id: BOOK_1, is_read: true } }), { status: 200 }));
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('CatalogSearchIsland', () => {
  it('renderuje pole szukania i filtry (kolor/status/półki)', async () => {
    routeFetch(searchResult([]));
    render(<CatalogSearchIsland />);
    expect(screen.getByTestId('search-input')).toBeInTheDocument();
    expect(screen.getByTestId('filter-color')).toBeInTheDocument();
    expect(screen.getByTestId('filter-read')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(`shelf-chip-${SHELF_A}`)).toBeInTheDocument());
  });

  it('wpisanie frazy → fetch /api/books/search z param q i render wyników z nazwą półki', async () => {
    const fetchMock = routeFetch(searchResult([book1]));
    render(<CatalogSearchIsland />);
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'solaris' } });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => typeof u === 'string' && u.includes('/api/books/search') && u.includes('q=solaris'));
      expect(call).toBeDefined();
    });
    await waitFor(() => expect(screen.getByTestId('search-results')).toBeInTheDocument());
    expect(screen.getByTestId(`book-card-${BOOK_1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`shelf-badge-${BOOK_1}`).textContent).toBe('Salon');
  });

  it('zmiana filtra koloru → fetch z param color', async () => {
    const fetchMock = routeFetch(searchResult([book1]));
    render(<CatalogSearchIsland />);
    fireEvent.change(screen.getByTestId('filter-color'), { target: { value: 'czerwony' } });
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => typeof u === 'string' && u.includes('color=czerwony'));
      expect(call).toBeDefined();
    });
  });

  it('brak wyników → „Nie masz tej książki"', async () => {
    routeFetch(searchResult([]));
    render(<CatalogSearchIsland />);
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'czegoś-nie-ma' } });
    await waitFor(() => expect(screen.getByTestId('search-empty')).toBeInTheDocument());
    expect(screen.getByTestId('search-empty').textContent).toContain('Nie masz tej książki');
  });

  it('toggle read na wyniku → PATCH /api/books/:id (optimistic)', async () => {
    const fetchMock = routeFetch(searchResult([book1]));
    render(<CatalogSearchIsland />);
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'solaris' } });
    const toggle = await waitFor(() => screen.getByTestId(`toggle-read-${BOOK_1}`));
    fireEvent.click(toggle);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, opt]) => typeof u === 'string' && u.includes(`/api/books/${BOOK_1}`) && (opt as RequestInit)?.method === 'PATCH');
      expect(call).toBeDefined();
    });
  });
});
