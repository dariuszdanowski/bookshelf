import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import ShelfTabs, { SHELF_TAB_STORAGE_KEY } from '../../../src/components/ShelfTabs';

const SHELF_ID = '00000000-0000-4000-8000-000000000040';

// Stub child islands — izolujemy logikę zakładek od ich fetchy.
vi.mock('../../../src/components/ShelfBooksIsland', () => ({
  default: () => <div data-testid="books-stub">books</div>,
}));
vi.mock('../../../src/components/PhotoListIsland', () => ({
  default: () => <div data-testid="photos-stub">photos</div>,
}));

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('ShelfTabs', () => {
  it('domyślnie pokazuje zakładkę Książki (panel zdjęć ukryty)', () => {
    render(<ShelfTabs shelfId={SHELF_ID} shelfName="Salon" />);
    expect(screen.getByTestId('shelf-tab-books')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('shelf-tab-panel-books')).not.toHaveClass('hidden');
    expect(screen.getByTestId('shelf-tab-panel-photos')).toHaveClass('hidden');
  });

  it('oba panele są zamontowane (mount-both)', () => {
    render(<ShelfTabs shelfId={SHELF_ID} shelfName="Salon" />);
    expect(screen.getByTestId('books-stub')).toBeInTheDocument();
    expect(screen.getByTestId('photos-stub')).toBeInTheDocument();
  });

  it('klik „Zdjęcia" pokazuje panel zdjęć i ukrywa książki', () => {
    render(<ShelfTabs shelfId={SHELF_ID} shelfName="Salon" />);
    fireEvent.click(screen.getByTestId('shelf-tab-photos'));
    expect(screen.getByTestId('shelf-tab-photos')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('shelf-tab-panel-photos')).not.toHaveClass('hidden');
    expect(screen.getByTestId('shelf-tab-panel-books')).toHaveClass('hidden');
  });

  it('zapisuje wybór do localStorage', () => {
    render(<ShelfTabs shelfId={SHELF_ID} shelfName="Salon" />);
    fireEvent.click(screen.getByTestId('shelf-tab-photos'));
    expect(window.localStorage.getItem(SHELF_TAB_STORAGE_KEY)).toBe('photos');
  });

  it('czyta zapisany wybór po montażu', async () => {
    window.localStorage.setItem(SHELF_TAB_STORAGE_KEY, 'photos');
    render(<ShelfTabs shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId('shelf-tab-photos')).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getByTestId('shelf-tab-panel-photos')).not.toHaveClass('hidden');
  });

  it('śmieciowa wartość w localStorage → fallback do Książki', async () => {
    window.localStorage.setItem(SHELF_TAB_STORAGE_KEY, 'garbage');
    render(<ShelfTabs shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId('shelf-tab-books')).toHaveAttribute('aria-selected', 'true'),
    );
  });

  // S-36: deep-link `?tab=` (lądowanie po skip-upload)
  describe('param ?tab= (S-36)', () => {
    const originalLocation = window.location;
    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    });

    function setSearch(search: string) {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: { ...originalLocation, search },
      });
    }

    it('?tab=photos wygrywa nad localStorage i jest persystowany', async () => {
      window.localStorage.setItem(SHELF_TAB_STORAGE_KEY, 'books');
      setSearch('?tab=photos');
      render(<ShelfTabs shelfId={SHELF_ID} shelfName="Salon" />);
      await waitFor(() =>
        expect(screen.getByTestId('shelf-tab-photos')).toHaveAttribute('aria-selected', 'true'),
      );
      expect(window.localStorage.getItem(SHELF_TAB_STORAGE_KEY)).toBe('photos');
    });

    it('śmieciowy ?tab= → fallback do zapisanej preferencji', async () => {
      window.localStorage.setItem(SHELF_TAB_STORAGE_KEY, 'photos');
      setSearch('?tab=garbage');
      render(<ShelfTabs shelfId={SHELF_ID} shelfName="Salon" />);
      await waitFor(() =>
        expect(screen.getByTestId('shelf-tab-photos')).toHaveAttribute('aria-selected', 'true'),
      );
    });
  });
});
