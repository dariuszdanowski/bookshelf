import { useEffect, useState } from 'react';
import { effectiveCover, largeCoverUrl } from '../lib/books/cover';
import type { BookCoverPatch, CoverSource } from '../lib/books/schema';
import BookFields from './book/BookFields';
import type { BookFieldValues } from './book/BookFields';
import CoverEditor, { type CoverEditorPatch } from './book/CoverEditor';

/** Efektywna okładka wg wybranego slotu źródła (+ fallback do dowolnego niepustego). */
function pickCover(source: CoverSource, auto: string | null, user: string, photo: string | null): string | null {
  const slot = source === 'url' ? (user.trim() || null) : source === 'photo' ? photo : auto;
  return slot ?? auto ?? (user.trim() || null) ?? photo ?? null;
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
  photoId?: string | null;
  source?: string | null;
  matchScore?: number | null;
  spineColor?: string | null;
};

export type BookModalProps = {
  mode: 'add' | 'edit' | 'propose';
  /** Wymagany w add mode. */
  shelfId?: string;
  /** Dane wstępne (edit/propose mode; w add opcjonalne — prefill z kandydata). */
  book?: BookModalBook;
  onSaved?: () => void;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Stałe

const SOURCE_LABELS: Record<string, string> = {
  google_books: 'Google Books',
  open_library: 'OpenLibrary',
  national_library: 'Biblioteka Narodowa',
  manual: 'Wpis ręczny',
};

// ---------------------------------------------------------------------------
// Helpers

function googleSearchUrl(fields: BookFieldValues): string {
  const q = [
    fields.title.trim(),
    fields.authors.trim(),
    fields.isbn13.trim() || fields.isbn10.trim(),
  ].filter(Boolean).join(' ').trim();
  return q ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : '#';
}

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
    authors: f.authors.split(',').map((a) => a.trim()).filter(Boolean),
    publisher: f.publisher.trim() || null,
    published_year: f.year.trim() && Number.isFinite(parseInt(f.year, 10)) ? parseInt(f.year, 10) : null,
    isbn_13: f.isbn13.trim() || null,
    isbn_10: f.isbn10.trim() || null,
  };
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
  source: string;
  externalId: string;
  matchScore: number;
};

