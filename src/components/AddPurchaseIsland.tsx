import { useEffect, useState } from 'react';
import type { ShelfDTO } from '../lib/shelves/schema';

type Method = 'manual' | 'photo';

/** YYYY-MM-DD dla dziś (lokalna data) — domyślna wartość pola daty zakupu. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Flow B (S-06) — „Dodaj zakup". Toggle metody:
 *  - ręcznie: minimalny formularz (title wymagany) → POST /api/books → redirect na Zakupione
 *  - zdjęcie: link do /upload?shelf=<Zakupione> (istniejący pipeline)
 * Minimalizm pod KPI Time-to-add-purchase ≤ 90 s.
 */
export default function AddPurchaseIsland() {
  const [method, setMethod] = useState<Method>('manual');
  const [purchasedShelfId, setPurchasedShelfId] = useState<string | null>(null);

  // pola formularza
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayISO());
  const [showMore, setShowMore] = useState(false);
  const [publisher, setPublisher] = useState('');
  const [year, setYear] = useState('');
  const [isbn, setIsbn] = useState('');

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pobierz id „Zakupione" (do linku ścieżki zdjęcia).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/shelves');
        if (!res.ok) return;
        const json = (await res.json()) as { data: { shelves: ShelfDTO[] } };
        const zak = json.data.shelves.find((s) => s.is_system);
        if (zak) setPurchasedShelfId(zak.id);
      } catch {
        // link do zdjęcia spadnie do /upload (Zakupione i tak sortuje first)
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const body: Record<string, unknown> = { title: title.trim() };
      if (author.trim()) body.authors = author.split(',').map((a) => a.trim()).filter(Boolean);
      if (purchaseDate) body.purchase_date = purchaseDate;
      if (publisher.trim()) body.publisher = publisher.trim();
      if (year.trim()) body.published_year = parseInt(year, 10);
      if (isbn.trim()) {
        const clean = isbn.replace(/[\s-]/g, '');
        if (clean.length === 13) body.isbn_13 = clean;
        else if (clean.length === 10) body.isbn_10 = clean;
      }

      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data?: { shelf_id: string }; error?: { message?: string } };
      if (res.status === 409) {
        setErrorMsg(json.error?.message ?? 'Masz już tę książkę w katalogu.');
        return;
      }
      if (!res.ok || !json.data) {
        setErrorMsg(json.error?.message ?? `Błąd (${res.status})`);
        return;
      }
      window.location.href = `/shelves/${json.data.shelf_id}`;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  const photoHref = purchasedShelfId ? `/upload?shelf=${purchasedShelfId}` : '/upload';

  return (
    <div data-testid="add-purchase">
      {/* Toggle metody */}
      <div className="mb-4 flex gap-2" role="tablist">
        <button
          data-testid="method-manual"
          role="tab"
          aria-selected={method === 'manual'}
          onClick={() => setMethod('manual')}
          className={`rounded-md px-4 py-2 text-sm font-medium ${method === 'manual' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Wpisz ręcznie
        </button>
        <button
          data-testid="method-photo"
          role="tab"
          aria-selected={method === 'photo'}
          onClick={() => setMethod('photo')}
          className={`rounded-md px-4 py-2 text-sm font-medium ${method === 'photo' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Zdjęcie stosu
        </button>
      </div>

      {method === 'photo' ? (
        <div data-testid="photo-method" className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="mb-3 text-sm text-gray-600">
            Zrób zdjęcie stosu książek — system rozpozna grzbiety i zaproponuje wpisy. Trafią na
            półkę &bdquo;Zakupione&rdquo;.
          </p>
          <a
            data-testid="photo-upload-link"
            href={photoHref}
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Przejdź do skanowania →
          </a>
        </div>
      ) : (
        <form data-testid="manual-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Tytuł <span className="text-red-500">*</span>
            </label>
            <input
              data-testid="purchase-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Autor(zy) <span className="text-gray-400">(przecinek oddziela)</span>
            </label>
            <input
              data-testid="purchase-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Data zakupu</label>
            <input
              data-testid="purchase-date"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          {!showMore ? (
            <button
              type="button"
              data-testid="show-more"
              onClick={() => setShowMore(true)}
              className="text-xs text-blue-600 underline hover:text-blue-800"
            >
              + więcej (wydawnictwo, rok, ISBN)
            </button>
          ) : (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div>
                <label className="block text-xs font-medium text-gray-700">Wydawnictwo</label>
                <input
                  data-testid="purchase-publisher"
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              <div className="flex gap-2">
                <div className="w-28">
                  <label className="block text-xs font-medium text-gray-700">Rok</label>
                  <input
                    data-testid="purchase-year"
                    type="number"
                    min="1000"
                    max="2100"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700">ISBN</label>
                  <input
                    data-testid="purchase-isbn"
                    value={isbn}
                    onChange={(e) => setIsbn(e.target.value)}
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <p data-testid="purchase-error" className="text-sm text-red-600" role="alert">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            data-testid="purchase-submit"
            disabled={busy || !title.trim()}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? 'Dodaję...' : 'Dodaj do „Zakupione"'}
          </button>
        </form>
      )}
    </div>
  );
}
