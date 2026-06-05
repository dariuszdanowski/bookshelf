import { useEffect, useState } from 'react';
import { largeCoverUrl, effectiveCover } from '../lib/books/cover';
import type { CoverSource, BookCoverPatch } from '../lib/books/schema';
import { createBrowserSupabaseClient } from '../lib/db/supabase.browser';

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

// Surowe sloty okładki + ISBN — do panelu edycji (tylko książki zatwierdzone).
export type CoverSlots = {
  cover_url: string | null;
  user_cover_url: string | null;
  cover_photo_url: string | null;
  cover_source: CoverSource;
  isbn: string | null;
};

const MAX_COVER_BYTES = 15 * 1024 * 1024; // 15 MB jak PhotoUploader

const SOURCE_LABELS: Record<string, string> = {
  google_books: 'Google Books',
  open_library: 'OpenLibrary',
  national_library: 'Biblioteka Narodowa',
  manual: 'Wpis ręczny',
};

const COVER_SOURCE_LABELS: Record<CoverSource, string> = {
  auto: 'Automatyczna',
  url: 'Wklejony URL',
  photo: 'Wgrane zdjęcie',
};

function CoverLarge({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const big = largeCoverUrl(url);
  // reset błędu gdy url się zmienia (live-preview w edytorze)
  useEffect(() => setFailed(false), [big]);
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

// ---------------------------------------------------------------------------
// Panel edycji okładki (S-33) — 3 sloty (auto / URL / zdjęcie) + flaga wyboru.
// Tylko dla książek zatwierdzonych (mają books.id). Live-preview przez onPreview.
// ---------------------------------------------------------------------------
function CoverEditor({
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
  const [urlDraft, setUrlDraft] = useState(slots.user_cover_url ?? '');
  const [photoUrl, setPhotoUrl] = useState(slots.cover_photo_url);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const draftSlot: Record<CoverSource, string | null> = {
    auto: autoUrl,
    url: urlDraft.trim() || null,
    photo: photoUrl,
  };

  function preview(nextSource: CoverSource, override?: Partial<Record<CoverSource, string | null>>) {
    const merged = { ...draftSlot, ...override };
    onPreview(merged[nextSource] ?? merged.auto ?? merged.url ?? merged.photo ?? null);
  }

  function selectSource(s: CoverSource) {
    setSource(s);
    preview(s);
  }

  async function handleUpload(file: File) {
    if (file.size > MAX_COVER_BYTES) {
      setErr('Plik za duży (max 15 MB).');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        setErr('Brak sesji — zaloguj się ponownie.');
        return;
      }
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const path = `${uid}/${bookId}-${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('book-covers')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (error) {
        setErr(error.message);
        return;
      }
      const { data: pub } = supabase.storage.from('book-covers').getPublicUrl(path);
      setPhotoUrl(pub.publicUrl);
      setSource('photo');
      preview('photo', { photo: pub.publicUrl });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Błąd uploadu.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoCheck() {
    setChecking(true);
    setErr(null);
    try {
      const res = await fetch(`/api/books/${bookId}/cover-suggestion`);
      const json = (await res.json()) as { data?: { cover_url: string | null }; error?: { message?: string } };
      if (!res.ok) {
        setErr(json.error?.message ?? 'Błąd sprawdzania okładki.');
        return;
      }
      const found = json.data?.cover_url ?? null;
      if (found) {
        setAutoUrl(found);
        setSource('auto');
        preview('auto', { auto: found });
      } else {
        setErr('Nie znaleziono okładki automatycznie dla tego ISBN.');
      }
    } catch {
      setErr('Błąd sieci.');
    } finally {
      setChecking(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setErr(null);
    const newUserUrl = urlDraft.trim() || null;
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
      if (!res.ok) {
        setErr(json.error?.message ?? `Błąd zapisu (${res.status})`);
        return;
      }
      // autoUrl mógł zostać zaktualizowany przez „sprawdź automatycznie" (już w DB)
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
        data-testid="cover-edit-toggle"
        onClick={() => setOpen(true)}
        className="mt-4 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
      >
        Zmień okładkę
      </button>
    );
  }

  return (
    <div
      data-testid="cover-editor"
      className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
    >
      <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Pokaż jako okładkę:</p>
      <div role="group" aria-label="Wybór okładki" className="flex flex-wrap gap-1">
        {(['auto', 'url', 'photo'] as CoverSource[]).map((s) => {
          const active = source === s;
          const hasData = draftSlot[s] != null;
          return (
            <button
              key={s}
              type="button"
              data-testid={`cover-source-${s}`}
              aria-pressed={active}
              onClick={() => selectSource(s)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                active
                  ? 'border-blue-400 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'border-gray-300 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {COVER_SOURCE_LABELS[s]}
              {!hasData && <span className="ml-1 text-gray-400">(brak)</span>}
            </button>
          );
        })}
      </div>

      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        URL okładki (wklej link, np. ze „Szukaj w sieci”)
        <input
          data-testid="cover-url-input"
          value={urlDraft}
          onChange={(e) => {
            setUrlDraft(e.target.value);
            const v = e.target.value.trim() || null;
            if (source === 'url') onPreview(v);
          }}
          placeholder="https://..."
          className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200">
          {busy ? 'Wgrywam...' : 'Wgraj zdjęcie'}
          <input
            data-testid="cover-upload-input"
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
            }}
          />
        </label>
        <button
          type="button"
          data-testid="cover-autocheck"
          disabled={checking || !slots.isbn}
          onClick={() => void handleAutoCheck()}
          title={slots.isbn ? 'Szukaj okładki po ISBN (OpenLibrary + Google Books)' : 'Brak ISBN'}
          className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300"
        >
          {checking ? 'Sprawdzam...' : 'Sprawdź okładkę automatycznie'}
        </button>
      </div>

      {err && (
        <p data-testid="cover-editor-error" className="text-xs text-red-600 dark:text-red-400" role="alert">
          {err}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="cover-save"
          disabled={busy}
          onClick={() => void handleSave()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Zapisuję...' : 'Zapisz'}
        </button>
        <button
          type="button"
          data-testid="cover-cancel"
          onClick={() => {
            setOpen(false);
            onPreview(effectiveCover(slots));
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          Anuluj
        </button>
      </div>
    </div>
  );
}

function googleSearchUrl(title: string, authors: string[]): string {
  const q = [title, ...authors].filter(Boolean).join(' ').trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

type IdentCandidate = {
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

// Miniatura okładki kandydata — placeholder przy braku URL ORAZ przy błędzie
// ładowania (OL z ?default=false zwraca 404 gdy nie ma okładki → bez onError
// pokazywałby połamany obrazek).
function CoverThumb({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span
        data-testid="ident-cover-placeholder"
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
// Panel „Szukaj po tytule" / re-identyfikacja (S-33) — ta sama funkcja co w
// propozycjach, ale dla zatwierdzonej książki. Szuka w GB/OL/BN, user wybiera
// trafienie → nadpisuje metadane + okładkę. Po zastosowaniu: reload strony.
// ---------------------------------------------------------------------------
function IdentifyPanel({
  bookId,
  initialTitle,
  initialAuthor,
  onApplied,
}: {
  bookId: string;
  initialTitle: string;
  initialAuthor: string;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState(initialAuthor);
  const [candidates, setCandidates] = useState<IdentCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/books/${bookId}/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'search', title: title.trim(), author: author.trim() || null }),
      });
      const json = (await res.json()) as { data?: { candidates: IdentCandidate[] }; error?: { message?: string } };
      if (res.status === 429) {
        setErr('Rate limit, spróbuj za chwilę.');
        return;
      }
      if (!res.ok) {
        setErr(json.error?.message ?? 'Błąd wyszukiwania.');
        return;
      }
      setCandidates(json.data?.candidates ?? []);
    } catch {
      setErr('Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  async function apply(c: IdentCandidate) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/books/${bookId}/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'apply',
          candidate: {
            title: c.title,
            authors: c.authors,
            isbn13: c.isbn13,
            isbn10: c.isbn10,
            publisher: c.publisher,
            publishedYear: c.publishedYear,
            coverUrl: c.coverUrl,
            source: c.source,
            externalId: c.externalId,
          },
        }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setErr(json.error?.message ?? 'Błąd zapisu.');
        return;
      }
      onApplied();
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
        data-testid="identify-toggle"
        onClick={() => setOpen(true)}
        className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
      >
        Szukaj po tytule
      </button>
    );
  }

  return (
    <div data-testid="identify-panel" className="mt-3 w-full space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
      <form onSubmit={search} className="space-y-2">
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Tytuł
          <input
            data-testid="identify-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            required
          />
        </label>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Autor (opcjonalnie)
          <input
            data-testid="identify-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            data-testid="identify-search"
            disabled={busy || !title.trim()}
            className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? 'Szukam...' : 'Szukaj'}
          </button>
          <button
            type="button"
            data-testid="identify-cancel"
            onClick={() => setOpen(false)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            Zamknij
          </button>
        </div>
      </form>

      {err && (
        <p data-testid="identify-error" className="text-xs text-red-600 dark:text-red-400" role="alert">
          {err}
        </p>
      )}

      {candidates != null && candidates.length === 0 && (
        <p data-testid="identify-no-results" className="text-xs text-amber-600">
          Nie znaleziono wyników. Spróbuj zmienić tytuł/autora albo „Szukaj w sieci”.
        </p>
      )}

      {candidates != null && candidates.length > 0 && (
        <ul data-testid="identify-results" className="space-y-1">
          {candidates.map((c, i) => (
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
                data-testid={`identify-apply-${i}`}
                disabled={busy}
                onClick={() => void apply(c)}
                className="flex-shrink-0 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Użyj
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ręczna edycja danych książki (S-33) — user jest ostateczną instancją; automaty
// to tylko propozycje. Edytuje tytuł/autorów/wydawcę/rok/ISBN. Po zapisie reload.
// ---------------------------------------------------------------------------
function MetadataEditor({
  bookId,
  initial,
  onApplied,
}: {
  bookId: string;
  initial: { title: string; authors: string; publisher: string; year: string; isbn13: string; isbn10: string };
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [authors, setAuthors] = useState(initial.authors);
  const [publisher, setPublisher] = useState(initial.publisher);
  const [year, setYear] = useState(initial.year);
  const [isbn13, setIsbn13] = useState(initial.isbn13);
  const [isbn10, setIsbn10] = useState(initial.isbn10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          authors: authors.split(',').map((a) => a.trim()).filter(Boolean),
          publisher: publisher.trim() || null,
          published_year: year.trim() ? parseInt(year, 10) : null,
          isbn_13: isbn13.trim() || null,
          isbn_10: isbn10.trim() || null,
        }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setErr(json.error?.message ?? `Błąd zapisu (${res.status})`);
        return;
      }
      onApplied();
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
        data-testid="metadata-edit-toggle"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
      >
        Edytuj dane
      </button>
    );
  }

  const inputCls =
    'mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
  return (
    <form data-testid="metadata-editor" onSubmit={save} className="mt-3 w-full space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Tytuł <span className="text-red-500">*</span>
        <input data-testid="meta-title" value={title} onChange={(e) => setTitle(e.target.value)} required className={inputCls} />
      </label>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Autor(zy) <span className="text-gray-400">(przecinki)</span>
        <input data-testid="meta-authors" value={authors} onChange={(e) => setAuthors(e.target.value)} className={inputCls} />
      </label>
      <div className="flex gap-2">
        <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          Wydawca
          <input data-testid="meta-publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} className={inputCls} />
        </label>
        <label className="w-20 text-xs font-medium text-gray-700 dark:text-gray-300">
          Rok
          <input data-testid="meta-year" type="number" min="1000" max="2100" value={year} onChange={(e) => setYear(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          ISBN-13
          <input data-testid="meta-isbn13" value={isbn13} onChange={(e) => setIsbn13(e.target.value)} placeholder="9788300000000" className={inputCls} />
        </label>
        <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          ISBN-10
          <input data-testid="meta-isbn10" value={isbn10} onChange={(e) => setIsbn10(e.target.value)} className={inputCls} />
        </label>
      </div>
      {err && (
        <p data-testid="metadata-error" className="text-xs text-red-600 dark:text-red-400" role="alert">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" data-testid="metadata-save" disabled={busy || !title.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Zapisuję...' : 'Zapisz'}
        </button>
        <button type="button" data-testid="metadata-cancel" onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
          Anuluj
        </button>
      </div>
    </form>
  );
}

/**
 * Modal ze szczegółami książki — duża okładka + tytuł, autorzy, ISBN, rok,
 * wydawca, źródło. Wspólny dla propozycji i książek zatwierdzonych (jednolity
 * dostęp przez klik w okładkę). Dla zatwierdzonych (editableBookId) dochodzi
 * ręczna edycja danych, panel okładki (URL / upload / auto), „Szukaj po tytule"
 * (identyfikacja) i link do źródłowego zdjęcia. Zamknięcie: Esc lub klik w tło.
 */
export default function BookDetailModal({
  book,
  onClose,
  editableBookId,
  coverSlots,
  onCoverUpdated,
  sourcePhotoId,
}: {
  book: BookDetailData;
  onClose: () => void;
  editableBookId?: string;
  coverSlots?: CoverSlots;
  onCoverUpdated?: (patch: BookCoverPatch) => void;
  sourcePhotoId?: string | null;
}) {
  const [displayCover, setDisplayCover] = useState<string | null>(book.coverUrl);

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
  const canEdit = Boolean(editableBookId && coverSlots);

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
          <div className="flex flex-col items-center">
            <CoverLarge url={displayCover} alt={authorsStr ? `${book.title} — ${authorsStr}` : book.title} />
            {canEdit && (
              <CoverEditor
                bookId={editableBookId!}
                slots={coverSlots!}
                onPreview={setDisplayCover}
                onApplied={(patch) => {
                  onCoverUpdated?.(patch);
                }}
              />
            )}
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

            {/* Akcje: szukaj w sieci (zawsze), zdjęcie półki + identyfikacja (książki zatwierdzone) */}
            <div className="mt-4 flex flex-wrap items-start gap-2">
              <a
                data-testid="modal-web-search"
                href={googleSearchUrl(book.title, book.authors)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-300 dark:hover:bg-sky-900/40"
              >
                Szukaj w sieci
              </a>
              {sourcePhotoId && (
                <a
                  data-testid="modal-source-photo"
                  href={`/photos/${sourcePhotoId}`}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                >
                  Źródłowe zdjęcie
                </a>
              )}
              {editableBookId && (
                <MetadataEditor
                  bookId={editableBookId}
                  initial={{
                    title: book.title,
                    authors: authorsStr,
                    publisher: book.publisher ?? '',
                    year: book.publishedYear != null ? String(book.publishedYear) : '',
                    isbn13: book.isbn13 ?? '',
                    isbn10: book.isbn10 ?? '',
                  }}
                  onApplied={() => window.location.reload()}
                />
              )}
              {editableBookId && (
                <IdentifyPanel
                  bookId={editableBookId}
                  initialTitle={book.title}
                  initialAuthor={authorsStr}
                  onApplied={() => window.location.reload()}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
