import { useState, useRef, useEffect } from 'react';

type Shelf = { id: string; name: string };

export default function ShelvesDropdown({
  shelves,
  currentPath,
}: {
  shelves: Shelf[];
  currentPath: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isShelvesActive = currentPath === '/shelves' || currentPath.startsWith('/shelves/');

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="nav-shelves"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 ${isShelvesActive ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'}`}
      >
        Moje półki
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 min-w-[200px] rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {shelves.length === 0 ? (
            <span className="block px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              Brak półek
            </span>
          ) : (
            shelves.map((shelf) => (
              <a
                key={shelf.id}
                href={`/shelves/${shelf.id}`}
                onClick={() => setOpen(false)}
                className={`block truncate px-3 py-2 text-sm ${
                  currentPath === `/shelves/${shelf.id}`
                    ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400'
                    : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'
                }`}
              >
                {shelf.name}
              </a>
            ))
          )}
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <a
            href="/shelves"
            onClick={() => setOpen(false)}
            className={`block px-3 py-2 text-sm ${
              currentPath === '/shelves'
                ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Zarządzaj półkami…
          </a>
        </div>
      )}
    </div>
  );
}
