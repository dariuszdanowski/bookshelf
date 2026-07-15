import { useEffect, useState } from 'react';
import { effectiveCover, largeCoverUrl } from '../lib/books/cover';
import type { CoverSource } from '../lib/books/schema';
import BookFields from './book/BookFields';
import type { BookFieldValues } from './book/BookFields';
import CoverEditor, { type CoverEditorPatch } from './book/CoverEditor';
import ConfirmDialog from './ConfirmDialog';
import { WebSearchButton } from './DetectionActionsRow';
import PurchaseSection from './PurchaseSection';
import { useBodyScrollLock } from './useBodyScrollLock';

/** Efektywna okładka wg wybranego slotu źródła (+ fallback do dowolnego niepustego). */
function pickCover(
  source: CoverSource,
  auto: string | null,
  user: string,
  photo: string | null,
): string | null {
  const slot = source === 'url' ? user.trim() || null : source === 'photo' ? photo : auto;
  return slot ?? auto ?? (user.trim() || null) ?? photo ?? null;
}

/**
 * Efektywna okładka BEZ fallbacku na inny slot — dokładnie to, co jest w wybranym
 * slocie, albo null. `pickCover` celowo cofa się do innego slotu (podgląd add/edit
 * nie ma znikać przy przełączaniu pustej zakładki), ale w propose mode zgłoszenie
 * usera: wybranie pustego „Wklejony URL" i „Zapisz okładkę" cichcem zapisywało
 * auto-okładkę zamiast braku okładki. Kandydat ma jedno pole `cover_url` (bez
 * `cover_source`), więc to, co widać w podglądzie propose, MUSI być tym, co się
 * zapisuje — bez fallbacku.
 */
function resolveCoverStrict(
  source: CoverSource,
  auto: string | null,
  user: string,
  photo: string | null,
): string | null {
  return source === 'url' ? user.trim() || null : source === 'photo' ? photo : (auto ?? null);
}

// ---------------------------------------------------------------------------
// Typy wejściowe

export type BookModalBook = {
  id?: string;
  title: string;
  authors: string[];
  publisher?: string | null;
  publishedYear?: number | null;
  isbn13?: string | null;
  isbn10?: string | null;
  /** Efektywna okładka do podglądu (po effectiveCover). */
  coverUrl?: string | null;
  /** Surowe sloty okładki — wymagane w edit mode dla CoverEditor. */
  cover_url?: string | null;
  user_cover_url?: string | null;
  cover_photo_url?: string | null;
  cover_source?: CoverSource;
  /** Wymagane w propose mode — cel dla PATCH /api/detections/[id]/candidate (candidate-propose-edit-all-fields). */
  detectionId?: string;
  photoId?: string | null;
  source?: string | null;
  matchScore?: number | null;
  spineColor?: string | null;
  /** raw_title/raw_author bieżącej detekcji (propose mode) — fallback dla „Oryginalny
   *  odczyt OCR" gdy detekcja nigdy nie miała korekty (unify-detection-edit-entrypoint).
   *  Różni się od `title`/`authors` kandydata: te ostatnie mogą pochodzić z dopasowania
   *  w zewnętrznej bazie, nie z surowego odczytu OCR. */
  rawTitle?: string | null;
  rawAuthor?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  purchase_city?: string | null;
  purchase_event?: string | null;
};

/** Podzbiór pól kandydata faktycznie wysłanych w ostatnim PATCH /candidate (propose mode). */
export type CandidatePatch = Partial<{
  title: string;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  isbn13: string | null;
  isbn10: string | null;
  coverUrl: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  purchaseCity: string | null;
  purchaseEvent: string | null;
}>;

