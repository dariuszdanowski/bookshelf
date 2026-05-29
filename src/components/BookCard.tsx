import type { ShelfBookDTO } from '../lib/books/schema';

type BookCardProps = {
  book: ShelfBookDTO;
  onToggleRead: (id: string, currentValue: boolean) => void;
};

/**
 * Karta książki na półce — okładka (lub placeholder), tytuł, autorzy, rok,
 * toggle statusu przeczytania (aria-pressed, optimistic UI po stronie rodzica).
 *
 * NFR a11y: alt = „tytuł — autor" (lub sam tytuł gdy brak autora).
 */
export default function BookCard({ book, onToggleRead }: BookCardProps) {
  const authorsStr = book.authors.join(', ');
  const altText = authorsStr ? `${book.title} — ${authorsStr}` : book.title;

  return (
    <div
      data-testid={`book-card-${book.id}`}
      className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
    >
      {/* Okładka */}
      <div className="flex justify-center">
        {book.cover_url ? (
          <img
            src={book.cover_url}
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
      </div>

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
    </div>
  );
}
