import { useState, type SyntheticEvent } from 'react';

type Props = {
  onCreate: (name: string, location: string | undefined) => Promise<void>;
  disabled?: boolean;
};

/**
 * Formularz tworzenia nowej półki. Inline na górze listy w ShelvesIsland.
 *
 * Walidacja Zod po stronie serwera; tutaj tylko podstawowy HTML required.
 * Server może zwrócić 400 z `details.fieldErrors.name` — wtedy renderujemy
 * inline error pod inputem (przez props.error).
 */
export default function ShelfForm({ onCreate, disabled }: Props) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adaptacja vs plan: React 19 deprecated FormEvent — używamy SyntheticEvent
  // (per S-01 B variant precedent + lessons.md "Adaptacje literalne").
  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim(), location.trim() || undefined);
      setName('');
      setLocation('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się utworzyć półki.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mb-6 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-4 sm:grid-cols-[2fr_2fr_auto]"
      data-testid="shelf-form-create"
    >
      <input
        type="text"
        required
        maxLength={100}
        placeholder={'Nazwa półki (np. „Belletrystyka")'}
        aria-label="Nazwa nowej półki"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        disabled={disabled || submitting}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        data-testid="shelf-form-name"
      />
      <input
        type="text"
        maxLength={200}
        placeholder={'Lokalizacja (opcjonalna, np. „Salon, regał południowy")'}
        aria-label="Lokalizacja nowej półki (opcjonalna)"
        value={location}
        onChange={(e) => setLocation(e.currentTarget.value)}
        disabled={disabled || submitting}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        data-testid="shelf-form-location"
      />
      <button
        type="submit"
        disabled={disabled || submitting || !name.trim()}
        // M14: gray-900 znikał na ciemnym tle — primary wg konwencji repo (blue-600)
        className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        data-testid="shelf-form-submit"
      >
        {submitting ? 'Tworzę...' : 'Dodaj półkę'}
      </button>
      {error && (
        <p
          className="text-sm text-red-700 sm:col-span-3"
          role="alert"
          data-testid="shelf-form-error"
        >
          {error}
        </p>
      )}
    </form>
  );
}
