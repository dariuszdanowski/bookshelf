import { useCallback, useEffect, useState } from 'react';
import type { ShelfBookDTO, BookCoverPatch } from '../lib/books/schema';
import type { ShelfDTO } from '../lib/shelves/schema';
import BookCard from './BookCard';
import ManualAddBook from './ManualAddBook';
import Skeleton from './Skeleton';

type Props = { shelfId: string };

type ApiResponse = {
  data?: { books: ShelfBookDTO[] };
  error?: { message?: string };
};

/**
 * React island — ładuje książki półki i obsługuje toggle is_read.
 * Optimistic UI: stan lokalny aktualizowany natychmiast, rollback przy błędzie.
 */
export default function ShelfBooksIsland({ shelfId }: Props) {
  const [books, setBooks] = useState<ShelfBookDTO[]>([]);
  const [shelves, setShelves] = useState<ShelfDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadBooks = useCallback(async () => {
    try {
      const res = await fetch(`/api/shelves/${shelfId}/books`);
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.data) {
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      setBooks(json.data.books);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Nie udało się załadować książek.');
    } finally {
      setLoading(false);
    }
  }, [shelfId]);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  // Lista półek do pickera „Przenieś na półkę…"
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/shelves');
        if (!res.ok) return;
        const json = (await res.json()) as { data: { shelves: ShelfDTO[] } };
        if (!cancelled) setShelves(json.data.shelves);
      } catch {
        /* picker po prostu się nie pokaże */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleToggleRead(bookId: string, currentValue: boolean) {
    // Optimistic update
    setBooks((prev) =>
      prev.map((b) => (b.id === bookId ? { ...b, is_read: !currentValue } : b))
    );
    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: !currentValue }),
      });
      if (!res.ok) {
        // Rollback przy błędzie
        setBooks((prev) =>
          prev.map((b) => (b.id === bookId ? { ...b, is_read: currentValue } : b))
        );
      }
    } catch {
      // Rollback przy błędzie sieci
      setBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, is_read: currentValue } : b))
      );
    }
  }

  function handleCoverUpdated(bookId: string, patch: BookCoverPatch) {
    setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, ...patch } : b)));
  }

  async function handleMove(bookId: string, targetShelfId: string) {
    // Optimistic: książka znika z bieżącej półki. Zapamiętaj do rollbacku.
    let removed: { book: ShelfBookDTO; index: number } | null = null;
    setBooks((prev) => {
      const index = prev.findIndex((b) => b.id === bookId);
      if (index >= 0) removed = { book: prev[index], index };
      return prev.filter((b) => b.id !== bookId);
    });
    const rollback = () => {
      if (!removed) return;
      const { book, index } = removed;
      setBooks((prev) => {
        const next = [...prev];
        next.splice(Math.min(index, next.length), 0, book);
        return next;
      });
    };
    try {
      const res = await fetch(`/api/books/${bookId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shelf_id: targetShelfId }),
      });
      if (!res.ok) rollback();
    } catch {
      rollback();
    }
  }

  if (loading) {
    return (
      <div data-testid="shelf-books-loading" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-gray-200 p-3">
            <Skeleton className="mb-2 h-28 w-full" />
            <Skeleton className="mb-1 h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div
        data-testid="shelf-books-error"
        className="rounded-md border border-red-300 bg-red-50 px-4 py-3"
      >
        <p className="text-sm text-red-700">{errorMsg}</p>
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div className="space-y-4">
        <div
          data-testid="shelf-books-empty"
          className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center"
        >
          <p className="text-gray-500">Brak książek na tej półce.</p>
          <p className="mt-1 text-sm text-gray-400">
            Dodaj książkę ręcznie poniżej albo przetwórz zdjęcie półki i zaakceptuj propozycje.
          </p>
        </div>
        <ManualAddBook shelfId={shelfId} onAdded={() => void loadBooks()} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ManualAddBook shelfId={shelfId} onAdded={() => void loadBooks()} />
      <div
        data-testid="shelf-books-grid"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      >
        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            onToggleRead={handleToggleRead}
            shelves={shelves}
            currentShelfId={shelfId}
            onMove={handleMove}
            onCoverUpdated={handleCoverUpdated}
          />
        ))}
      </div>
    </div>
  );
}
