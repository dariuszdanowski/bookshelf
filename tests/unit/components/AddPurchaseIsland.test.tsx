import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddPurchaseIsland from '../../../src/components/AddPurchaseIsland';

const SHELF_ID = '00000000-0000-4000-8000-0000000000aa';
const BOOK_ID = '00000000-0000-4000-8000-0000000000bb';

const shelvesResponse = {
  data: {
    shelves: [
      { id: SHELF_ID, name: 'Zakupione', location: null, position_index: 0, is_system: true, book_count: 0, created_at: '2026-01-01T00:00:00Z' },
      { id: 'other', name: 'Salon', location: null, position_index: 0, is_system: false, book_count: 3, created_at: '2026-01-01T00:00:00Z' },
    ],
  },
};

const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '' },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
  vi.restoreAllMocks();
});

describe('AddPurchaseIsland', () => {
  it('renderuje toggle metody i domyślnie formularz ręczny', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(shelvesResponse), { status: 200 })
    );
    render(<AddPurchaseIsland />);
    expect(screen.getByTestId('method-manual')).toBeInTheDocument();
    expect(screen.getByTestId('method-photo')).toBeInTheDocument();
    expect(screen.getByTestId('manual-form')).toBeInTheDocument();
  });

  it('toggle na zdjęcie pokazuje link do upload z shelf=Zakupione', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(shelvesResponse), { status: 200 })
    );
    render(<AddPurchaseIsland />);
    // poczekaj aż fetch /api/shelves ustawi purchasedShelfId
    await waitFor(() => expect(screen.getByTestId('method-photo')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('method-photo'));
    const link = await screen.findByTestId('photo-upload-link');
    await waitFor(() => expect(link).toHaveAttribute('href', `/upload?shelf=${SHELF_ID}`));
  });

  it('manual submit woła POST /api/books z polami i redirektuje na półkę', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(shelvesResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { book_id: BOOK_ID, shelf_id: SHELF_ID } }), { status: 201 }));

    render(<AddPurchaseIsland />);
    fireEvent.change(screen.getByTestId('purchase-title'), { target: { value: 'Wiedźmin' } });
    fireEvent.change(screen.getByTestId('purchase-author'), { target: { value: 'Andrzej Sapkowski' } });
    fireEvent.click(screen.getByTestId('purchase-submit'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/books');
      expect(call).toBeDefined();
      const body = JSON.parse(call![1]!.body as string) as { title: string; authors: string[]; purchase_date: string };
      expect(body.title).toBe('Wiedźmin');
      expect(body.authors).toEqual(['Andrzej Sapkowski']);
      expect(body.purchase_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    await waitFor(() => expect(window.location.href).toBe(`/shelves/${SHELF_ID}`));
  });

  it('409 z POST /api/books pokazuje komunikat duplikatu', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(shelvesResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Masz już tę książkę w katalogu.' } }), { status: 409 }));

    render(<AddPurchaseIsland />);
    fireEvent.change(screen.getByTestId('purchase-title'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByTestId('purchase-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('purchase-error').textContent).toContain('Masz już tę książkę');
    });
  });

  it('submit zablokowany gdy title pusty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(shelvesResponse), { status: 200 })
    );
    render(<AddPurchaseIsland />);
    expect(screen.getByTestId('purchase-submit')).toBeDisabled();
  });

  it('„więcej" odsłania pola wydawnictwo/rok/isbn', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(shelvesResponse), { status: 200 })
    );
    render(<AddPurchaseIsland />);
    fireEvent.click(screen.getByTestId('show-more'));
    expect(screen.getByTestId('purchase-publisher')).toBeInTheDocument();
    expect(screen.getByTestId('purchase-year')).toBeInTheDocument();
    expect(screen.getByTestId('purchase-isbn')).toBeInTheDocument();
  });
});
