import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ShelvesIsland from '../../../src/components/ShelvesIsland';

afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.clearAllMocks());

describe('ShelvesIsland — empty state', () => {
  it('pokazuje instructional empty state z linkiem do /upload gdy brak półek', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { shelves: [] } }), { status: 200 }),
    );
    render(<ShelvesIsland />);
    const empty = await waitFor(() => screen.getByTestId('shelves-empty'));
    expect(empty).toBeInTheDocument();
    const link = empty.querySelector('a[href="/upload"]');
    expect(link).not.toBeNull();
  });

  it('pokazuje listę półek gdy są półki', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            shelves: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                name: 'Salon',
                location: null,
                position_index: 0,
                is_system: false,
                book_count: 0,
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    render(<ShelvesIsland />);
    await waitFor(() => screen.getByTestId('shelves-list'));
    expect(screen.queryByTestId('shelves-empty')).toBeNull();
  });
});
