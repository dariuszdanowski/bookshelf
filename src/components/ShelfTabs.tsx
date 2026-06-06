import { useEffect, useState } from 'react';

import PhotoListIsland from './PhotoListIsland';
import ShelfBooksIsland from './ShelfBooksIsland';

export type ShelfTab = 'books' | 'photos';

export const SHELF_TAB_STORAGE_KEY = 'bookshelf:shelf-tab';
const TABS: readonly ShelfTab[] = ['books', 'photos'];
const TAB_LABELS: Record<ShelfTab, string> = {
  books: 'Książki',
  photos: 'Zdjęcia',
};

function isShelfTab(v: unknown): v is ShelfTab {
  return typeof v === 'string' && (TABS as readonly string[]).includes(v);
}

function readStoredTab(): ShelfTab {
  if (typeof window === 'undefined') return 'books';
  try {
    const stored = window.localStorage.getItem(SHELF_TAB_STORAGE_KEY);
    if (isShelfTab(stored)) return stored; // śmieciowa wartość → default
  } catch {
    // localStorage niedostępny — fallback do default
  }
  return 'books';
}

export function useShelfTab(): [ShelfTab, (t: ShelfTab) => void] {
  // Start od 'books' (hydration-safe); preferencję czytamy po mount.
  const [tab, setTabState] = useState<ShelfTab>('books');

  useEffect(() => {
    // S-36: deep-link `?tab=` (np. lądowanie po skip-upload) wygrywa nad
    // localStorage i jest persystowany; śmieci → fallback do stored.
    const param = new URLSearchParams(window.location.search).get('tab');
    if (isShelfTab(param)) {
      setTabState(param);
      try {
        window.localStorage.setItem(SHELF_TAB_STORAGE_KEY, param);
      } catch {
        // zapis niemożliwy — preferencja tylko w pamięci sesji
      }
      return;
    }
    setTabState(readStoredTab());
  }, []);

  const setTab = (t: ShelfTab) => {
    setTabState(t);
    try {
      window.localStorage.setItem(SHELF_TAB_STORAGE_KEY, t);
    } catch {
      // zapis niemożliwy — preferencja zostaje tylko w pamięci sesji
    }
  };

  return [tab, setTab];
}

type Props = {
  shelfId: string;
  shelfName: string;
};

/**
 * Zakładki „Książki / Zdjęcia" na widoku półki (S-29).
 *
 * Oba panele są zamontowane raz; nieaktywny ukrywamy przez `hidden` (display:none),
 * NIE odmontowujemy — każdy island fetchuje swoje dane raz przy hydratacji, a
 * przełączenie zakładki jest natychmiastowe (bez re-fetchu / migotania loadera).
 */
export default function ShelfTabs({ shelfId, shelfName }: Props) {
  const [tab, setTab] = useShelfTab();

  return (
    <div>
      <div
        data-testid="shelf-tab-switcher"
        role="tablist"
        aria-label="Zawartość półki"
        className="mb-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5"
      >
        {TABS.map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              data-testid={`shelf-tab-${t}`}
              aria-selected={active}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          );
        })}
      </div>

      <div
        data-testid="shelf-tab-panel-books"
        role="tabpanel"
        className={tab === 'books' ? '' : 'hidden'}
      >
        <ShelfBooksIsland shelfId={shelfId} />
      </div>

      <div
        data-testid="shelf-tab-panel-photos"
        role="tabpanel"
        className={tab === 'photos' ? '' : 'hidden'}
      >
        <PhotoListIsland shelfId={shelfId} shelfName={shelfName} />
      </div>
    </div>
  );
}
