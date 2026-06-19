import { useEffect, useRef } from 'react';

import { useBodyScrollLock } from './useBodyScrollLock';

type Props = {
  open: boolean;
  label: string;
  titles?: string[];
  progress?: { current: number; total: number };
};

export default function ProgressModal({ open, label, titles, progress }: Props) {
  useBodyScrollLock(open);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [titles?.length]);

  if (!open) return null;

  const isDeterminate = progress != null && progress.total > 0;
  const pct = isDeterminate ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Przetwarzanie..."
        data-testid="progress-modal"
        className="w-full max-w-sm rounded-xl bg-white p-8 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p
            data-testid="progress-modal-label"
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {label}
          </p>

          {/* Progress bar — determinate when progress prop present and total > 0 */}
          <div className="relative h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            {isDeterminate ? (
              <div
                data-testid="progress-modal-bar"
                role="progressbar"
                aria-valuenow={progress.current}
                aria-valuemin={0}
                aria-valuemax={progress.total}
                className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <div
                data-testid="progress-modal-bar"
                className="h-1.5 w-full animate-pulse rounded-full bg-blue-500"
              />
            )}
          </div>

          {isDeterminate ? (
            <p
              data-testid="progress-modal-counter"
              className="text-xs text-gray-500 dark:text-gray-400"
            >
              {progress.current} / {progress.total} dopasowane
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">Poczekaj — to zajmie chwilę</p>
          )}

          {/* Scrollable titles list */}
          {titles && titles.length > 0 && (
            <ul
              ref={listRef}
              data-testid="progress-modal-titles"
              className="max-h-40 w-full overflow-y-auto text-left"
            >
              {titles.map((t, i) => (
                <li
                  key={i}
                  className="truncate py-0.5 text-xs text-gray-600 dark:text-gray-400"
                  title={t}
                >
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
