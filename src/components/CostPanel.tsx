import { useState, useEffect, useRef } from 'react';

type VisionRun = {
  id: string;
  model: string | null;
  cost_usd: number | null;
  latency_ms: number | null;
  status: string;
  created_at: string;
};

type RefineCall = {
  id: string;
  detection_id: string;
  position_index: number | null;
  raw_title: string | null;
  model: string | null;
  cost_usd: number | null;
  latency_ms: number | null;
  created_at: string;
};

type CostData = {
  vision_runs: VisionRun[];
  refine_calls: RefineCall[];
  totals: {
    vision_cost_usd: number;
    refine_cost_usd: number;
    grand_total_usd: number;
    call_count: number;
  };
};

function formatCost(usd: number | null): string {
  if (usd == null) return '—';
  if (usd < 0.0001) return '<$0.0001';
  return `$${usd.toFixed(4)}`;
}

function formatLatency(ms: number | null): string {
  if (ms == null) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pl-PL', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

type Props = {
  photoId: string;
  /** Jeśli podano detectionId — pokazuje tylko koszty OCR tej detekcji */
  detectionId?: string;
  /** Pozycja panelu — 'left' gdy button jest po prawej stronie */
  align?: 'left' | 'right';
  /** Vision run już załadowany na stronie — pokazany natychmiast bez dodatkowego fetcha */
  preloadedVisionRun?: VisionRun | null;
};

export default function CostPanel({ photoId, detectionId, align = 'right', preloadedVisionRun }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Zamknij panel kliknięciem poza nim
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
    if (open) { setOpen(false); return; }
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/photos/${photoId}/costs`);
      const json = await res.json() as { data?: CostData; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      setData(json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd ładowania');
    } finally {
      setLoading(false);
    }
  }

  // Filtrowanie danych dla konkretnej detekcji
  const filteredRefine = detectionId
    ? (data?.refine_calls ?? []).filter((r) => r.detection_id === detectionId)
    : (data?.refine_calls ?? []);

  // Vision runs: preloadedVisionRun ma priorytet (już załadowany przy fetchowaniu foto),
  // fallback do danych z /costs (mogą być pełniejsze po archiwizacji)
  const apiVisionRuns = detectionId ? [] : (data?.vision_runs ?? []);
  const filteredVision: VisionRun[] = detectionId
    ? []
    : preloadedVisionRun
      ? [preloadedVisionRun, ...apiVisionRuns.filter((r) => r.id !== preloadedVisionRun.id)]
      : apiVisionRuns;

  const filteredRefineTotal = filteredRefine.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const filteredVisionTotal = filteredVision.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const filteredTotal = filteredRefineTotal + filteredVisionTotal;
  const filteredCount = filteredRefine.length + filteredVision.length;
  const hasData = filteredCount > 0 || !!preloadedVisionRun;

  return (
    <div ref={panelRef} className="relative inline-block">
      {/* Trigger button */}
      <button
        type="button"
        data-testid={detectionId ? `cost-button-det-${detectionId}` : 'cost-button-photo'}
        title={detectionId ? 'Koszty OCR tej detekcji' : 'Koszty API dla tego zdjęcia'}
        onClick={handleToggle}
        className={`flex items-center justify-center rounded border px-1.5 py-0.5 text-xs font-semibold transition-colors ${
          open
            ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
            : 'border-gray-300 bg-white text-gray-500 hover:border-emerald-300 hover:text-emerald-600'
        }`}
      >
        <svg width="10" height="12" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <line x1="5" y1="0" x2="5" y2="14" />
          <path d="M8 3H3.5A2.5 2.5 0 001 5.5v0A2.5 2.5 0 003.5 8H6.5A2.5 2.5 0 019 10.5v0A2.5 2.5 0 016.5 13H1" />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div
          className={`absolute z-50 mt-1 w-72 rounded-lg border border-gray-200 bg-white shadow-xl ${
            align === 'left' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="text-xs font-semibold text-gray-700">
              {detectionId ? 'Koszty OCR — ta detekcja' : 'Koszty API — zdjęcie'}
            </p>
          </div>

          {loading && !preloadedVisionRun && (
            <div className="px-3 py-4 text-center text-xs text-gray-400">Ładowanie...</div>
          )}

          {error && (
            <div className="px-3 py-3 text-xs text-red-600">{error}</div>
          )}

          {(preloadedVisionRun || (!loading && !error && data)) && (
            <div className="max-h-72 overflow-y-auto">
              {/* Vision runs (tylko dla widoku photo) */}
              {filteredVision.map((vr) => (
                <div key={vr.id} className="flex items-center gap-2 border-b border-gray-50 px-3 py-1.5">
                  <svg className="flex-shrink-0 text-indigo-500" width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
                  <span className="flex-1 truncate text-[11px] text-gray-600">Vision · {formatDate(vr.created_at)} · {formatLatency(vr.latency_ms)}</span>
                  <span className="flex-shrink-0 text-[11px] font-semibold text-gray-800">{formatCost(vr.cost_usd)}</span>
                </div>
              ))}

              {/* Refine calls */}
              {filteredRefine.map((rc) => (
                <div key={rc.id} className="flex items-center gap-2 border-b border-gray-50 px-3 py-1.5">
                  <svg className="flex-shrink-0 text-amber-500" width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/></svg>
                  <span className="flex-1 truncate text-[11px] text-gray-600">
                    OCR{rc.position_index != null ? ` #${rc.position_index}` : ''}{rc.raw_title ? ` ${rc.raw_title}` : ''} · {formatDate(rc.created_at)} · {formatLatency(rc.latency_ms)}
                  </span>
                  <span className="flex-shrink-0 text-[11px] font-semibold text-gray-800">{formatCost(rc.cost_usd)}</span>
                </div>
              ))}

              {filteredCount === 0 && !preloadedVisionRun && (
                <p className="px-3 py-4 text-center text-xs text-gray-400">Brak wywołań API</p>
              )}
            </div>
          )}

          {hasData && (
            <div className="border-t border-gray-100 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">{filteredCount} {filteredCount === 1 ? 'wywołanie' : 'wywołania/ń'}</span>
                <span className="text-xs font-bold text-gray-800">Suma: {formatCost(filteredTotal)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
