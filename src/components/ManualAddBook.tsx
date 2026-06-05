import { useState } from 'react';

/**
 * Ręczne dodanie książki na półkę — bez zdjęcia, bez analizy (S-33). User definiuje
 * zawartość półki sam. POST /api/books z shelf_id bieżącej półki. Po sukcesie:
 * onAdded() (rodzic odświeża listę).
 */
export default function ManualAddBook({ shelfId, onAdded }: { shelfId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [publisher, setPublisher] = useState('');
  const [year, setYear] = useState('');
  const [isbn13, setIsbn13] = useState('');
  const [isbn10, setIsbn10] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setTitle('');
    setAuthors('');
    setPublisher('');
    setYear('');
    setIsbn13('');
    setIsbn10('');
    setCoverUrl('');
    setErr(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = { title: title.trim(), shelf_id: shelfId };
    const a = authors.split(',').map((x) => x.trim()).filter(Boolean);
    if (a.length) body.authors = a;
    if (publisher.trim()) body.publisher = publisher.trim();
    if (year.trim()) body.published_year = parseInt(year, 10);
    if (isbn13.trim()) body.isbn_13 = isbn13.trim();
    if (isbn10.trim()) body.isbn_10 = isbn10.trim();
    if (coverUrl.trim()) body.cover_url = coverUrl.trim();
    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (res.status === 409) {
        setErr(json.error?.message ?? 'Masz już tę książkę w katalogu.');
        return;
      }
      if (!res.ok) {
        setErr(json.error?.message ?? `Błąd dodawania (${res.status})`);
        return;
      }
      reset();
      setOpen(false);
      onAdded();
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
        data-testid="manual-add-toggle"
        onClick={() => setOpen(true)}
        className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
      >
        + Dodaj książkę ręcznie
      </button>
    );
  }

  const inputCls =
    'mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
  return (
    <form
      data-testid="manual-add-form"
      onSubmit={submit}
      className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
    >
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Dodaj książkę ręcznie (bez zdjęcia)</p>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Tytuł <span className="text-red-500">*</span>
        <input data-testid="manual-title" value={title} onChange={(e) => setTitle(e.target.value)} required className={inputCls} />
      </label>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Autor(zy) <span className="text-gray-400">(przecinki)</span>
        <input data-testid="manual-authors" value={authors} onChange={(e) => setAuthors(e.target.value)} className={inputCls} />
      </label>
      <div className="flex gap-2">
        <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          Wydawca
          <input data-testid="manual-publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} className={inputCls} />
        </label>
        <label className="w-20 text-xs font-medium text-gray-700 dark:text-gray-300">
          Rok
          <input data-testid="manual-year" type="number" min="1000" max="2100" value={year} onChange={(e) => setYear(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          ISBN-13
          <input data-testid="manual-isbn13" value={isbn13} onChange={(e) => setIsbn13(e.target.value)} className={inputCls} />
        </label>
        <label className="flex-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          ISBN-10
          <input data-testid="manual-isbn10" value={isbn10} onChange={(e) => setIsbn10(e.target.value)} className={inputCls} />
        </label>
      </div>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        URL okładki <span className="text-gray-400">(opcjonalnie)</span>
        <input data-testid="manual-cover" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://..." className={inputCls} />
      </label>
      {err && (
        <p data-testid="manual-add-error" className="text-xs text-red-600 dark:text-red-400" role="alert">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" data-testid="manual-add-submit" disabled={busy || !title.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Dodaję...' : 'Dodaj na półkę'}
        </button>
        <button type="button" data-testid="manual-add-cancel" onClick={() => { reset(); setOpen(false); }} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
          Anuluj
        </button>
      </div>
    </form>
  );
}
