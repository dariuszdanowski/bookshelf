import { useEffect, useState } from 'react';
import { largeCoverUrl } from '../lib/books/cover';

// Znormalizowane dane do podglądu — wspólne dla propozycji (BookCandidateDTO)
// i książek zatwierdzonych (ShelfBookDTO/CatalogBookDTO). Pola opcjonalne, bo
// nie każde źródło ma komplet metadanych.
export type BookDetailData = {
  title: string;
  authors: string[];
  coverUrl: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  source?: string | null;
  spineColor?: string | null;
  matchScore?: number | null;
};

const SOURCE_LABELS: Record<string, string> = {
  google_books: 'Google Books',
  open_library: 'OpenLibrary',
  manual: 'Wpis ręczny',
};

function CoverLarge({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const big = largeCoverUrl(url);
  if (!big || failed) {
    return (
      <div
        data-testid="book-detail-cover-placeholder"
        className="flex h-72 w-48 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300 dark:bg-gray-700 dark:text-gray-500"
        aria-hidden="true"
      >
        <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 15H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V7h10v2z" />
        </svg>
      </div>
    );
  }
  return (
    <img
      data-testid="book-detail-cover"
      src={big}
      alt={`Okładka: ${alt}`}
      className="h-72 w-48 flex-shrink-0 rounded-lg object-contain shadow-md"
      onError={() => setFailed(true)}
    />
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-24 flex-shrink-0 text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-gray-800 dark:text-gray-100">{value}</dd>
    </div>
  );
}

/**
 * Modal ze szczegółami książki — duża okładka + tytuł, autorzy, ISBN, rok,
 * wydawca, źródło. Wspólny dla propozycji i książek zatwierdzonych (jednolity
 * dostęp przez klik w okładkę). Zamknięcie: Esc lub klik w tło.
 */
export default function BookDetailModal({
  book,
  onClose,
}: {
  book: BookDetailData;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const authorsStr = book.authors.join(', ');
  const isbn = book.isbn13 ?? book.isbn10 ?? null;
  const sourceLabel = book.source ? (SOURCE_LABELS[book.source] ?? book.source) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        data-testid="book-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Szczegóły książki: ${book.title}`}
        className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          data-testid="book-detail-close"
          onClick={onClose}
          aria-label="Zamknij"
          className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>

        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="flex justify-center">
            <CoverLarge url={book.coverUrl} alt={authorsStr ? `${book.title} — ${authorsStr}` : book.title} />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-tight text-gray-900 dark:text-gray-50">
              {book.title}
            </h2>
            {authorsStr && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{authorsStr}</p>
            )}

            <dl className="mt-4 space-y-1.5">
              {isbn && <DetailRow label="ISBN" value={isbn} />}
              {book.publishedYear != null && <DetailRow label="Rok wydania" value={String(book.publishedYear)} />}
              {book.publisher && <DetailRow label="Wydawca" value={book.publisher} />}
              {book.spineColor && <DetailRow label="Kolor grzbietu" value={book.spineColor} />}
              {sourceLabel && <DetailRow label="Źródło" value={sourceLabel} />}
              {book.matchScore != null && (
                <DetailRow label="Pewność" value={`${Math.round(book.matchScore * 100)}%`} />
              )}
            </dl>

            {!isbn && book.publishedYear == null && !book.publisher && (
              <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">
                Brak dodatkowych metadanych dla tej książki.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
