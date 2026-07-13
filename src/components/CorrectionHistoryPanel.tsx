import { useState, useEffect, useRef } from 'react';

import { formatDate } from '../lib/costs/format';

type CorrectionEntry = {
  id: string;
  correction_type: string | null;
  original_raw_title: string | null;
  original_raw_author: string | null;
  corrected_title: string | null;
  corrected_authors: string[] | null;
  created_at: string;
};

type HistoryData = {
  corrections: CorrectionEntry[];
};

type Props = {
  detectionId: string;
};

const CORRECTION_TYPE_LABELS: Record<string, string> = {
  rematch: 'Szukaj po tytule',
  refine: 'Doprecyzuj odczyt',
  field_edit: 'Popraw',
  manual_entry: 'Wpis ręczny',
  accept: 'Zaakceptowano',
  reject: 'Odrzucono',
  ai_resolution_not_found: 'AI nie znalazła',
  title_typo: 'Literówka w tytule',
  wrong_author: 'Błędny autor',
  wrong_book: 'Błędna książka',
  not_a_book: 'To nie książka',
  parse_failure: 'Błąd parsowania',
};

function correctionTypeLabel(type: string | null): string {
  if (!type) return 'Nieznana korekta';
  return CORRECTION_TYPE_LABELS[type] ?? type;
}

export default function CorrectionHistoryPanel({ detectionId }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function handleToggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/detections/${detectionId}/history`);
      const json = (await res.json()) as { data?: HistoryData; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      setData(json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd ładowania');
    } finally {
      setLoading(false);
    }
  }

  const entries = data?.corrections ?? [];

  return (
    <div ref={panelRef} className="relative inline-block">
      <button
        type="button"
        data-testid={`history-button-det-${detectionId}`}
        title="Historia korekt tej detekcji"
        onClick={handleToggle}
        className={`flex items-center justify-center rounded border px-1.5 py-0.5 text-xs font-semibold transition-colors ${
          open
            ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
            : 'border-gray-300 bg-white text-gray-500 hover:border-emerald-300 hover:text-emerald-600'
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v5a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L11 9.586V5z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          data-testid={`history-panel-det-${detectionId}`}
          className="absolute right-0 z-50 mt-1 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white shadow-xl"
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="text-xs font-semibold text-gray-700">Historia korekt</p>
          </div>

          {loading && (
            <div className="px-3 py-4 text-center text-xs text-gray-400">Ładowanie...</div>
          )}

          {error && <div className="px-3 py-3 text-xs text-red-600">{error}</div>}

          {!loading && !error && (
            <div className="max-h-72 overflow-y-auto">
              {entries.length === 0 && (
                <p
                  className="px-3 py-4 text-center text-xs text-gray-400"
                  data-testid="history-empty"
                >
                  Brak historii korekt
                </p>
              )}
              {entries.map((entry) => (
                <div key={entry.id} className="border-b border-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-700">
                      {correctionTypeLabel(entry.correction_type)}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {formatDate(entry.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-600">
                    <span className="text-gray-400">Było:</span> {entry.original_raw_title ?? '—'}
                    {entry.original_raw_author ? ` — ${entry.original_raw_author}` : ''}
                  </p>
                  {(entry.corrected_title || entry.corrected_authors?.length) && (
                    <p className="mt-0.5 text-[11px] text-gray-600">
                      <span className="text-gray-400">Na:</span> {entry.corrected_title ?? '—'}
                      {entry.corrected_authors?.length
                        ? ` — ${entry.corrected_authors.join(', ')}`
                        : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
