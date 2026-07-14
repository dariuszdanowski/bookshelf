import type { ApiKeyDTO } from '../lib/keys/schema';

// per-call-byok-key-override: dropdown wyboru klucza BYOK per-wywołanie
// (jednorazowy override, nie zmienia is_active). Gdy dostępny ≤1 klucz —
// nic nie renderuje (brak sensu wyboru, zero wizualnego szumu).
export default function ApiKeySelect({
  keys,
  value,
  onChange,
}: {
  keys: ApiKeyDTO[] | null;
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (keys === null || keys.length <= 1) return null;

  return (
    <div className="mt-3 flex flex-col gap-1">
      <label className="text-xs text-gray-500" htmlFor="api-key-select">
        Klucz API
      </label>
      <select
        id="api-key-select"
        data-testid="api-key-select"
        aria-label="Wybierz klucz API"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
      >
        {keys.map((key) => (
          <option key={key.id} value={key.id}>
            {key.label} ({key.provider})
          </option>
        ))}
      </select>
    </div>
  );
}
