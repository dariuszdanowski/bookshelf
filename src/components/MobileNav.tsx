import { useState } from 'react';
import LogoutButton from './LogoutButton';

type Shelf = { id: string; name: string };

const LINKS_BEFORE = [
  { href: '/library', label: 'Biblioteka', testid: 'mobile-nav-library' },
] as const;

const LINKS_AFTER = [
  { href: '/upload', label: 'Skanuj półkę', testid: 'mobile-nav-upload' },
  { href: '/purchase', label: 'Dodaj zakup', testid: 'mobile-nav-add-purchase' },
  { href: '/account', label: 'Moje konto', testid: 'mobile-nav-account' },
  { href: '/help', label: 'Pomoc', testid: 'mobile-nav-help' },
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
  isAdmin = false,
  shelves = [],
}: {
  email: string;
  currentPath?: string;
  isAdmin?: boolean;
  shelves?: Shelf[];
}) {
  const [open, setOpen] = useState(false);
  const isOnShelf = currentPath === '/shelves' || currentPath.startsWith('/shelves/');
  const [shelvesOpen, setShelvesOpen] = useState(isOnShelf);

  function isActive(href: string) {
    return currentPath === href || currentPath.startsWith(href + '/');
  }

  const linkCls = (active: boolean) =>
    `block rounded px-2 py-2 ${active ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400' : 'font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'}`;

  return (
    <div className="md:hidden">
      <button
        type="button"
        data-testid="mobile-nav-toggle"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? 'Zamknij menu' : 'Otwórz menu'}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
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
          className="absolute top-full right-0 left-0 z-40 border-b border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <ul className="flex flex-col gap-1">
            {LINKS_BEFORE.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  data-testid={l.testid}
                  aria-current={isActive(l.href) ? 'page' : undefined}
                  className={linkCls(isActive(l.href))}
                >
                  {l.label}
                </a>
              </li>
            ))}

            {/* Moje półki — akordeon */}
            <li>
              <button
                type="button"
                data-testid="mobile-nav-shelves"
                aria-expanded={shelvesOpen}
                onClick={() => setShelvesOpen((v) => !v)}
                className={`flex w-full items-center justify-between rounded px-2 py-2 ${isOnShelf ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400' : 'font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'}`}
              >
                Moje półki
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className={`transition-transform duration-150 ${shelvesOpen ? 'rotate-180' : ''}`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {shelvesOpen && (
                <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                  {shelves.length === 0 ? (
                    <li className="px-2 py-1.5 text-sm text-gray-400 dark:text-gray-500">
                      Brak półek
                    </li>
                  ) : (
                    shelves.map((shelf) => (
                      <li key={shelf.id}>
                        <a
                          href={`/shelves/${shelf.id}`}
                          className={`block truncate rounded px-2 py-1.5 text-sm ${
                            currentPath === `/shelves/${shelf.id}`
                              ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400'
                              : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'
                          }`}
                        >
                          {shelf.name}
                        </a>
                      </li>
                    ))
                  )}
                  <li>
                    <a
                      href="/shelves"
                      data-testid="mobile-nav-shelves-manage"
                      className={`block rounded px-2 py-1.5 text-sm ${
                        currentPath === '/shelves'
                          ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      Zarządzaj półkami…
                    </a>
                  </li>
                </ul>
              )}
            </li>

            {LINKS_AFTER.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  data-testid={l.testid}
                  aria-current={isActive(l.href) ? 'page' : undefined}
                  className={linkCls(isActive(l.href))}
                >
                  {l.label}
                </a>
              </li>
            ))}

            {isAdmin && (
              <li>
                <a
                  href="/admin"
                  data-testid="mobile-nav-admin"
                  aria-current={isActive('/admin') ? 'page' : undefined}
                  className={linkCls(isActive('/admin'))}
                >
                  Panel admina
                </a>
              </li>
            )}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
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
