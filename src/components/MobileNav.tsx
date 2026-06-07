import { useState } from 'react';
import LogoutButton from './LogoutButton';

const LINKS = [
  { href: '/library', label: 'Biblioteka', testid: 'mobile-nav-library' },
  { href: '/shelves', label: 'Moje półki', testid: 'mobile-nav-shelves' },
  { href: '/upload', label: 'Skanuj półkę', testid: 'mobile-nav-upload' },
  { href: '/purchase', label: 'Dodaj zakup', testid: 'mobile-nav-add-purchase' },
  { href: '/account', label: 'Moje konto', testid: 'mobile-nav-account' },
] as const;

/**
 * S-28: nawigacja mobilna (hamburger) — widoczna < md (768 px); desktopowy
 * `<nav>` w Layout.astro zostaje nietknięty (z dotychczasowymi testidami).
 * Panel renderowany warunkowo (open) — LogoutButton w panelu nie dubluje się
 * w DOM z desktopowym, dopóki panel jest zamknięty.
 */
export default function MobileNav({
  email,
  currentPath = '',
}: {
  email: string;
  currentPath?: string;
}) {
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    return currentPath === href || currentPath.startsWith(href + '/');
  }

  return (
    <div className="md:hidden">
      <button
        type="button"
        data-testid="mobile-nav-toggle"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? 'Zamknij menu' : 'Otwórz menu'}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50"
      >
        {open ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {open && (
        <nav
          id="mobile-nav-panel"
          data-testid="mobile-nav-panel"
          aria-label="Nawigacja mobilna"
          className="absolute top-full right-0 left-0 z-40 border-b border-gray-200 bg-white p-4 shadow-lg"
        >
          <ul className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  data-testid={l.testid}
                  aria-current={isActive(l.href) ? 'page' : undefined}
                  className={`block rounded px-2 py-2 ${isActive(l.href) ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400' : 'font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'}`}
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3">
            <span data-testid="mobile-user-email" className="truncate text-xs text-gray-500">
              {email}
            </span>
            <LogoutButton />
          </div>
        </nav>
      )}
    </div>
  );
}
