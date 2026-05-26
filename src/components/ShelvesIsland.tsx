import { useCallback, useEffect, useState } from 'react';

import type { ShelfDTO } from '../lib/shelves/schema';
import ShelfForm from './ShelfForm.tsx';
import ShelfListItem from './ShelfListItem.tsx';

/**
 * Orchestrator listy półek. Fetchuje `/api/shelves` przez session cookies
 * (browser supabase auth → middleware → endpoint → RLS scope per-user).
 * Refetchuje po każdej mutacji (prostsze niż optimistic update; lista
 * krótka <50 rows, refresh <100ms).
 */
export default function ShelvesIsland() {
  const [shelves, setShelves] = useState<ShelfDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchShelves = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/shelves');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { data: { shelves: ShelfDTO[] } };
      setShelves(json.data.shelves);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać półek.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchShelves();
  }, [fetchShelves]);

  const handleCreate = useCallback(
    async (name: string, location: string | undefined) => {
      const res = await fetch('/api/shelves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, location }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      await fetchShelves();
    },
    [fetchShelves]
  );

  const handleUpdate = useCallback(
    async (id: string, patch: { name?: string; location?: string | null }) => {
      const res = await fetch(`/api/shelves/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      await fetchShelves();
    },
    [fetchShelves]
  );

  const handleDelete = useCallback(
    async (id: string, _name: string) => {
      const res = await fetch(`/api/shelves/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      }
      await fetchShelves();
    },
    [fetchShelves]
  );

  if (loading) {
    return (
      <p className="text-sm text-gray-600" data-testid="shelves-loading">
        Ładowanie półek...
      </p>
    );
  }

  return (
    <div data-testid="shelves-island">
      <ShelfForm onCreate={handleCreate} disabled={loading} />
      {error && (
        <p
          className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700"
          role="alert"
          data-testid="shelves-error"
        >
          {error}
        </p>
      )}
      {shelves.length === 0 ? (
        <p className="text-sm text-gray-600" data-testid="shelves-empty">
          Nie masz jeszcze żadnych półek. Stwórz pierwszą powyżej.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="shelves-list">
          {shelves.map((shelf) => (
            <ShelfListItem
              key={shelf.id}
              shelf={shelf}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