export type BookModalProps = {
  mode: 'add' | 'edit' | 'propose';
  /** Wymagany w add mode. */
  shelfId?: string;
  /** Dane wstępne (edit/propose mode; w add opcjonalne — prefill z kandydata). */
  book?: BookModalBook;
  onSaved?: () => void;
  /** propose mode: wywoływane po udanym zapisie pól kandydata (candidate-propose-edit-all-fields). */
  onCandidateSaved?: (patch: CandidatePatch) => void;
  /** propose mode: wywoływane po udanym POST /confirm — kandydat trafił do katalogu. */
  onConfirmed?: () => void;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Stałe

const SOURCE_LABELS: Record<string, string> = {
  google_books: 'Google Books',
  open_library: 'OpenLibrary',
  national_library: 'Biblioteka Narodowa',
  manual: 'Wpis ręczny',
  ai_resolution: 'AI (automatyczne rozwiązanie)',
};

// ---------------------------------------------------------------------------
// Helpers

function bookToFields(b?: BookModalBook): BookFieldValues {
  return {
    title: b?.title ?? '',
    authors: (b?.authors ?? []).join(', '),
    publisher: b?.publisher ?? '',
    year: b?.publishedYear != null ? String(b.publishedYear) : '',
    isbn13: b?.isbn13 ?? '',
    isbn10: b?.isbn10 ?? '',
  };
}

function parseFields(f: BookFieldValues) {
  return {
    title: f.title.trim(),
    authors: f.authors
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    publisher: f.publisher.trim() || null,
    published_year:
      f.year.trim() && Number.isFinite(parseInt(f.year, 10)) ? parseInt(f.year, 10) : null,
    isbn_13: f.isbn13.trim() || null,
    isbn_10: f.isbn10.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Snapshot kandydata (propose mode) — dirty-check dla „Zatwierdź"
// (candidate-propose-edit-all-fields). Porównanie wykonywane na surowych
// wartościach formularza (nie parseFields()), żeby np. białe znaki w polu
// nie liczyły się jako "brak zmian" po jednej stronie i "zmiana" po drugiej.

type CandidateSnapshotShape = {
  title: string;
  authors: string;
  publisher: string;
  year: string;
  isbn13: string;
  isbn10: string;
  coverUrl: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  purchaseCity: string | null;
  purchaseEvent: string | null;
};

function snapshotFromBook(b?: BookModalBook): CandidateSnapshotShape {
  const fields = bookToFields(b);
  const source = b?.cover_source ?? 'auto';
  const auto = b?.cover_url ?? b?.coverUrl ?? null;
  const user = b?.user_cover_url ?? '';
  const photo = b?.cover_photo_url ?? null;
  return {
    title: fields.title,
    authors: fields.authors,
    publisher: fields.publisher,
    year: fields.year,
    isbn13: fields.isbn13,
    isbn10: fields.isbn10,
    coverUrl: resolveCoverStrict(source, auto, user, photo),
    purchaseDate: b?.purchase_date ?? null,
    purchasePrice: b?.purchase_price ?? null,
    purchaseCity: b?.purchase_city ?? null,
    purchaseEvent: b?.purchase_event ?? null,
  };
}

function snapshotsEqual(a: CandidateSnapshotShape, b: CandidateSnapshotShape): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Miniatura okładki

function CoverThumb({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span
        data-testid="book-modal-cover-placeholder"
        className="flex h-12 w-8 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-gray-300 dark:bg-gray-700 dark:text-gray-500"
        aria-hidden="true"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 15H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V7h10v2z" />
        </svg>
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="h-12 w-8 flex-shrink-0 rounded object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Duże zdjęcie okładki

function CoverLarge({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const big = largeCoverUrl(url);
  useEffect(() => setFailed(false), [big]);
  if (!big || failed) {
    return (
      <div
        data-testid="book-modal-cover-large-placeholder"
        className="flex h-48 w-32 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300 dark:bg-gray-700 dark:text-gray-500"
        aria-hidden="true"
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 15H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V7h10v2z" />
        </svg>
      </div>
    );
  }
  return (
    <img
      data-testid="book-modal-cover-large"
      src={big}
      alt={`Okładka: ${alt}`}
      className="h-48 w-32 flex-shrink-0 rounded-lg object-contain shadow-md"
      onError={() => setFailed(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Panel wyszukiwania kandydatów (używany w add + edit mode)
// POST /api/books/candidates → lista → "Użyj" prefilluje pola

type SearchCandidate = {
  title: string;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  publisher: string | null;
  publishedYear: number | null;
  coverUrl: string | null;
  /** Krótki opis z publicznej bazy (S-17) — ukryty stan, nie kontrolka UI. */
  description: string | null;
  source: string;
  externalId: string;
  matchScore: number;
};

function SearchPanel({
  initialTitle,
  initialIsbn,
  initialAuthor = '',
  hideForm = false,
  onSelect,
}: {
  initialTitle: string;
  initialIsbn: string;
  /** Autor z głównego formularza — bez niego auto-search szuka tylko po tytule/ISBN i daje słabe wyniki. */
  initialAuthor?: string;
  /** W trybie add: ukrywa formularz tytułu/isbn/autora — szuka od razu po danych z formularza głównego. */
  hideForm?: boolean;
  onSelect: (c: SearchCandidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState(initialAuthor);
  const [isbn, setIsbn] = useState(initialIsbn);
  const [results, setResults] = useState<SearchCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // overrides pozwalają przekazać świeże wartości z formularza rodzica (useState
  // w SearchPanel inicjalizuje się raz przy mount i nie śledzi zmian props)
  async function search(overrideTitle?: string, overrideIsbn?: string, overrideAuthor?: string) {
    const t = overrideTitle ?? title;
    const i = overrideIsbn ?? isbn;
    const a = overrideAuthor ?? author;
    if (!t.trim() && !i.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, string> = {};
      if (t.trim()) body.title = t.trim();
      if (a.trim()) body.author = a.trim();
      if (i.trim()) body.isbn = i.trim();
      const res = await fetch('/api/books/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        data?: { candidates: SearchCandidate[] };
        error?: { message?: string };
      };
      if (res.status === 429) {
        setErr('Rate limit, spróbuj za chwilę.');
        return;
      }
      if (!res.ok) {
        setErr(json.error?.message ?? 'Błąd wyszukiwania.');
        return;
      }
      setResults(json.data?.candidates ?? []);
    } catch {
      setErr('Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  // Wyszukiwanie wymaga tytułu lub ISBN (sam autor nie wystarcza) — bez nich
  // panel byłby pustą ramką (hideForm nie renderuje własnych inputów).
  const searchReady = !!(initialTitle.trim() || initialIsbn.trim());

  if (!open) {
    return (
      <button
        type="button"
        data-testid="search-candidates-toggle"
        disabled={!searchReady}
        title={
          searchReady
            ? 'Szukaj w bazach książek po wpisanych danych'
            : 'Najpierw wpisz tytuł lub ISBN'
        }
        onClick={() => {
          setTitle(initialTitle);
          setIsbn(initialIsbn);
          setAuthor(initialAuthor);
          setOpen(true);
          void search(initialTitle, initialIsbn, initialAuthor);
        }}
        className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
      >
        Wyszukaj po danych
      </button>
    );
  }

  return (
    <div
      data-testid="search-candidates-panel"
      className="mt-2 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950"
    >
      {/* Formularz wyszukiwania — ukryty w trybie add (pola już wypełnione w głównym formularzu) */}
      {!hideForm && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
              Tytuł
              <input
                data-testid="candidates-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void search();
                  }
                }}
                className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
            <label className="w-28 text-xs font-medium text-gray-700 dark:text-gray-300">
              ISBN
              <input
                data-testid="candidates-isbn"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void search();
                  }
                }}
                className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Autor (opcjonalnie)
            <input
              data-testid="candidates-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="candidates-search"
              disabled={busy || (!title.trim() && !isbn.trim())}
              onClick={() => void search()}
              className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Szukam...' : 'Szukaj'}
            </button>
            <button
              type="button"
              data-testid="candidates-close"
              onClick={() => {
                setOpen(false);
                setResults(null);
                setErr(null);
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}

      {busy && <p className="text-xs text-emerald-700 dark:text-emerald-400">Szukam...</p>}

      {err && (
        <p
          data-testid="candidates-error"
          className="text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          {err}
        </p>
      )}

      {results != null && results.length === 0 && (
        <p data-testid="candidates-no-results" className="text-xs text-amber-600">
          Nie znaleziono wyników.
        </p>
      )}

      {results != null && results.length > 0 && (
        <ul
          data-testid="candidates-list"
          className="max-h-64 space-y-1 overflow-y-auto overscroll-contain"
        >
          {results.map((c, i) => (
            <li
              key={`${c.source}-${c.externalId}-${i}`}
              className="flex items-center gap-2 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800"
            >
              <CoverThumb url={c.coverUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">
                  {c.title}
                </p>
                <p className="truncate text-[11px] text-gray-500">
                  {c.authors.join(', ')}
                  {c.publishedYear ? ` · ${c.publishedYear}` : ''}
                  {c.isbn13 ? ` · ${c.isbn13}` : ''}
                  {` · ${Math.round(c.matchScore * 100)}%`}
                </p>
              </div>
              <button
                type="button"
                data-testid={`candidates-use-${i}`}
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                  setResults(null);
                }}
                className="flex-shrink-0 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                Użyj
              </button>
            </li>
          ))}
        </ul>
      )}

      {hideForm && (
        <button
          type="button"
          data-testid="candidates-close"
          onClick={() => {
            setOpen(false);
            setResults(null);
            setErr(null);
          }}
          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          Zamknij
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Główny komponent

/**
 * Unified modal książki — 3 tryby: add (nowa książka na półkę), edit (edycja
 * istniejącej), propose (pełna edycja propozycji kandydata przed zatwierdzeniem).
 *
 * add:  POST /api/books, „Wyszukaj po danych" → /api/books/candidates → prefill,
 *       „Wyszukaj okładkę" → /api/books/cover-suggestion?isbn= (read-only).
 * edit: PATCH /api/books/:id, identyczne wyszukiwanie kandydatów + CoverEditor
 *       (własny save przez /api/books/:id, osobno od metadanych).
 * propose: PATCH /api/detections/[id]/candidate („Zapisz", bez zatwierdzania) +
 *       POST /api/detections/[id]/confirm („Akceptuj propozycję", z dirty-check
 *       dialogiem gdy są niezapisane zmiany) — candidate-propose-edit-all-fields.
 */
export default function BookModal({
  mode,
  shelfId,
  book,
  onSaved,
  onCandidateSaved,
  onConfirmed,
  onClose,
}: BookModalProps) {
  useBodyScrollLock(); // M5: bez przelewania scrolla na stronę pod modalem
  const [fields, setFields] = useState<BookFieldValues>(() => bookToFields(book));
  // Stan okładki (lifted z CoverEditor) — wspólny dla add/edit/propose. Trafia do
  // ujednoliconego zapisu: POST (add) / PATCH razem z metadanymi (edit/propose).
  const [coverSource, setCoverSource] = useState<CoverSource>(book?.cover_source ?? 'auto');
  const [coverAutoUrl, setCoverAutoUrl] = useState<string | null>(
    book?.cover_url ?? book?.coverUrl ?? null,
  );
  const [coverUserUrl, setCoverUserUrl] = useState<string>(book?.user_cover_url ?? '');
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(book?.cover_photo_url ?? null);
  const [displayCover, setDisplayCover] = useState<string | null>(
    book
      ? effectiveCover({
          cover_url: book.cover_url ?? book.coverUrl ?? null,
          user_cover_url: book.user_cover_url ?? null,
          cover_photo_url: book.cover_photo_url ?? null,
          cover_source: book.cover_source ?? 'auto',
        })
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // candidate-propose-edit-all-fields: snapshot ostatnio zapisanego stanu kandydata
  // (propose mode) — dirty-check dla „Zatwierdź". `saved` steruje potwierdzeniem
  // „Zapisano" obok przycisku; znika automatycznie gdy user znów coś zmieni
  // (isDirty przestaje być false).
  const [savedSnapshot, setSavedSnapshot] = useState<CandidateSnapshotShape>(() =>
    snapshotFromBook(book),
  );
  const [saved, setSaved] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  // S-17: opis z wybranego kandydata — UKRYTY stan (bez kontrolki UI; ekspozycja
  // opisu = follow-up). Sentinel: undefined = kandydata nie wybrano (PATCH pomija
  // pole, nie nadpisuje opisu); null = wybrano kandydata bez opisu (OL/BN — PATCH
  // czyści stary opis, żeby search_text nie niósł opisu poprzedniej tożsamości).
  const [candidateDescription, setCandidateDescription] = useState<string | null | undefined>(
    undefined,
  );

  // Purchase fields state
  const [purchaseDate, setPurchaseDate] = useState<string | null>(book?.purchase_date ?? null);
  const [purchasePrice, setPurchasePrice] = useState<number | null>(book?.purchase_price ?? null);
  const [purchaseCity, setPurchaseCity] = useState<string | null>(book?.purchase_city ?? null);
  const [purchaseEvent, setPurchaseEvent] = useState<string | null>(book?.purchase_event ?? null);
  const [cityHints, setCityHints] = useState<string[]>([]);
  const [eventHints, setEventHints] = useState<string[]>([]);

  // „Oryginalny odczyt OCR" (propose mode) — port z dawnego formularza wyszukiwania
  // po tytule (unify-detection-edit-entrypoint). originalValues cachuje wynik
  // pierwszego fetch/detekcji na czas życia modala, żeby kolejne kliknięcia nie
  // biły do API.
  const [originalValues, setOriginalValues] = useState<{ title: string; author: string } | null>(
    null,
  );
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [originalError, setOriginalError] = useState<string | null>(null);
  const [noHistoryFound, setNoHistoryFound] = useState(false);

  // Snapshot bieżącego stanu formularza — porównywany z savedSnapshot dla dirty-check.
  function currentCandidateSnapshot(): CandidateSnapshotShape {
    return {
      title: fields.title,
      authors: fields.authors,
      publisher: fields.publisher,
      year: fields.year,
      isbn13: fields.isbn13,
      isbn10: fields.isbn10,
      coverUrl: resolveCoverStrict(coverSource, coverAutoUrl, coverUserUrl, coverPhotoUrl),
      purchaseDate,
      purchasePrice,
      purchaseCity,
      purchaseEvent,
    };
  }
  const isCandidateDirty =
    mode === 'propose' && !snapshotsEqual(currentCandidateSnapshot(), savedSnapshot);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const ctrl = new AbortController();
    void fetch('/api/books/purchase-hints?type=city', { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ data?: { hints: string[] } }>)
      .then((j) => {
        if (j.data?.hints) setCityHints(j.data.hints);
      })
      .catch(() => undefined);
    void fetch('/api/books/purchase-hints?type=event', { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ data?: { hints: string[] } }>)
      .then((j) => {
        if (j.data?.hints) setEventHints(j.data.hints);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  function handleField(field: keyof BookFieldValues, value: string) {
    setFields((prev) => ({ ...prev, [field]: value }));
  }

  // „Oryginalny odczyt OCR" (propose mode) — port z dawnego formularza wyszukiwania
  // po tytule. ISBN jest ZAWSZE czyszczony: OCR czyta grzbiet, fizycznie nie ma tam
  // ISBN (ten jest na tylnej okładce, poza kadrem) — zob. commit c2ef75a. Publisher
  // czyszczony z tego samego powodu (60aaadd): wydawnictwo z OCR-owanego grzbietu,
  // jeśli w ogóle było, wraca dopiero z historii korekt.
  async function handleUseOriginal() {
    if (!book?.detectionId) return;
    const initialTitle = book.rawTitle ?? '';
    const initialAuthor = book.rawAuthor ?? '';
    if (originalValues) {
      setFields((prev) => ({
        ...prev,
        title: originalValues.title,
        authors: originalValues.author,
        publisher: '',
        isbn13: '',
        isbn10: '',
      }));
      setNoHistoryFound(false);
      return;
    }
    setLoadingOriginal(true);
    setOriginalError(null);
    setNoHistoryFound(false);
    try {
      const res = await fetch(`/api/detections/${book.detectionId}/history`);
      const json = (await res.json()) as {
        data?: {
          corrections: Array<{
            original_raw_title: string | null;
            original_raw_author: string | null;
          }>;
        };
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      // API zwraca chronologicznie rosnąco — pierwszy wpis to najwcześniejszy original_*.
      const earliest = json.data?.corrections?.[0];
      if (!earliest) {
        setFields((prev) => ({
          ...prev,
          title: initialTitle,
          authors: initialAuthor,
          publisher: '',
          isbn13: '',
          isbn10: '',
        }));
        setNoHistoryFound(true);
        return;
      }
      const resolvedTitle = earliest.original_raw_title ?? initialTitle;
      const resolvedAuthor = earliest.original_raw_author ?? initialAuthor;
      setOriginalValues({ title: resolvedTitle, author: resolvedAuthor });
      setFields((prev) => ({
        ...prev,
        title: resolvedTitle,
        authors: resolvedAuthor,
        publisher: '',
        isbn13: '',
        isbn10: '',
      }));
    } catch (e) {
      setOriginalError(e instanceof Error ? e.message : 'Błąd ładowania historii');
    } finally {
      setLoadingOriginal(false);
    }
  }

  function handleCandidateSelect(c: SearchCandidate) {
    setFields({
      title: c.title,
      authors: c.authors.join(', '),
      publisher: c.publisher ?? '',
      year: c.publishedYear != null ? String(c.publishedYear) : '',
      isbn13: c.isbn13 ?? '',
      isbn10: c.isbn10 ?? '',
    });
    setCandidateDescription(c.description ?? null);
    if (c.coverUrl) {
      setCoverAutoUrl(c.coverUrl);
      setCoverSource('auto');
      setDisplayCover(c.coverUrl);
    }
  }

  // Lift zmian z CoverEditor (add + edit) do wspólnego stanu + podgląd.
  function handleCoverChange(patch: CoverEditorPatch) {
    const nextSource = patch.source ?? coverSource;
    const nextAuto = patch.autoUrl !== undefined ? patch.autoUrl : coverAutoUrl;
    const nextUser = patch.userUrl !== undefined ? patch.userUrl : coverUserUrl;
    const nextPhoto = patch.photoUrl !== undefined ? patch.photoUrl : coverPhotoUrl;
    if (patch.source !== undefined) setCoverSource(patch.source);
    if (patch.autoUrl !== undefined) setCoverAutoUrl(patch.autoUrl);
    if (patch.userUrl !== undefined) setCoverUserUrl(patch.userUrl);
    if (patch.photoUrl !== undefined) setCoverPhotoUrl(patch.photoUrl);
    // propose: kandydat ma jedno pole cover_url (bez cover_source) — podgląd musi
    // pokazywać dokładnie to, co „Zapisz okładkę" zapisze, bez fallbacku na inny
    // slot (zgłoszenie usera: pusty „Wklejony URL" pokazywał i zapisywał auto-okładkę).
    setDisplayCover(
      mode === 'propose'
        ? resolveCoverStrict(nextSource, nextAuto, nextUser, nextPhoto)
        : pickCover(nextSource, nextAuto, nextUser, nextPhoto),
    );
  }

  // candidate-propose-edit-all-fields: „Zapisz" w propose mode — PATCH-uje
  // WSZYSTKIE bieżące pola formularza (title/authors/isbn/publisher/year/cover/
  // purchase) na raz do book_candidates, bez zatwierdzania. Zwraca sukces, żeby
  // handleConfirmDialogConfirm mógł zsekwencjonować zapis → zatwierdzenie.
  async function handleSaveCandidate(): Promise<boolean> {
    if (!book?.id || !book?.detectionId) return false;
    if (!fields.title.trim()) return false;
    setBusy(true);
    setErr(null);
    setSaved(false);
    const parsed = parseFields(fields);
    const resolvedCover = resolveCoverStrict(
      coverSource,
      coverAutoUrl,
      coverUserUrl,
      coverPhotoUrl,
    );
    try {
      const res = await fetch(`/api/detections/${book.detectionId}/candidate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: book.id,
          title: parsed.title,
          authors: parsed.authors,
          publisher: parsed.publisher,
          published_year: parsed.published_year,
          isbn_13: parsed.isbn_13,
          isbn_10: parsed.isbn_10,
          cover_url: resolvedCover,
          purchase_date: purchaseDate,
          purchase_price: purchasePrice,
          purchase_city: purchaseCity,
          purchase_event: purchaseEvent,
        }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setErr(json.error?.message ?? `Błąd zapisu (${res.status})`);
        return false;
      }
      setSavedSnapshot(currentCandidateSnapshot());
      setSaved(true);
      onCandidateSaved?.({
        title: parsed.title,
        authors: parsed.authors,
        publisher: parsed.publisher,
        publishedYear: parsed.published_year,
        isbn13: parsed.isbn_13,
        isbn10: parsed.isbn_10,
        coverUrl: resolvedCover,
        purchaseDate,
        purchasePrice,
        purchaseCity,
        purchaseEvent,
      });
      return true;
    } catch {
      setErr('Błąd sieci.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // „Zatwierdź" — POST /confirm. Bez niezapisanych zmian od razu; z nimi otwiera
  // ConfirmDialog (patrz handleConfirmDialogConfirm) zamiast cicho zatwierdzać
  // nieaktualne dane.
  async function doConfirmCandidate() {
    if (!book?.id || !book?.detectionId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/detections/${book.detectionId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_id: book.id }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (res.status === 409) {
        setErr(json.error?.message ?? 'Masz już tę książkę w katalogu.');
        return;
      }
      if (!res.ok) {
        setErr(json.error?.message ?? `Błąd zapisu (${res.status})`);
        return;
      }
      onConfirmed?.();
      onClose();
    } catch {
      setErr('Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmClick() {
    if (!book?.id || !book?.detectionId) return;
    if (isCandidateDirty) {
      setConfirmDialogOpen(true);
      return;
    }
    await doConfirmCandidate();
  }

  // Dialog „Zapisz i zatwierdź": zapis MUSI się powieść zanim zawołamy /confirm —
  // sekwencyjnie, nie równolegle (błąd zapisu nie może prowadzić do zatwierdzenia
  // nieaktualnych danych).
  async function handleConfirmDialogConfirm() {
    setConfirmDialogOpen(false);
    const ok = await handleSaveCandidate();
    if (!ok) return;
    await doConfirmCandidate();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'propose') {
      await handleSaveCandidate();
      return;
    }
    if (!fields.title.trim()) return;
    setBusy(true);
    setErr(null);
    const parsed = parseFields(fields);

    try {
      let res: Response;
      if (mode === 'add') {
        if (!shelfId) {
          setErr('Brak shelf_id.');
          return;
        }
        // AddPurchaseSchema uses .optional() (not .nullish()) — strip null fields so Zod accepts them.
        // Sloty okładki: cover_source zawsze; pozostałe tylko gdy mają wartość.
        const coverFields: Record<string, string> = { cover_source: coverSource };
        if (coverAutoUrl) coverFields.cover_url = coverAutoUrl;
        if (coverUserUrl.trim()) coverFields.user_cover_url = coverUserUrl.trim();
        if (coverPhotoUrl) coverFields.cover_photo_url = coverPhotoUrl;
        const postBody = Object.fromEntries(
          Object.entries({
            ...parsed,
            shelf_id: shelfId,
            ...coverFields,
            // S-17: opis tylko gdy pochodzi z wybranego kandydata (null/undefined odfiltruje się niżej).
            description: candidateDescription ?? null,
            purchase_date: purchaseDate,
            purchase_price: purchasePrice,
            purchase_city: purchaseCity,
            purchase_event: purchaseEvent,
          }).filter(([, v]) => v !== null),
        );
        res = await fetch('/api/books', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(postBody),
        });
      } else {
        if (!book?.id) {
          setErr('Brak book id.');
          return;
        }
        // unify-book-save: jeden zapis — metadane + sloty okładki w jednym PATCH
        // (UpdateBookSchema dopuszcza nullable, więc null = wyczyść slot).
        const patchBody = {
          ...parsed,
          cover_url: coverAutoUrl,
          user_cover_url: coverUserUrl.trim() || null,
          cover_photo_url: coverPhotoUrl,
          cover_source: coverSource,
          // S-17: opis tylko z wybranego kandydata (per-book backfill starych książek).
          // Bez wyboru kandydata (undefined) pole pomijamy — PATCH nie nadpisuje opisu;
          // kandydat bez opisu (null, OL/BN) → wysyłamy null = wyczyść stary opis
          // (impl-review F1: re-identyfikacja nie może zostawić opisu innej książki).
          ...(candidateDescription !== undefined ? { description: candidateDescription } : {}),
          purchase_date: purchaseDate,
          purchase_price: purchasePrice,
          purchase_city: purchaseCity,
          purchase_event: purchaseEvent,
        };
        res = await fetch(`/api/books/${book.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        });
      }

      const json = (await res.json()) as { error?: { message?: string } };
      if (res.status === 409) {
        setErr(json.error?.message ?? 'Masz już tę książkę w katalogu.');
        return;
      }
      if (!res.ok) {
        setErr(json.error?.message ?? `Błąd zapisu (${res.status})`);
        return;
      }
      onSaved?.();
      onClose();
    } catch {
      setErr('Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  const authorsDisplay = (book?.authors ?? []).join(', ');
  const sourceLabel = book?.source ? (SOURCE_LABELS[book.source] ?? book.source) : null;
  const canEdit = mode !== 'propose';

  const MODAL_TITLES: Record<BookModalProps['mode'], string> = {
    add: 'Dodaj książkę',
    edit: 'Edytuj książkę',
    propose: book?.title ?? 'Podgląd książki',
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        {/* Trójstrefowy layout dialogu: stały nagłówek + scrollowane TYLKO body +
          stały footer. Scroll całego kontenera z sticky footerem zasłaniał dół
          treści (sekcja okładki wyglądała na uciętą zaraz po otwarciu). */}
        <div
          data-testid="book-modal"
          role="dialog"
          aria-modal="true"
          aria-label={MODAL_TITLES[mode]}
          className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl dark:bg-gray-800"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Nagłówek */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <h2
              data-testid="book-modal-title"
              className="text-base font-bold text-gray-900 dark:text-gray-50"
            >
              {MODAL_TITLES[mode]}
            </h2>
            <button
              data-testid="book-modal-close"
              onClick={onClose}
              aria-label="Zamknij"
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSave} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
              <div className="flex flex-col gap-4 sm:flex-row">
                {/* Lewa kolumna — okładka. Stała szerokość na desktopie, by sekcja okładki
                (zwłaszcza bez okładki) nie rozpychała się i nie ściskała pól + wyników po prawej. */}
                <div className="flex w-full flex-col items-center gap-2 sm:w-72 sm:flex-shrink-0">
                  <CoverLarge
                    url={displayCover}
                    alt={authorsDisplay ? `${fields.title} — ${authorsDisplay}` : fields.title}
                  />

                  {/* Sekcja okładki — zawsze rozwinięta, identyczna w add/edit/propose.
                  Sloty zapisywane jednym „Zapisz" razem z resztą pól (unify-book-save
                  dla add/edit; candidate-propose-edit-all-fields dla propose). */}
                  <CoverEditor
                    isbn={fields.isbn13 || fields.isbn10}
                    source={coverSource}
                    autoUrl={coverAutoUrl}
                    userUrl={coverUserUrl}
                    photoUrl={coverPhotoUrl}
                    testIdPrefix={
                      mode === 'edit'
                        ? 'edit-cover'
                        : mode === 'propose'
                          ? 'propose-cover'
                          : 'add-cover'
                    }
                    onChange={handleCoverChange}
                  />
                </div>

                {/* Prawa kolumna — pola i akcje */}
                <div className="min-w-0 flex-1 space-y-3">
                  {/* Metadane — edytowalne we wszystkich trybach (propose: pełna edycja
                  przed zatwierdzeniem, candidate-propose-edit-all-fields). */}
                  <BookFields values={fields} onChange={handleField} readOnly={false} />

                  {/* „Oryginalny odczyt OCR" (propose mode) — dostępny niezależnie od tego,
                  czy kandydat jest świeżym draftem (no-match) czy prawdziwym matchem
                  (unify-detection-edit-entrypoint). */}
                  {mode === 'propose' && book?.detectionId && (
                    <div className="space-y-1">
                      <button
                        type="button"
                        data-testid="book-modal-use-original"
                        disabled={loadingOriginal}
                        onClick={() => void handleUseOriginal()}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      >
                        {loadingOriginal ? 'Ładowanie...' : 'Oryginalny odczyt OCR'}
                      </button>
                      {originalError && (
                        <p
                          data-testid="book-modal-original-error"
                          className="text-[11px] text-red-600 dark:text-red-400"
                        >
                          {originalError}
                        </p>
                      )}
                      {noHistoryFound && (
                        <p
                          data-testid="book-modal-no-history-hint"
                          className="text-[11px] text-gray-500 dark:text-gray-400"
                        >
                          Brak historii korekt — to już jest oryginalny odczyt OCR.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Dodatkowe info w propose mode */}
                  {mode === 'propose' && (
                    <dl className="space-y-1 text-sm">
                      {book?.spineColor && (
                        <div className="flex gap-2">
                          <dt className="w-24 flex-shrink-0 text-gray-400">Kolor grzbietu</dt>
                          <dd className="font-medium text-gray-800 dark:text-gray-100">
                            {book.spineColor}
                          </dd>
                        </div>
                      )}
                      {sourceLabel && (
                        <div className="flex gap-2">
                          <dt className="w-24 flex-shrink-0 text-gray-400">Źródło</dt>
                          <dd className="font-medium text-gray-800 dark:text-gray-100">
                            {sourceLabel}
                          </dd>
                        </div>
                      )}
                      {book?.matchScore != null && (
                        <div className="flex gap-2">
                          <dt className="w-24 flex-shrink-0 text-gray-400">Pewność</dt>
                          <dd className="font-medium text-gray-800 dark:text-gray-100">
                            {Math.round(book.matchScore * 100)}%
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}

                  {/* Panel wyszukiwania kandydatów (add + edit + propose). hideForm
                  zawsze true: główny formularz już ma pola tytuł/ISBN/autor, więc
                  panel szuka po nich (auto-search po toggle) zamiast renderować
                  zdublowane inputy. */}
                  <SearchPanel
                    initialTitle={fields.title}
                    initialIsbn={fields.isbn13 || fields.isbn10}
                    initialAuthor={fields.authors}
                    hideForm={true}
                    onSelect={handleCandidateSelect}
                  />

                  {/* Sekcja informacji o zakupie (add + edit + propose) */}
                  <PurchaseSection
                    purchaseDate={purchaseDate}
                    purchasePrice={purchasePrice}
                    purchaseCity={purchaseCity}
                    purchaseEvent={purchaseEvent}
                    cityHints={cityHints}
                    eventHints={eventHints}
                    disabled={busy}
                    onChange={(patch) => {
                      if (patch.purchaseDate !== undefined) setPurchaseDate(patch.purchaseDate);
                      if (patch.purchasePrice !== undefined) setPurchasePrice(patch.purchasePrice);
                      if (patch.purchaseCity !== undefined) setPurchaseCity(patch.purchaseCity);
                      if (patch.purchaseEvent !== undefined) setPurchaseEvent(patch.purchaseEvent);
                    }}
                  />

                  {/* Przyciski akcji */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {/* unify-detection-edit-entrypoint (Faza 5): jedna implementacja
                    z DetectionActionsRow — znika sama, gdy pola puste (nie trzeba
                    już ręcznej bramki trybu add jak w dawnej lokalnej wersji). */}
                    <WebSearchButton
                      parts={[fields.title, fields.authors, fields.isbn13 || fields.isbn10]}
                      testId="book-modal-web-search"
                    />

                    {mode === 'edit' && book?.photoId && (
                      <a
                        data-testid="book-modal-source-photo"
                        href={`/photos/${book.photoId}`}
                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                      >
                        Źródłowe zdjęcie
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer poza obszarem scrolla — primary CTA zawsze widoczny niezależnie
              od długości treści (lista kandydatów potrafiła wypchnąć zapis poza
              viewport), a treść nigdy nie wsuwa się pod przyciski. */}
            {canEdit ? (
              <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
                {err && (
                  <p
                    data-testid="book-modal-error"
                    className="mr-auto text-xs text-red-600 dark:text-red-400"
                    role="alert"
                  >
                    {err}
                  </p>
                )}
                <button
                  type="button"
                  data-testid="book-modal-cancel"
                  onClick={onClose}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  data-testid="book-modal-save"
                  disabled={busy || !fields.title.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? 'Zapisuję...' : mode === 'add' ? 'Dodaj na półkę' : 'Zapisz'}
                </button>
              </div>
            ) : (
              // propose: Zapisz (PATCH kandydata, modal zostaje otwarty) / Akceptuj propozycję
              // (POST /confirm, dirty-check dialog) / Anuluj (candidate-propose-edit-all-fields).
              <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
                {err && (
                  <p
                    data-testid="book-modal-error"
                    className="mr-auto text-xs text-red-600 dark:text-red-400"
                    role="alert"
                  >
                    {err}
                  </p>
                )}
                {saved && !isCandidateDirty && !err && (
                  <p
                    data-testid="propose-saved"
                    className="mr-auto text-xs text-green-600 dark:text-green-400"
                  >
                    Zapisano.
                  </p>
                )}
                <button
                  type="button"
                  data-testid="book-modal-cancel"
                  onClick={onClose}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  data-testid="book-modal-save"
                  disabled={busy || !fields.title.trim() || !book?.id || !book?.detectionId}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                >
                  {busy ? 'Zapisuję...' : 'Zapisz'}
                </button>
                <button
                  type="button"
                  data-testid="book-modal-confirm"
                  disabled={busy || !fields.title.trim() || !book?.id || !book?.detectionId}
                  onClick={() => void handleConfirmClick()}
                  title="Zaakceptuj propozycję jako książkę"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Akceptuj propozycję
                </button>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Poza backdropem BookModala — inaczej klik na backdrop ConfirmDialog
          bąbelkowałby do onClick={onClose} rodzica i zamykał oba modale naraz. */}
      {mode === 'propose' && (
        <ConfirmDialog
          open={confirmDialogOpen}
          title="Niezapisane zmiany"
          message="Masz niezapisane zmiany. Zapisać i zaakceptować propozycję?"
          confirmLabel="Zapisz i zaakceptuj"
          cancelLabel="Anuluj"
          testIdPrefix="propose-confirm-dialog"
          onConfirm={() => void handleConfirmDialogConfirm()}
          onCancel={() => setConfirmDialogOpen(false)}
        />
      )}
    </>
  );
}
