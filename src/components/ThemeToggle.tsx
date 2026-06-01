import { useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'bookshelf:theme-mode';

function getPreferredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.setAttribute('data-theme', mode);
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('light');

  useEffect(() => {
    const next = getPreferredTheme();
    setMode(next);
    applyTheme(next);
  }, []);

  function toggleTheme() {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-pressed={mode === 'dark'}
      aria-label={mode === 'dark' ? 'Przelacz na tryb jasny' : 'Przelacz na tryb ciemny'}
      onClick={toggleTheme}
      className="relative inline-flex h-10 w-[70px] items-center rounded-full border border-gray-300 bg-white p-1"
      title={mode === 'dark' ? 'Przełącz na tryb jasny' : 'Przełącz na tryb ciemny'}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1 h-8 w-8 rounded-full bg-violet-700 shadow transition-transform duration-200 ${
          mode === 'dark' ? 'translate-x-[30px]' : 'translate-x-0'
        }`}
      />

      <span className="relative z-10 inline-flex w-8 items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 ${mode === 'light' ? 'text-white' : 'text-gray-500'}`} aria-hidden="true">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2V4M12 20V22M4.93 4.93L6.34 6.34M17.66 17.66L19.07 19.07M2 12H4M20 12H22M4.93 19.07L6.34 17.66M17.66 6.34L19.07 4.93"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>

      <span className="relative z-10 inline-flex w-8 items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 ${mode === 'dark' ? 'text-white' : 'text-gray-500'}`} aria-hidden="true">
          <path
            d="M21 14.5A9 9 0 1 1 9.5 3 7 7 0 1 0 21 14.5Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}