function SearchPanel({
  initialTitle,
  initialIsbn,
  hideForm = false,
  onSelect,
}: {
  initialTitle: string;
  initialIsbn: string;
  /** W trybie add: ukrywa formularz tytułu/isbn/autora — szuka od razu po danych z formularza głównego. */
  hideForm?: boolean;
  onSelect: (c: SearchCandidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState(initialIsbn);
  const [results, setResults] = useState<SearchCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // overrides pozwalają przekazać świeże wartości z formularza rodzica (useState
  // w SearchPanel inicjalizuje się raz przy mount i nie śledzi zmian props)
  async function search(overrideTitle?: string, overrideIsbn?: string) {
    const t = overrideTitle ?? title;
    const i = overrideIsbn ?? isbn;
    if (!t.trim() && !i.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, string> = {};
      if (t.trim()) body.title = t.trim();
      if (author.trim()) body.author = author.trim();
      if (i.trim()) body.isbn = i.trim();
      const res = await fetch('/api/books/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data?: { candidates: SearchCandidate[] }; error?: { message?: string } };
      if (res.status === 429) { setErr('Rate limit, spróbuj za chwilę.'); return; }
      if (!res.ok) { setErr(json.error?.message ?? 'Błąd wyszukiwania.'); return; }
      setResults(json.data?.candidates ?? []);
    } catch {
      setErr('Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="search-candidates-toggle"
        onClick={() => {
          setTitle(initialTitle);
          setIsbn(initialIsbn);
          setOpen(true);
          if (initialTitle.trim() || initialIsbn.trim()) {
            void search(initialTitle, initialIsbn);
          }
        }}
        className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
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
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
                className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
            <label className="w-28 text-xs font-medium text-gray-700 dark:text-gray-300">
              ISBN
              <input
                data-testid="candidates-isbn"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
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
              onClick={() => { setOpen(false); setResults(null); setErr(null); }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}

      {busy && <p className="text-xs text-emerald-700 dark:text-emerald-400">Szukam...</p>}

      {err && <p data-testid="candidates-error" className="text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}

      {results != null && results.length === 0 && (
        <p data-testid="candidates-no-results" className="text-xs text-amber-600">
          Nie znaleziono wyników.
        </p>
      )}

      {results != null && results.length > 0 && (
        <ul data-testid="candidates-list" className="space-y-1">
          {results.map((c, i) => (
            <li
              key={`${c.source}-${c.externalId}-${i}`}
              className="flex items-center gap-2 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800"
            >
              <CoverThumb url={c.coverUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">{c.title}</p>
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
                onClick={() => { onSelect(c); setOpen(false); setResults(null); }}
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
          onClick={() => { setOpen(false); setResults(null); setErr(null); }}
          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          Zamknij
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel edycji okładki dla trybu edit — wrapper (toggle / Zapisz okładkę / Anuluj)
// wokół wspólnego CoverEditor; własny PATCH do /api/books/:id (osobno od metadanych).

type CoverSlots = {
  cover_url: string | null;
  user_cover_url: string | null;
  cover_photo_url: string | null;
  cover_source: CoverSource;
  isbn: string | null;
};

function EditCoverSection({
  bookId,
  slots,
  onPreview,
  onApplied,
}: {
  bookId: string;
  slots: CoverSlots;
  onPreview: (url: string | null) => void;
  onApplied: (patch: BookCoverPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<CoverSource>(slots.cover_source);
  const [autoUrl, setAutoUrl] = useState(slots.cover_url);
  const [userUrl, setUserUrl] = useState(slots.user_cover_url ?? '');
  const [photoUrl, setPhotoUrl] = useState(slots.cover_photo_url);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function handleChange(patch: CoverEditorPatch) {
    const nextSource = patch.source ?? source;
    const nextAuto = patch.autoUrl !== undefined ? patch.autoUrl : autoUrl;
    const nextUser = patch.userUrl !== undefined ? patch.userUrl : userUrl;
    const nextPhoto = patch.photoUrl !== undefined ? patch.photoUrl : photoUrl;
    if (patch.source !== undefined) setSource(patch.source);
    if (patch.autoUrl !== undefined) setAutoUrl(patch.autoUrl);
    if (patch.userUrl !== undefined) setUserUrl(patch.userUrl);
    if (patch.photoUrl !== undefined) setPhotoUrl(patch.photoUrl);
    onPreview(pickCover(nextSource, nextAuto, nextUser, nextPhoto));
  }

  async function handleSave() {
    setBusy(true);
    setErr(null);
    const newUserUrl = userUrl.trim() || null;
    const patch: BookCoverPatch = { cover_source: source };
    if (newUserUrl !== slots.user_cover_url) patch.user_cover_url = newUserUrl;
    if (photoUrl !== slots.cover_photo_url) patch.cover_photo_url = photoUrl;
    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) { setErr(json.error?.message ?? `Błąd zapisu (${res.status})`); return; }
      onApplied({ ...patch, cover_url: autoUrl });
      setOpen(false);
    } catch {
      setErr('Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="edit-cover-toggle"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
      >
        Zmień okładkę
      </button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2">
      <CoverEditor
        mode="edit"
        bookId={bookId}
        isbn={slots.isbn}
        source={source}
        autoUrl={autoUrl}
        userUrl={userUrl}
        photoUrl={photoUrl}
        testIdPrefix="edit-cover"
        onChange={handleChange}
      />

      {err && <p data-testid="edit-cover-save-error" className="text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="edit-cover-save"
          disabled={busy}
          onClick={() => void handleSave()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Zapisuję...' : 'Zapisz okładkę'}
        </button>
        <button
          type="button"
          data-testid="edit-cover-cancel"
          onClick={() => { setOpen(false); onPreview(effectiveCover(slots)); }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
        >
          Anuluj
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Główny komponent

/**
 * Unified modal książki — 3 tryby: add (nowa książka na półkę), edit (edycja
 * istniejącej), propose (read-only podgląd kandydata z detekcji).
 *
 * add:  POST /api/books, „Wyszukaj po danych" → /api/books/candidates → prefill,
 *       „Wyszukaj okładkę" → /api/books/cover-suggestion?isbn= (read-only).
 * edit: PATCH /api/books/:id, identyczne wyszukiwanie kandydatów + CoverEditor
 *       (własny save przez /api/books/:id, osobno od metadanych).
 * propose: read-only pola, „Szukaj w sieci", brak zapisu.
 */
export default function BookModal({ mode, shelfId, book, onSaved, onClose }: BookModalProps) {
  const [fields, setFields] = useState<BookFieldValues>(() => bookToFields(book));
  // Stan okładki dla trybu add (lifted z CoverEditor) — sloty trafiają do POST przy „Dodaj".
  const [addSource, setAddSource] = useState<CoverSource>(book?.cover_source ?? 'auto');
  const [addAutoUrl, setAddAutoUrl] = useState<string | null>(book?.cover_url ?? book?.coverUrl ?? null);
  const [addUserUrl, setAddUserUrl] = useState<string>(book?.user_cover_url ?? '');
  const [addPhotoUrl, setAddPhotoUrl] = useState<string | null>(book?.cover_photo_url ?? null);
  const [displayCover, setDisplayCover] = useState<string | null>(
    book ? (effectiveCover({
      cover_url: book.cover_url ?? book.coverUrl ?? null,
      user_cover_url: book.user_cover_url ?? null,
      cover_photo_url: book.cover_photo_url ?? null,
      cover_source: book.cover_source ?? 'auto',
    })) : null
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleField(field: keyof BookFieldValues, value: string) {
    setFields((prev) => ({ ...prev, [field]: value }));
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
    if (c.coverUrl) {
      setAddAutoUrl(c.coverUrl);
      setAddSource('auto');
      setDisplayCover(c.coverUrl);
    }
  }

  // Lift zmian z CoverEditor (tryb add) do stanu + podgląd.
  function handleAddCoverChange(patch: CoverEditorPatch) {
    const nextSource = patch.source ?? addSource;
    const nextAuto = patch.autoUrl !== undefined ? patch.autoUrl : addAutoUrl;
    const nextUser = patch.userUrl !== undefined ? patch.userUrl : addUserUrl;
    const nextPhoto = patch.photoUrl !== undefined ? patch.photoUrl : addPhotoUrl;
    if (patch.source !== undefined) setAddSource(patch.source);
    if (patch.autoUrl !== undefined) setAddAutoUrl(patch.autoUrl);
    if (patch.userUrl !== undefined) setAddUserUrl(patch.userUrl);
    if (patch.photoUrl !== undefined) setAddPhotoUrl(patch.photoUrl);
    setDisplayCover(pickCover(nextSource, nextAuto, nextUser, nextPhoto));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!fields.title.trim()) return;
    setBusy(true);
    setErr(null);
    const parsed = parseFields(fields);

    try {
      let res: Response;
      if (mode === 'add') {
        if (!shelfId) { setErr('Brak shelf_id.'); return; }
        // AddPurchaseSchema uses .optional() (not .nullish()) — strip null fields so Zod accepts them.
        // Sloty okładki: cover_source zawsze; pozostałe tylko gdy mają wartość (unify-add-cover).
        const coverFields: Record<string, string> = { cover_source: addSource };
        if (addAutoUrl) coverFields.cover_url = addAutoUrl;
        if (addUserUrl.trim()) coverFields.user_cover_url = addUserUrl.trim();
        if (addPhotoUrl) coverFields.cover_photo_url = addPhotoUrl;
        const postBody = Object.fromEntries(
          Object.entries({ ...parsed, shelf_id: shelfId, ...coverFields })
            .filter(([, v]) => v !== null)
        );
        res = await fetch('/api/books', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(postBody),
        });
      } else {
        if (!book?.id) { setErr('Brak book id.'); return; }
        res = await fetch(`/api/books/${book.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        });
      }

      const json = (await res.json()) as { error?: { message?: string } };
      if (res.status === 409) { setErr(json.error?.message ?? 'Masz już tę książkę w katalogu.'); return; }
      if (!res.ok) { setErr(json.error?.message ?? `Błąd zapisu (${res.status})`); return; }
      onSaved?.();
      onClose();
    } catch {
      setErr('Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  const editSlots: CoverSlots | undefined =
    mode === 'edit' && book?.id
      ? {
          cover_url: book.cover_url ?? null,
          user_cover_url: book.user_cover_url ?? null,
          cover_photo_url: book.cover_photo_url ?? null,
          cover_source: book.cover_source ?? 'auto',
          isbn: book.isbn13 ?? book.isbn10 ?? null,
        }
      : undefined;

  const authorsDisplay = (book?.authors ?? []).join(', ');
  const sourceLabel = book?.source ? (SOURCE_LABELS[book.source] ?? book.source) : null;
  const canEdit = mode !== 'propose';

  const MODAL_TITLES: Record<BookModalProps['mode'], string> = {
    add: 'Dodaj książkę',
    edit: 'Edytuj książkę',
    propose: book?.title ?? 'Podgląd książki',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        data-testid="book-modal"
        role="dialog"
        aria-modal="true"
        aria-label={MODAL_TITLES[mode]}
        className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Nagłówek */}
        <div className="mb-4 flex items-center justify-between">
          <h2 data-testid="book-modal-title" className="text-base font-bold text-gray-900 dark:text-gray-50">
            {MODAL_TITLES[mode]}
          </h2>
          <button
            data-testid="book-modal-close"
            onClick={onClose}
            aria-label="Zamknij"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave} noValidate>
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* Lewa kolumna — okładka */}
            <div className="flex flex-col items-center gap-2">
              <CoverLarge url={displayCover} alt={authorsDisplay ? `${fields.title} — ${authorsDisplay}` : fields.title} />

              {mode === 'add' && (
                <CoverEditor
                  mode="add"
                  isbn={fields.isbn13 || fields.isbn10}
                  source={addSource}
                  autoUrl={addAutoUrl}
                  userUrl={addUserUrl}
                  photoUrl={addPhotoUrl}
                  testIdPrefix="add-cover"
                  onChange={handleAddCoverChange}
                />
              )}

              {mode === 'edit' && editSlots && book?.id && (
                <EditCoverSection
                  bookId={book.id}
                  slots={editSlots}
                  onPreview={setDisplayCover}
                  onApplied={(patch) => { if (patch.cover_url) setDisplayCover(patch.cover_url); }}
                />
              )}
            </div>

            {/* Prawa kolumna — pola i akcje */}
            <div className="min-w-0 flex-1 space-y-3">

              {/* Metadane */}
              <BookFields values={fields} onChange={canEdit ? handleField : undefined} readOnly={!canEdit} />

              {/* Dodatkowe info w propose mode */}
              {mode === 'propose' && (
                <dl className="space-y-1 text-sm">
                  {book?.spineColor && (
                    <div className="flex gap-2">
                      <dt className="w-24 flex-shrink-0 text-gray-400">Kolor grzbietu</dt>
                      <dd className="font-medium text-gray-800 dark:text-gray-100">{book.spineColor}</dd>
                    </div>
                  )}
                  {sourceLabel && (
                    <div className="flex gap-2">
                      <dt className="w-24 flex-shrink-0 text-gray-400">Źródło</dt>
                      <dd className="font-medium text-gray-800 dark:text-gray-100">{sourceLabel}</dd>
                    </div>
                  )}
                  {book?.matchScore != null && (
                    <div className="flex gap-2">
                      <dt className="w-24 flex-shrink-0 text-gray-400">Pewność</dt>
                      <dd className="font-medium text-gray-800 dark:text-gray-100">{Math.round(book.matchScore * 100)}%</dd>
                    </div>
                  )}
                </dl>
              )}

              {/* Panel wyszukiwania kandydatów (add + edit). hideForm w OBU trybach:
                  główny formularz już ma pola tytuł/ISBN/autor, więc panel szuka po nich
                  (auto-search po toggle) zamiast renderować zdublowane inputy. */}
              {canEdit && (
                <SearchPanel
                  initialTitle={fields.title}
                  initialIsbn={fields.isbn13 || fields.isbn10}
                  hideForm={canEdit}
                  onSelect={handleCandidateSelect}
                />
              )}

              {/* Przyciski akcji */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {/* W trybie add — tylko gdy cokolwiek wpisano */}
                {(mode !== 'add' || fields.title.trim() || fields.isbn13.trim() || fields.isbn10.trim() || fields.authors.trim()) && (
                  <a
                    data-testid="book-modal-web-search"
                    href={googleSearchUrl(fields)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-300 dark:hover:bg-sky-900/40"
                  >
                    Szukaj w sieci
                  </a>
                )}

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

              {/* Błąd zapisu */}
              {err && (
                <p data-testid="book-modal-error" className="text-xs text-red-600 dark:text-red-400" role="alert">
                  {err}
                </p>
              )}

              {/* Zapisz / Anuluj */}
              {canEdit && (
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    data-testid="book-modal-save"
                    disabled={busy || !fields.title.trim()}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy ? 'Zapisuję...' : mode === 'add' ? 'Dodaj na półkę' : 'Zapisz'}
                  </button>
                  <button
                    type="button"
                    data-testid="book-modal-cancel"
                    onClick={onClose}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
                  >
                    Anuluj
                  </button>
                </div>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
