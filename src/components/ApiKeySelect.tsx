import type { ApiKeyDTO } from '../lib/keys/schema';

// per-call-byok-key-override: dropdown wyboru klucza BYOK per-wywołanie
// (jednorazowy override, nie zmienia is_active). Renderuje się nawet dla
// listy 1-pozycyjnej (widoczność klucza + oznaczenie "aktywny" — decyzja
// usera po manualnej weryfikacji, zob. plan-review). Gdy 0 kluczy — nic nie
// renderuje (przycisk wywołujący akcję jest wtedy disabled, zob. RefineButton/
// AiResolutionButton/rerun-vision — dialog z tym stanem nie powinien się otworzyć).
export default function ApiKeySelect({
  keys,
  value,
  onChange,
}: {
  keys: ApiKeyDTO[] | null;
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (keys === null || keys.length === 0) return null;

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
          <option
            key={key.id}
            value={key.id}
            // natywny <option> nie wspiera częściowego stylowania tekstu (brak
            // zagnieżdżonych <span>) — cała opcja aktywnego klucza na zielono,
            // najszerzej wspierany wariant CSS na <option> w przeglądarkach.
            className={key.is_active ? 'text-green-600 dark:text-green-400' : undefined}
          >
            {/* rynkowy wzorzec dla "aktywny/domyślny" w plain-text liście to
                jawny tekstowy suffix (analogicznie do "Primary"/"Default" w
                Stripe/AWS/GitHub) — natywny <option> nie renderuje ikon/HTML */}
            {key.label} ({key.provider}){key.is_active ? ' ✓ aktywny' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
