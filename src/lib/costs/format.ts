/**
 * Shared formatters dla wartości kosztowych — zod-free moduł współdzielony
 * przez wyspy React (CostPanel, CostAnalysisModal). Brak importów z 'zod'
 * unika stale-deps w Vite (lekcja vite-stale-deps w lessons.md).
 * Sygnatury identyczne z CostPanel.tsx:34-54.
 */

export function formatCost(usd: number | null): string {
  if (usd == null) return '—';
  if (usd === 0) return '$0.0000';
  if (usd < 0.0001) return '<$0.0001';
  return `$${usd.toFixed(4)}`;
}

export function formatLatency(ms: number | null): string {
  if (ms == null) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pl-PL', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
