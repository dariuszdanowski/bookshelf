import { useEffect, useState } from 'react';

/**
 * Wspólny primitive trybów prezentacji listy (Karty / Lista / Kafelki).
 * Wyniesiony z DetectionReview (S-25) i sparametryzowany kluczem localStorage,
 * by współdzielić go między review detekcji a listami książek (S-34).
 */
export type ViewMode = 'cards' | 'list' | 'tiles';

export const VIEW_MODES: readonly ViewMode[] = ['cards', 'list', 'tiles'];

const DEFAULT_LABELS: Record<ViewMode, string> = {
  cards: 'Karty',
  list: 'Lista',
  tiles: 'Kafelki',
};

export function isViewMode(v: unknown): v is ViewMode {
  return typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v);
}

// Default zależny od szerokości. W SSR oraz jsdom (brak window.matchMedia)
// świadomie zwracamy 'cards' — inaczej testy oczekujące kart by padły.
// Do 'list' schodzimy WYŁĄCZNIE przy pozytywnym dopasowaniu mobile.
function defaultViewMode(): ViewMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'cards';
  }
  return window.matchMedia('(min-width: 640px)').matches ? 'cards' : 'list';
}

function readStoredViewMode(storageKey: string): ViewMode {
  if (typeof window === 'undefined') return 'cards';
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (isViewMode(stored)) return stored; // walidacja: śmieciowa wartość → default
  } catch {
    // localStorage niedostępny (tryb prywatny / wyłączony) — fallback do default
  }
  return defaultViewMode();
}

/**
 * Hydration-safe hook trybu widoku. Start od 'cards' (zgodność SSR↔pierwszy render);
 * preferencję z localStorage czytamy po mount. Zapis przy każdej zmianie.
 */
export function useViewMode(storageKey: string): [ViewMode, (m: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>('cards');

  useEffect(() => {
    setModeState(readStoredViewMode(storageKey));
  }, [storageKey]);

  const setMode = (m: ViewMode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(storageKey, m);
    } catch {
      // zapis niemożliwy — preferencja zostaje tylko w pamięci sesji
    }
  };

  return [mode, setMode];
}

export function ViewModeSwitcher({
  mode,
  onChange,
  labels = DEFAULT_LABELS,
  testId = 'view-mode-switcher',
  itemTestIdPrefix = 'view-mode',
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
  labels?: Record<ViewMode, string>;
  /** testid kontenera; default zachowuje S-25 ('view-mode-switcher'). */
  testId?: string;
  /** prefiks testid przycisków; default 'view-mode' → 'view-mode-cards' itd. */
  itemTestIdPrefix?: string;
}) {
  return (
    <div
      data-testid={testId}
      role="group"
      aria-label="Tryb prezentacji listy"
      className="mb-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800"
    >
      {VIEW_MODES.map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            data-testid={`${itemTestIdPrefix}-${m}`}
            aria-pressed={active}
            onClick={() => onChange(m)}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              active
                ? // M4: akcent kolorem (nie szarością) — ręczne override'y dark zlewają
                  // wszystkie text-gray-* do jednej wartości, przez co aktywny chip był
                  // nierozróżnialny; text-blue-700 mapuje się w dark na czytelny #93c5fd.
                  'bg-white font-semibold text-blue-700 shadow-sm dark:bg-gray-900'
                : 'font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {labels[m]}
          </button>
        );
      })}
    </div>
  );
}
