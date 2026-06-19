import { useBodyScrollLock } from './useBodyScrollLock';

type Props = {
  open: boolean;
  label: string;
};

export default function ProgressModal({ open, label }: Props) {
  useBodyScrollLock(open);

  if (!open) return null;

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
          <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div className="h-1.5 w-full animate-pulse rounded-full bg-blue-500" />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Poczekaj — to zajmie chwilę</p>
        </div>
      </div>
    </div>
  );
}
