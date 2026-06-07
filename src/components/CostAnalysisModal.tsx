import { useEffect, useState } from 'react';

import { formatCost, formatDate, formatLatency } from '../lib/costs/format';
import { useBodyScrollLock } from './useBodyScrollLock';

type KeyInfo = { id: string; label: string };

type CostEventItem = {
  id: string;
  kind: 'vision' | 'refine';
  model: string | null;
  cost_usd: number | null;
  latency_ms: number | null;
  created_at: string;
  api_key_id: string | null;
  photo_id: string | null;
  detection_id: string | null;
  raw_title: string | null;
};

type ApiResponse = {
  items: CostEventItem[];
  page: number;
  page_size: number;
  total_count: number;
  total_cost_usd: number;
};

type FilterKey = string | 'none' | '';
type FilterType = '' | 'vision' | 'refine';
type FilterPeriod = '' | '7d' | '30d';

type Props = {
  keys: KeyInfo[];
  initialKeyId?: string;
  onClose: () => void;
};

export default function CostAnalysisModal({ keys, initialKeyId, onClose }: Props) {
  useBodyScrollLock();

  const [filterKey, setFilterKey] = useState<FilterKey>(initialKeyId ?? '');
  const [filterType, setFilterType] = useState<FilterType>('');
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filterKey) params.set('key', filterKey);
    if (filterType) params.set('type', filterType);
    if (filterPeriod) params.set('period', filterPeriod);
    if (page > 1) params.set('page', String(page));

    fetch(`/api/account/costs?${params.toString()}`)
      .then((r) => r.json() as Promise<{ data: ApiResponse } | { error: { message: string } }>)
      .then((json) => {
        if (cancelled) return;
        if ('data' in json) setData(json.data);
        else setError(('error' in json ? json.error.message : null) ?? 'Błąd pobierania danych.');
      })
      .catch(() => {
        if (!cancelled) setError('Błąd sieci.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filterKey, filterType, filterPeriod, page]);

  function handleFilterKey(val: FilterKey) {
    setFilterKey(val);
    setPage(1);
  }
  function handleFilterType(val: FilterType) {
    setFilterType(val);
    setPage(1);
  }
  function handleFilterPeriod(val: FilterPeriod) {
    setFilterPeriod(val);
    setPage(1);
  }

  function keyLabel(apiKeyId: string | null): string {
    if (!apiKeyId) return '—';
    return keys.find((k) => k.id === apiKeyId)?.label ?? apiKeyId.slice(0, 8) + '…';
  }

  const totalPages = data ? Math.ceil(data.total_count / data.page_size) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16"
      onClick={onClose}
      data-testid="cost-analysis-modal-overlay"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Analiza kosztów"
        className="relative w-full max-w-3xl rounded-xl bg-white shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
        data-testid="cost-analysis-modal"
      >
        {/* Nagłówek */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">Analiza kosztów</h2>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            data-testid="cost-analysis-modal-close"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Filtry */}
        <div className="flex flex-wrap gap-3 border-b border-gray-100 px-5 py-3 dark:border-gray-700">
          {/* Filtr klucza */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Klucz API</label>
            <select
              aria-label="Filtruj po kluczu"
              value={filterKey}
              onChange={(e) => handleFilterKey(e.target.value as FilterKey)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              data-testid="cost-filter-key"
            >
              <option value="">Wszystkie klucze</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
              <option value="none">Bez przypisania</option>
            </select>
          </div>

          {/* Filtr typu */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Typ</label>
            <div className="flex overflow-hidden rounded border border-gray-300 text-sm dark:border-gray-600">
              {(
                [
                  { val: '' as FilterType, label: 'Wszystkie' },
                  { val: 'vision' as FilterType, label: 'Vision' },
                  { val: 'refine' as FilterType, label: 'OCR' },
                ] as const
              ).map(({ val, label }) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={filterType === val}
                  onClick={() => handleFilterType(val)}
                  data-testid={`cost-filter-type-${val || 'all'}`}
                  className={`px-3 py-1 transition-colors ${
                    filterType === val
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Filtr okresu */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Okres</label>
            <div className="flex overflow-hidden rounded border border-gray-300 text-sm dark:border-gray-600">
              {(
                [
                  { val: '' as FilterPeriod, label: 'Wszystko' },
                  { val: '30d' as FilterPeriod, label: '30 dni' },
                  { val: '7d' as FilterPeriod, label: '7 dni' },
                ] as const
              ).map(({ val, label }) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={filterPeriod === val}
                  onClick={() => handleFilterPeriod(val)}
                  data-testid={`cost-filter-period-${val || 'all'}`}
                  className={`px-3 py-1 transition-colors ${
                    filterPeriod === val
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Lista */}
        <div className="max-h-[55vh] min-h-32 overflow-y-auto" data-testid="cost-events-list">
          {loading && (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-sm text-red-600 dark:text-red-400" data-testid="cost-events-error">
                {error}
              </p>
              <button
                onClick={() => setPage((p) => p)}
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
              >
                Spróbuj ponownie
              </button>
            </div>
          )}

          {!loading && !error && data?.items.length === 0 && (
            <p className="p-8 text-center text-sm text-gray-500" data-testid="cost-events-empty">
              Brak wywołań dla wybranych filtrów.
            </p>
          )}

          {!loading && !error && data && data.items.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left">Typ</th>
                  <th className="px-3 py-2 text-left">Model</th>
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-right">Czas</th>
                  <th className="px-3 py-2 text-right">Koszt</th>
                  <th className="px-3 py-2 text-left">Klucz</th>
                  <th className="px-3 py-2 text-left">Zdjęcie</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.items.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    data-testid={`cost-event-row-${item.id}`}
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${
                          item.kind === 'vision'
                            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        }`}
                      >
                        {item.kind === 'vision' ? 'Vision' : 'OCR'}
                      </span>
                      {item.kind === 'refine' && item.raw_title && (
                        <span className="ml-1 text-xs text-gray-400" title={item.raw_title}>
                          {item.raw_title.length > 20
                            ? item.raw_title.slice(0, 20) + '…'
                            : item.raw_title}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                      {item.model ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {formatDate(item.created_at)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-600 dark:text-gray-400">
                      {formatLatency(item.latency_ms)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold text-gray-800 dark:text-gray-200">
                      {formatCost(item.cost_usd)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                      {keyLabel(item.api_key_id)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {item.photo_id ? (
                        <a
                          href={`/photos/${item.photo_id}`}
                          className="text-blue-600 hover:underline dark:text-blue-400"
                          data-testid={`cost-event-photo-link-${item.id}`}
                        >
                          Zdjęcie
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer: suma + paginacja */}
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <p className="text-xs text-gray-500" data-testid="cost-events-summary">
            {data
              ? `${data.total_count} wywołań · suma ${formatCost(data.total_cost_usd)}`
              : loading
                ? 'Ładowanie…'
                : '—'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-40 dark:border-gray-600"
              data-testid="cost-pagination-prev"
            >
              Poprzednia
            </button>
            <span className="text-xs text-gray-500" data-testid="cost-pagination-info">
              {page} / {totalPages || '—'}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data || page >= totalPages || loading}
              className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-40 dark:border-gray-600"
              data-testid="cost-pagination-next"
            >
              Następna
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
