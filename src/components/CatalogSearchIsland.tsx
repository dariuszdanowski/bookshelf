import { useEffect, useRef, useState } from 'react';
import type { CatalogBookDTO, BookCoverPatch } from '../lib/books/schema';
import type { ShelfDTO } from '../lib/shelves/schema';
import { SPINE_COLORS } from '../lib/vision/prompt';
import BookCard from './BookCard';
import Skeleton from './Skeleton';
import { ViewModeSwitcher, useViewMode } from './ViewModeSwitcher';

const BOOK_VIEW_MODE_KEY = 'bookshelf:book-view-mode';

type ReadFilter = 'all' | 'read' | 'unread';

type SearchResponse = {
  data?: { books: CatalogBookDTO[]; total: number };
  error?: { message?: string };
};

/**
 * S-08 — wyszukiwarka katalogu na /library. Pełnotekst (debounce) + filtry
 * kolor / półka (multi-select) / status, kombinowalne. Wyniki = BookCard z
 * nazwą półki + kolorem; toggle read optimistic. Brak wyników → „Nie masz tej
 * książki" (osobny stan od „zacznij szukać").
 */
export default function CatalogSearchIsland() {
  const [shelves, setShelves] = useState<ShelfDTO[]>([]);
  const [q, setQ] = useState('');
  const [color, setColor] = useState('');
  const [selectedShelfIds, setSelectedShelfIds] = useState<string[]>([]);
  const [read, setRead] = useState<ReadFilter>('all');

  const [books, setBooks] = useState<CatalogBookDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useViewMode(BOOK_VIEW_MODE_KEY);

  // Lista półek do filtra
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/shelves');
        if (!res.ok) return;
        const json = (await res.json()) as { data: { shelves: ShelfDTO[] } };
        setShelves(json.data.shelves);
      } catch {
        /* filtr półek po prostu pusty */
      }
    })();
  }, []);

  // Wyszukiwanie z debounce przy każdej zmianie kryteriów
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, color, selectedShelfIds, read]);

  async function runSearch() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (color) params.set('color', color);
      if (read !== 'all') params.set('read', read);
      for (const id of selectedShelfIds) params.append('shelf', id);

      const res = await fetch(`/api/books/search?${params.toString()}`);
      const json = (await res.json()) as SearchResponse;
      if (!res.ok || !json.data) {
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      setBooks(json.data.books);
      setSearched(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Błąd wyszukiwania.');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleRead(bookId: string, currentValue: boolean) {
    setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, is_read: !currentValue } : b)));
    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: !currentValue }),
      });
      if (!res.ok) {
        setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, is_read: currentValue } : b)));
      }
    } catch {
      setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, is_read: currentValue } : b)));
    }
  }

  function handleCoverUpdated(bookId: string, patch: BookCoverPatch) {
    setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, ...patch } : b)));
  }

  async function handleMove(bookId: string, targetShelfId: string) {
    const target = shelves.find((s) => s.id === targetShelfId);
    // Zapamiętaj poprzednie wartości do rollbacku.
    let prevShelf: { shelf_id: string; shelf_name: string } | null = null;
    setBooks((prev) =>
      prev.map((b) => {
        if (b.id !== bookId) return b;
        prevShelf = { shelf_id: b.shelf_id, shelf_name: b.shelf_name };
        return { ...b, shelf_id: targetShelfId, shelf_name: target?.name ?? b.shelf_name };
      })
    );
    const rollback = () => {
      if (!prevShelf) return;
      const restore = prevShelf;
      setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, ...restore } : b)));
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

  async function handleDelete(bookId: string) {
    let removed: { book: CatalogBookDTO; index: number } | null = null;
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
      const res = await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
      if (!res.ok) rollback();
    } catch {
      rollback();
    }
  }

  function toggleShelf(id: string) {
    setSelectedShelfIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  const hasCriteria = q.trim() !== '' || color !== '' || selectedShelfIds.length > 0 || read !== 'all';

  return (
    <div data-testid="catalog-search">
      {/* Pole szukania */}
      <input
        data-testid="search-input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Szukaj po tytule, autorze, wydawnictwie…"
        className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        aria-label="Szukaj w katalogu"
      />

      {/* Filtry */}
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* Kolor */}
        <label className="flex items-center gap-1 text-xs text-gray-600">
          Kolor:
          <select
            data-testid="filter-color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">dowolny</option>
            {SPINE_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {/* Status przeczytania */}
        <div data-testid="filter-read" className="flex items-center gap-1 text-xs text-gray-600" role="radiogroup" aria-label="Status przeczytania">
          {(['all', 'unread', 'read'] as const).map((r) => (
            <button
              key={r}
              data-testid={`read-${r}`}
              role="radio"
              aria-checked={read === r}
              onClick={() => setRead(r)}
              className={`rounded px-2 py-1 ${read === r ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {r === 'all' ? 'wszystko' : r === 'unread' ? 'nieprzeczytane' : 'przeczytane'}
            </button>
          ))}
        </div>
      </div>

      {/* Półki (multi-select) */}
      {shelves.length > 0 && (
        <div data-testid="filter-shelves" className="mt-2 flex flex-wrap gap-1.5">
          {shelves.map((s) => (
            <button
              key={s.id}
              data-testid={`shelf-chip-${s.id}`}
              aria-pressed={selectedShelfIds.includes(s.id)}
              onClick={() => toggleShelf(s.id)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${selectedShelfIds.includes(s.id) ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Wyniki */}
      <div className="mt-6">
        {loading ? (
          <div data-testid="search-loading" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-3">
                <Skeleton className="mb-2 h-28 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        ) : errorMsg ? (
          <div data-testid="search-error" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : searched && books.length === 0 ? (
          <div data-testid="search-empty" className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center">
            <p className="font-medium text-gray-600">Nie masz tej książki.</p>
            <p className="mt-1 text-sm text-gray-400">
              {hasCriteria ? 'Żadna książka w katalogu nie pasuje do kryteriów.' : 'Twój katalog jest pusty.'}
            </p>
          </div>
        ) : books.length > 0 ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500">{books.length} wynik(ów)</p>
              <ViewModeSwitcher mode={viewMode} onChange={setViewMode} />
            </div>
            <div
              data-testid="search-results"
              className={
                viewMode === 'list'
                  ? 'flex flex-col gap-2'
                  : 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
              }
            >
              {books.map((b) => (
                <BookCard
                  key={b.id}
                  book={b}
                  onToggleRead={handleToggleRead}
                  shelfName={b.shelf_name}
                  spineColor={b.spine_color}
                  shelves={shelves}
                  currentShelfId={b.shelf_id}
                  onMove={handleMove}
                  onCoverUpdated={handleCoverUpdated}
                  onBookSaved={() => void runSearch()}
                  onDelete={handleDelete}
                  viewMode={viewMode}
                />
              ))}
            </div>
          </>
        ) : (
          <p data-testid="search-hint" className="text-center text-sm text-gray-400">
            Zacznij wpisać lub wybierz filtr, żeby przeszukać katalog.
          </p>
        )}
      </div>
    </div>
  );
}
