import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ManualAddBook from '../../../src/components/ManualAddBook';

const SHELF_ID = '00000000-0000-4000-8000-0000000000aa';

afterEach(() => vi.restoreAllMocks());

describe('ManualAddBook', () => {
  it('toggle pokazuje formularz', () => {
    render(<ManualAddBook shelfId={SHELF_ID} onAdded={vi.fn()} />);
    expect(screen.queryByTestId('manual-add-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('manual-add-toggle'));
    expect(screen.getByTestId('manual-add-form')).toBeInTheDocument();
  });

  it('submit → POST /api/books z shelf_id + danymi → onAdded', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { book_id: 'b1', shelf_id: SHELF_ID } }), { status: 201 })
    );
    const onAdded = vi.fn();
    render(<ManualAddBook shelfId={SHELF_ID} onAdded={onAdded} />);
    fireEvent.click(screen.getByTestId('manual-add-toggle'));
    fireEvent.change(screen.getByTestId('manual-title'), { target: { value: 'Allah 2.0' } });
    fireEvent.change(screen.getByTestId('manual-authors'), { target: { value: 'Mieszko Zagańczyk' } });
    fireEvent.click(screen.getByTestId('manual-add-submit'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => typeof url === 'string' && url.includes('/api/books'));
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
      expect(body.title).toBe('Allah 2.0');
      expect(body.authors).toEqual(['Mieszko Zagańczyk']);
      expect(body.shelf_id).toBe(SHELF_ID);
    });
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
  });

  it('409 duplikat → pokazuje błąd, NIE woła onAdded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Masz już tę książkę w katalogu.' } }), { status: 409 })
    );
    const onAdded = vi.fn();
    render(<ManualAddBook shelfId={SHELF_ID} onAdded={onAdded} />);
    fireEvent.click(screen.getByTestId('manual-add-toggle'));
    fireEvent.change(screen.getByTestId('manual-title'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByTestId('manual-add-submit'));

    await waitFor(() => expect(screen.getByTestId('manual-add-error')).toHaveTextContent('katalogu'));
    expect(onAdded).not.toHaveBeenCalled();
  });
});
