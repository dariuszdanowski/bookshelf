import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// M17: trzeci stan „systemowy" — motyw podąża za prefers-color-scheme,
// łącznie z żywą reakcją na zmianę w trakcie sesji (listener niżej).
// html.dark pozostaje JEDYNYM źródłem prawdy dla CSS (zob. global.css
// @custom-variant) — „system" jest rozwiązywany do light/dark przy aplikacji.
type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bookshelf:theme-mode';
const MODES: ThemeMode[] = ['light', 'system', 'dark'];

const MODE_LABEL: Record<ThemeMode, string> = {
  light: 'Tryb jasny',
  system: 'Tryb systemowy',
  dark: 'Tryb ciemny',
};

// Read the mode already persisted by the inline <head> script / poprzednie sesje.
// Brak wpisu = 'system' (parytet z inline script: fallback do matchMedia).
function getStoredMode(): ThemeMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  return 'system';
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyResolved(resolved: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.setAttribute('data-theme', resolved);
}

export default function ThemeToggle() {
  // Lazy initializer runs only on client (component is client:only — never SSR'd).
  const [mode, setMode] = useState<ThemeMode>(getStoredMode);

  // Aplikacja motywu przy mount (sync dla środowisk bez inline <head> script,
  // np. Vitest/jsdom — w prodzie no-op) i przy każdej zmianie trybu.
  useLayoutEffect(() => {
    applyResolved(resolveTheme(mode));
  }, [mode]);

  // M17: w trybie systemowym przełączenie motywu w OS (np. auto-ciemny
  // wieczorem) ma działać bez przeładowania strony.
  useEffect(() => {
    if (mode !== 'system') return;
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mql?.addEventListener) return;
    const onChange = () => applyResolved(resolveTheme('system'));
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [mode]);

  function selectMode(next: ThemeMode) {
    setMode(next); // useLayoutEffect([mode]) aplikuje motyw
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  const activeIndex = MODES.indexOf(mode);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [popoverOpen]);

  function modeIcon(m: ThemeMode, colorClass: string) {
    if (m === 'light')
      return (
        <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 ${colorClass}`} aria-hidden="true">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2V4M12 20V22M4.93 4.93L6.34 6.34M17.66 17.66L19.07 19.07M2 12H4M20 12H22M4.93 19.07L6.34 17.66M17.66 6.34L19.07 4.93"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    if (m === 'system')
      return (
        <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 ${colorClass}`} aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    return (
      <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 ${colorClass}`} aria-hidden="true">
        <path
          d="M21 14.5A9 9 0 1 1 9.5 3 7 7 0 1 0 21 14.5Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <>
      {/* Mobile: pojedynczy przycisk z ikoną aktywnego trybu + popover wyboru */}
      <div className="relative sm:hidden" ref={popoverRef} data-testid="theme-toggle">
        <button
          type="button"
          aria-label={`Motyw: ${MODE_LABEL[mode]}`}
          title={`Motyw: ${MODE_LABEL[mode]}`}
          aria-expanded={popoverOpen}
          data-testid={`theme-mode-${mode}`}
          onClick={() => setPopoverOpen((o) => !o)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 hover:border-violet-400 hover:text-violet-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-violet-400 dark:hover:text-violet-400"
        >
          {modeIcon(mode, 'text-current')}
        </button>
        {popoverOpen && (
          <div className="absolute top-full right-0 z-50 mt-1 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {MODES.map((m) => {
              const active = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    selectMode(m);
                    setPopoverOpen(false);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 text-xs whitespace-nowrap hover:bg-gray-50 dark:hover:bg-gray-700 ${active ? 'font-semibold text-violet-700 dark:text-violet-400' : 'text-gray-700 dark:text-gray-300'}`}
                >
                  {modeIcon(m, active ? 'text-violet-700 dark:text-violet-400' : 'text-gray-500')}
                  {MODE_LABEL[m]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop: istniejący 3-przyciskowy row */}
      <div
        data-testid="theme-toggle"
        role="radiogroup"
        aria-label="Motyw interfejsu"
        className="relative hidden h-10 items-center rounded-full border border-gray-300 bg-white p-1 sm:inline-flex"
      >
        <span
          aria-hidden="true"
          className="absolute top-1 left-1 h-8 w-8 rounded-full bg-violet-700 shadow transition-transform duration-200"
          style={{ transform: `translateX(${activeIndex * 32}px)` }}
        />
        {MODES.map((m) => {
          const active = m === mode;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={MODE_LABEL[m]}
              title={MODE_LABEL[m]}
              data-testid={`theme-mode-${m}`}
              onClick={() => selectMode(m)}
              className="relative z-10 inline-flex h-8 w-8 items-center justify-center"
            >
              {modeIcon(m, active ? 'text-white' : 'text-gray-500')}
            </button>
          );
        })}
      </div>
    </>
  );
}
