import { useEffect, useState } from 'react';
import type { ShelfBookDTO } from '../lib/books/schema';
import BookCard from './BookCard';
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
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shelves/${shelfId}/books`);
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok || !json.data) {
          throw new Error(json.error?.message ?? `HTTP ${res.status}`);
        }
        setBooks(json.data.books);
      } catch (err) {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : 'Nie udało się załadować książek.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [shelfId]);

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
      <div
        data-testid="shelf-books-empty"
        className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center"
      >
        <p className="text-gray-500">Brak książek na tej półce.</p>
        <p className="mt-1 text-sm text-gray-400">
          Przetwórz zdjęcie półki i zaakceptuj propozycje, żeby tu zobaczyć książki.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="shelf-books-grid"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
    >
      {books.map((book) => (
        <BookCard key={book.id} book={book} onToggleRead={handleToggleRead} />
      ))}
    </div>
  );
}
