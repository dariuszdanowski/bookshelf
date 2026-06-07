import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  /** Slug used in data-testid="help-tip-{label}" and aria-label. */
  label: string;
  children: ReactNode;
};

/**
 * Contextual help popover — a small „?" button that reveals 2–3 sentences of
 * explanation on click. Closes on Esc or backdrop click.
 *
 * Uses transparent fixed backdrop (no body scroll lock — it's a popover, not
 * a modal). Pattern mirrors ConfirmDialog.tsx but without the dark overlay.
 */
export default function HelpTip({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        data-testid={`help-tip-${label}`}
        aria-label={`Pomoc: ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-300 bg-white text-[10px] font-bold text-gray-500 hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-400 dark:hover:text-gray-200"
      >
        ?
      </button>

      {open && (
        <>
          {/* Transparent backdrop — click outside closes the popover */}
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
          {/* Popover */}
          <div
            ref={popoverRef}
            role="tooltip"
            data-testid={`help-tip-${label}-popover`}
            className="absolute bottom-full left-0 z-50 mb-1.5 w-64 rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>
        </>
      )}
    </span>
  );
}
