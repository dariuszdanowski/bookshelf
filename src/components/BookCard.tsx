import { useState } from 'react';
import type { ShelfBookDTO, BookCoverPatch } from '../lib/books/schema';
import type { ShelfDTO } from '../lib/shelves/schema';
import { effectiveCover } from '../lib/books/cover';
import BookModal from './BookModal';
import ConfirmDialog from './ConfirmDialog';
import type { ViewMode } from './ViewModeSwitcher';

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
  /** S-36: odświeżenie listy po zapisie z BookModal edit. */
  onBookSaved?: () => void;
  /** book-delete: usunięcie książki z katalogu (optimistic po stronie rodzica). Gdy brak — przycisk się nie renderuje. */
  onDelete?: (bookId: string) => void;
  /** S-34: tryb prezentacji — 'cards' (domyślny szczegółowy), 'list' (1 linia), 'tiles' (cover-forward). */
  viewMode?: ViewMode;
};

/**
 * Karta książki — 3 układy (S-34) sterowane `viewMode`: Karty (szczegółowy),
 * Lista (1 linia), Kafelki (cover-forward). Wszystkie odsłaniają ten sam komplet
 * operacji: edycja (klik okładki → BookModal z „Szukaj w sieci"/„Wyszukaj po danych"),
 * toggle przeczytania, przeniesienie, usunięcie. Stan/handlery/modal/dialog wspólne.
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
  onBookSaved,
  onDelete,
  viewMode = 'cards',
}: BookCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const authorsStr = book.authors.join(', ');
  const altText = authorsStr ? `${book.title} — ${authorsStr}` : book.title;
  const cover = effectiveCover(book); // wybrany slot wg cover_source (+ fallback)
  const swatch = spineColor ? SPINE_COLOR_CSS[spineColor] : undefined;
  const moveTargets = (shelves ?? []).filter((s) => s.id !== currentShelfId);

  // ---- Wspólne, reużywalne elementy (jednakowe między układami) -----------

  function coverButton(imgClass: string, placeholderIconSize: number) {
    return (
      <button
        type="button"
        data-testid={`book-cover-button-${book.id}`}
        onClick={() => setShowDetail(true)}
        title="Pokaż szczegóły / edytuj"
        className="cursor-zoom-in rounded focus:ring-2 focus:ring-blue-400 focus:outline-none"
      >
        {cover && !coverFailed ? (
          <img
            src={cover}
            alt={altText}
            className={`${imgClass} rounded object-cover shadow-sm`}
            loading="lazy"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div
            className={`${imgClass} flex items-center justify-center rounded bg-gray-100 dark:bg-gray-700`}
            aria-label={altText}
            role="img"
          >
            <svg
              className="text-gray-300 dark:text-gray-500"
              width={placeholderIconSize}
              height={placeholderIconSize}
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 15H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
          </div>
        )}
      </button>
    );
  }

  function readToggle(extraClass = '') {
    return (
      <button
        data-testid={`toggle-read-${book.id}`}
        aria-pressed={book.is_read}
        onClick={() => onToggleRead(book.id, book.is_read)}
        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
          book.is_read
            ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
        } ${extraClass}`}
      >
        {book.is_read ? '✓ Przeczytana' : 'Nie przeczytana'}
      </button>
    );
  }

  const moveSelect =
    onMove && moveTargets.length > 0 ? (
      <select
        data-testid={`move-book-${book.id}`}
        value=""
        aria-label={`Przenieś „${book.title}" na inną półkę`}
        onChange={(e) => {
          const target = e.target.value;
          if (target) onMove(book.id, target);
        }}
        className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        <option value="">{'Przenieś na półkę…'}</option>
        {moveTargets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    ) : null;

  // S-37: deep-link z fokusem na detekcji źródłowej (gdy znana) — review
  // podświetla jej ramkę i scrolluje listę do pozycji.
  const sourcePhotoHref = book.detection_id
    ? `/photos/${book.photo_id}?detection=${book.detection_id}`
    : `/photos/${book.photo_id}`;

  const sourcePhotoLink = book.photo_id ? (
    <a
      data-testid={`source-photo-link-${book.id}`}
      href={sourcePhotoHref}
      className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400"
    >
      Źródłowe zdjęcie
    </a>
  ) : null;

  function deleteButton(extraClass = '') {
    return onDelete ? (
      <button
        type="button"
        data-testid={`delete-book-${book.id}`}
        onClick={() => setConfirmDelete(true)}
        className={`rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 ${extraClass}`}
      >
        Usuń
      </button>
    ) : null;
  }

  // Modal edycji + dialog usuwania — renderowane raz, niezależnie od układu.
  const editModal = showDetail ? (
    <BookModal
      mode="edit"
      book={{
        id: book.id,
        title: book.title,
        authors: book.authors,
        coverUrl: cover,
        cover_url: book.cover_url,
        user_cover_url: book.user_cover_url,
        cover_photo_url: book.cover_photo_url,
        cover_source: book.cover_source,
        publisher: book.publisher,
        publishedYear: book.published_year,
        isbn13: book.isbn_13,
        isbn10: book.isbn_10,
        photoId: book.photo_id,
        spineColor: spineColor ?? null,
        purchase_date: book.purchase_date,
        purchase_price: book.purchase_price,
        purchase_city: book.purchase_city,
        purchase_event: book.purchase_event,
      }}
      onSaved={() => onBookSaved?.()}
      onClose={() => setShowDetail(false)}
    />
  ) : null;

  const deleteDialog = onDelete ? (
    <ConfirmDialog
      open={confirmDelete}
      title="Usunąć książkę?"
      message={`„${book.title}" zostanie trwale usunięta z katalogu i z półki. Tej operacji nie można cofnąć.`}
      confirmLabel="Usuń"
      confirmTone="danger"
      testIdPrefix={`delete-book-dialog-${book.id}`}
      onConfirm={() => {
        setConfirmDelete(false);
        onDelete(book.id);
      }}
      onCancel={() => setConfirmDelete(false)}
    />
  ) : null;

  const meta = (
    <>
      <p className="line-clamp-2 text-xs leading-tight font-semibold text-gray-800 dark:text-gray-100">
        {book.title}
      </p>
      {authorsStr && (
        <p className="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">{authorsStr}</p>
      )}
      {book.published_year && (
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{book.published_year}</p>
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
              className="truncate rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
            >
              {shelfName}
            </span>
          )}
        </div>
      )}
    </>
  );

  // ---- Układ: Lista (1 linia) ---------------------------------------------
  if (viewMode === 'list') {
    return (
      <div
        data-testid={`book-card-${book.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-900"
      >
        <div data-testid={`book-row-${book.id}`} className="contents">
          {coverButton('h-12 w-8 flex-shrink-0', 14)}
          <div className="min-w-0 flex-1">{meta}</div>
          {/* S-28: na mobile akcje schodzą do pełnowierszowej linii pod tytułem —
              flex-shrink-0 bez wrap wypychał je poza kartę i zgniatał meta do zera */}
          <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:flex-shrink-0 sm:justify-end">
            {readToggle()}
            {moveSelect}
            {deleteButton()}
          </div>
        </div>
        {editModal}
        {deleteDialog}
      </div>
    );
  }

  // ---- Układ: Kafelki (cover-forward) -------------------------------------
  if (viewMode === 'tiles') {
    return (
      <div
        data-testid={`book-card-${book.id}`}
        className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
      >
        <div data-testid={`book-tile-${book.id}`} className="flex flex-col gap-2">
          <div className="flex justify-center">{coverButton('h-40 w-full max-w-[8rem]', 40)}</div>
          <div className="min-w-0">{meta}</div>
          <div className="flex flex-wrap items-center gap-1">
            {readToggle('flex-1')}
            {deleteButton()}
          </div>
          {moveSelect && <div className="flex">{moveSelect}</div>}
          {sourcePhotoLink}
        </div>
        {editModal}
        {deleteDialog}
      </div>
    );
  }

  // ---- Układ: Karty (domyślny, szczegółowy) -------------------------------
  return (
    <div
      data-testid={`book-card-${book.id}`}
      className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex justify-center">{coverButton('h-28 w-20', 32)}</div>
      <div className="min-w-0 flex-1">{meta}</div>
      {readToggle('w-full')}
      {sourcePhotoLink && <div className="flex flex-col">{sourcePhotoLink}</div>}
      {moveSelect && <div className="flex flex-col">{moveSelect}</div>}
      {deleteButton('w-full')}
      {editModal}
      {deleteDialog}
    </div>
  );
}
