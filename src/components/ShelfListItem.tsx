import { useState, type SyntheticEvent } from 'react';

import type { ShelfDTO } from '../lib/shelves/schema';

type Props = {
  shelf: ShelfDTO;
  onUpdate: (id: string, patch: { name?: string; location?: string | null }) => Promise<void>;
  onDelete: (id: string, name: string) => Promise<void>;
};

/**
 * Pojedynczy row listy półek. Dwa stany: view + edit (toggle).
 *
 * Dla `is_system: true` (Zakupione): brak buttonów Edit/Delete (defense in
 * depth, DB trigger też blokuje). Badge „systemowa" jako wizualny marker.
 */
export default function ShelfListItem({ shelf, onUpdate, onDelete }: Props) {
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState(shelf.name);
  const [location, setLocation] = useState(shelf.location ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adaptacja vs plan: React 19 deprecated FormEvent — używamy SyntheticEvent
  // (per S-01 B variant precedent + lessons.md "Adaptacje literalne").
  async function onEditSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const patch: { name?: string; location?: string | null } = {};
      if (name.trim() !== shelf.name) patch.name = name.trim();
      if (location.trim() !== (shelf.location ?? '')) {
        patch.location = location.trim() || null;
      }
      if (Object.keys(patch).length > 0) {
        await onUpdate(shelf.id, patch);
      }
      setEditMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zaktualizować.');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteClick() {
    if (!window.confirm(`Usunąć półkę „${shelf.name}"? Tej operacji nie można cofnąć.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDelete(shelf.id, shelf.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć.');
      setBusy(false);
    }
    // Brak `finally setBusy(false)` przy sukcesie — komponent zostanie
    // odmontowany przez refetch.
  }

  if (editMode && !shelf.is_system) {
    return (
      <li
        className="flex flex-col gap-3 rounded-md border border-gray-300 bg-white p-4"
        data-testid={`shelf-item-${shelf.id}`}
      >
        <form onSubmit={onEditSubmit} className="grid gap-2 sm:grid-cols-[2fr_2fr_auto_auto]">
          <input
            type="text"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            disabled={busy}
            aria-label="Nazwa półki"
            placeholder="Nazwa półki"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="shelf-item-edit-name"
          />
          <input
            type="text"
            maxLength={200}
            placeholder="Lokalizacja (opcjonalna)"
            aria-label="Lokalizacja półki"
            value={location}
            onChange={(e) => setLocation(e.currentTarget.value)}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="shelf-item-edit-location"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex items-center justify-center rounded-md border border-gray-900 bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? 'Zapisuję...' : 'Zapisz'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditMode(false);
              setName(shelf.name);
              setLocation(shelf.location ?? '');
              setError(null);
            }}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50"
          >
            Anuluj
          </button>
        </form>
        {error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </li>
    );
  }

  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`shelf-item-${shelf.id}`}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-lg font-medium" data-testid="shelf-item-name">
            {shelf.name}
          </span>
          {shelf.is_system && (
            <span
              className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
              data-testid="shelf-item-system-badge"
            >
              systemowa
            </span>
          )}
        </div>
        {shelf.location && (
          <span className="text-sm text-gray-600" data-testid="shelf-item-location">
            {shelf.location}
          </span>
        )}
        <span className="text-xs text-gray-500" data-testid="shelf-item-book-count">
          {shelf.book_count} {shelf.book_count === 1 ? 'książka' : 'książek'}
        </span>
      </div>
      {!shelf.is_system && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditMode(true)}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50"
            data-testid="shelf-item-edit-button"
          >
            Edytuj
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDeleteClick}
            className="inline-flex items-center justify-center rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            data-testid="shelf-item-delete-button"
          >
            {busy ? 'Usuwam...' : 'Usuń'}
          </button>
        </div>
      )}
      {error && (
        <p className="text-sm text-red-700 sm:basis-full" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
