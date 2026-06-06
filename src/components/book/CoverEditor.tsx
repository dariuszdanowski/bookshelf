import { useState } from 'react';
import { createBrowserSupabaseClient } from '../../lib/db/supabase.browser';
import type { CoverSource } from '../../lib/books/schema';

const MAX_COVER_BYTES = 15 * 1024 * 1024;

const COVER_SOURCE_LABELS: Record<CoverSource, string> = {
  auto: 'Automatyczna',
  url: 'Wklejony URL',
  photo: 'Wgrane zdjęcie',
};

export type CoverEditorPatch = {
  source?: CoverSource;
  autoUrl?: string | null;
  userUrl?: string;
  photoUrl?: string | null;
};

/**
 * Wspólny, kontrolowany edytor okładki — identyczny UI w trybie add i edit
 * (3 sloty: Automatyczna / Wklejony URL / Wgrane zdjęcie + flaga źródła, pole URL,
 * upload, „Sprawdź okładkę automatycznie"). Stan trzyma rodzic; CoverEditor zgłasza
 * zmiany przez `onChange`. Różnice trybu sparametryzowane:
 *  - autocheck: edit → GET /api/books/:id/cover-suggestion (zapisuje), add → GET
 *    /api/books/cover-suggestion?isbn= (read-only).
 *  - ścieżka uploadu: edit `{uid}/{bookId}-{uuid}`, add `{uid}/{uuid}` (RLS po uid).
 * Bez przycisku zapisu — zapis robi rodzic (add: POST przy „Dodaj"; edit: osobny PATCH).
 */
export default function CoverEditor({
  mode,
  bookId,
  isbn,
  source,
  autoUrl,
  userUrl,
  photoUrl,
  testIdPrefix,
  onChange,
}: {
  mode: 'add' | 'edit';
  bookId?: string;
  isbn: string | null;
  source: CoverSource;
  autoUrl: string | null;
  userUrl: string;
  photoUrl: string | null;
  testIdPrefix: string;
  onChange: (patch: CoverEditorPatch) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slotData: Record<CoverSource, string | null> = {
    auto: autoUrl,
    url: userUrl.trim() || null,
    photo: photoUrl,
  };

  async function handleUpload(file: File) {
    if (file.size > MAX_COVER_BYTES) { setErr('Plik za duży (max 15 MB).'); return; }
    setBusy(true);
    setErr(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) { setErr('Brak sesji — zaloguj się ponownie.'); return; }
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const path = mode === 'edit' && bookId
        ? `${uid}/${bookId}-${crypto.randomUUID()}.${ext}`
        : `${uid}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('book-covers')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (error) { setErr(error.message); return; }
      const { data: pub } = supabase.storage.from('book-covers').getPublicUrl(path);
      onChange({ photoUrl: pub.publicUrl, source: 'photo' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Błąd uploadu.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoCheck() {
    const isbnVal = (isbn ?? '').trim();
    if (mode === 'add' && !isbnVal) return;
    setChecking(true);
    setErr(null);
    try {
      const url = mode === 'edit' && bookId
        ? `/api/books/${bookId}/cover-suggestion`
        : `/api/books/cover-suggestion?isbn=${encodeURIComponent(isbnVal)}`;
      const res = await fetch(url);
      const json = (await res.json()) as { data?: { cover_url: string | null }; error?: { message?: string } };
      if (!res.ok) { setErr(json.error?.message ?? 'Błąd sprawdzania okładki.'); return; }
      const found = json.data?.cover_url ?? null;
      if (found) onChange({ autoUrl: found, source: 'auto' });
      else setErr('Nie znaleziono okładki automatycznie dla tego ISBN.');
    } catch {
      setErr('Błąd sieci.');
    } finally {
      setChecking(false);
    }
  }

  const isbnReady = !!(isbn ?? '').trim();

  return (
    <div
      data-testid={`${testIdPrefix}-section`}
      className="mt-2 w-full space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
    >
      <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Pokaż jako okładkę:</p>
      <div role="group" aria-label="Wybór okładki" className="flex flex-wrap gap-1">
        {(['auto', 'url', 'photo'] as CoverSource[]).map((s) => {
          const active = source === s;
          const hasData = slotData[s] != null;
          return (
            <button
              key={s}
              type="button"
              data-testid={`${testIdPrefix}-source-${s}`}
              aria-pressed={active}
              onClick={() => onChange({ source: s })}
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
        URL okładki
        <input
          data-testid={`${testIdPrefix}-url-input`}
          value={userUrl}
          onChange={(e) => onChange({ userUrl: e.target.value })}
          placeholder="https://..."
          className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200">
          {busy ? 'Wgrywam...' : 'Wgraj zdjęcie'}
          <input
            data-testid={`${testIdPrefix}-upload`}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }}
          />
        </label>
        <button
          type="button"
          data-testid={`${testIdPrefix}-autocheck`}
          disabled={checking || !isbnReady}
          onClick={() => void handleAutoCheck()}
          title={isbnReady ? 'Szukaj okładki po ISBN' : 'Najpierw wpisz ISBN'}
          className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300"
        >
          {checking ? 'Sprawdzam...' : 'Sprawdź okładkę automatycznie'}
        </button>
      </div>

      {err && <p data-testid={`${testIdPrefix}-error`} className="text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}
    </div>
  );
}
