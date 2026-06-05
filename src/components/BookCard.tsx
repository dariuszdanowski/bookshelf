import { useState } from 'react';
import type { ShelfBookDTO, BookCoverPatch } from '../lib/books/schema';
import type { ShelfDTO } from '../lib/shelves/schema';
import { effectiveCover } from '../lib/books/cover';
import BookDetailModal from './BookDetailModal';

/** Mapa nazwanych kolorów grzbietu (SPINE_COLORS) → swatch CSS dla wyników wyszukiwarki. */
const SPINE_COLOR_CSS: Record<string, string> = {
  czerwony: '#dc2626',
  pomarańczowy: '#ea580c',
  żółty: '#eab308',
  zielony: '#16a34a',
  niebieski: '#2563eb',
  granatowy: '#1e3a8a',
  fioletowy: '#7c3aed',
  różowy: '#ec4899',
  brązowy: '#92400e',
  czarny: '#000000',
  biały: '#f5f5f5',
  szary: '#6b7280',
};

type BookCardProps = {
  book: ShelfBookDTO;
  onToggleRead: (id: string, currentValue: boolean) => void;
  /** S-08: nazwa półki w wynikach wyszukiwarki (opcjonalne; ShelfBooksIsland nie podaje). */
  shelfName?: string;
  /** S-08: kolor grzbietu (swatch) w wynikach. */
  spineColor?: string | null;
  /** S-07: lista półek do pickera „Przenieś na półkę…". Gdy brak — picker się nie renderuje. */
  shelves?: ShelfDTO[];
  /** S-07: id bieżącej półki książki — wykluczane z opcji pickera. */
  currentShelfId?: string;
  /** S-07: handler przeniesienia (optimistic po stronie rodzica). */
  onMove?: (bookId: string, targetShelfId: string) => void;
  /** S-33: zmiana okładki z modala (optimistic po stronie rodzica). */
  onCoverUpdated?: (bookId: string, patch: BookCoverPatch) => void;
};

/**
 * Karta książki na półce — okładka (lub placeholder), tytuł, autorzy, rok,
 * toggle statusu przeczytania (aria-pressed, optimistic UI po stronie rodzica).
 *
 * NFR a11y: alt = „tytuł — autor" (lub sam tytuł gdy brak autora).
 */
export default function BookCard({
  book,
  onToggleRead,
  shelfName,
  spineColor,
  shelves,
  currentShelfId,
  onMove,
  onCoverUpdated,
}: BookCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const authorsStr = book.authors.join(', ');
  const altText = authorsStr ? `${book.title} — ${authorsStr}` : book.title;
  const cover = effectiveCover(book); // wybrany slot wg cover_source (+ fallback)
  const swatch = spineColor ? SPINE_COLOR_CSS[spineColor] : undefined;
  const moveTargets = (shelves ?? []).filter((s) => s.id !== currentShelfId);

  return (
    <div
      data-testid={`book-card-${book.id}`}
      className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
    >
      {/* Okładka — klik otwiera podgląd szczegółów */}
      <div className="flex justify-center">
        <button
          type="button"
          data-testid={`book-cover-button-${book.id}`}
          onClick={() => setShowDetail(true)}
          title="Pokaż szczegóły książki"
          className="cursor-zoom-in rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {cover ? (
            <img
              src={cover}
              alt={altText}
              className="h-28 w-20 rounded object-cover shadow-sm"
              loading="lazy"
            />
          ) : (
            <div
              className="flex h-28 w-20 items-center justify-center rounded bg-gray-100"
              aria-label={altText}
              role="img"
            >
              <svg
                className="text-gray-300"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 15H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V7h10v2z" />
              </svg>
            </div>
          )}
        </button>
      </div>

      {showDetail && (
        <BookDetailModal
          book={{
            title: book.title,
            authors: book.authors,
            coverUrl: cover,
            isbn13: book.isbn_13,
            isbn10: book.isbn_10,
            publisher: book.publisher,
            publishedYear: book.published_year,
            spineColor: spineColor ?? null,
          }}
          editableBookId={book.id}
          coverSlots={{
            cover_url: book.cover_url,
            user_cover_url: book.user_cover_url,
            cover_photo_url: book.cover_photo_url,
            cover_source: book.cover_source,
            isbn: book.isbn_13 ?? book.isbn_10 ?? null,
          }}
          onCoverUpdated={(patch) => onCoverUpdated?.(book.id, patch)}
          onClose={() => setShowDetail(false)}
        />
      )}

      {/* Metadane */}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs font-semibold text-gray-800 leading-tight">
          {book.title}
        </p>
        {authorsStr && (
          <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{authorsStr}</p>
        )}
        {book.published_year && (
          <p className="mt-0.5 text-xs text-gray-400">{book.published_year}</p>
        )}
        {(shelfName || swatch) && (
          <div className="mt-1 flex items-center gap-1.5">
            {swatch && (
              <span
                data-testid={`spine-swatch-${book.id}`}
                className="inline-block h-3 w-3 flex-shrink-0 rounded-full border border-gray-300"
                style={{ backgroundColor: swatch }}
                title={spineColor ?? undefined}
                aria-label={spineColor ? `Kolor grzbietu: ${spineColor}` : undefined}
              />
            )}
            {shelfName && (
              <span
                data-testid={`shelf-badge-${book.id}`}
                className="truncate rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
              >
                {shelfName}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Toggle przeczytania */}
      <button
        data-testid={`toggle-read-${book.id}`}
        aria-pressed={book.is_read}
        onClick={() => onToggleRead(book.id, book.is_read)}
        className={`w-full rounded px-2 py-1 text-xs font-medium transition-colors ${
          book.is_read
            ? 'bg-green-100 text-green-700 hover:bg-green-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        {book.is_read ? '✓ Przeczytana' : 'Nie przeczytana'}
      </button>

      {/* Link do źródłowego zdjęcia (S-15) — tylko gdy photo_id jest present */}
      {book.photo_id && (
        <a
          data-testid={`source-photo-link-${book.id}`}
          href={`/photos/${book.photo_id}`}
          className="w-full rounded px-2 py-1 text-center text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
        >
          Źródłowe zdjęcie
        </a>
      )}

      {/* Przeniesienie na inną półkę (S-07) — tylko gdy podano shelves + onMove */}
      {onMove && moveTargets.length > 0 && (
        <select
          data-testid={`move-book-${book.id}`}
          value=""
          aria-label={`Przenieś „${book.title}" na inną półkę`}
          onChange={(e) => {
            const target = e.target.value;
            if (target) onMove(book.id, target);
          }}
          className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">{'Przenieś na półkę…'}</option>
          {moveTargets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
