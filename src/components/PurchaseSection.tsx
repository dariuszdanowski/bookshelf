interface PurchaseSectionProps {
  purchaseDate: string | null;
  purchasePrice: number | null;
  purchaseCity: string | null;
  purchaseEvent: string | null;
  cityHints: string[];
  eventHints: string[];
  onChange: (patch: {
    purchaseDate?: string | null;
    purchasePrice?: number | null;
    purchaseCity?: string | null;
    purchaseEvent?: string | null;
  }) => void;
  disabled?: boolean;
}

const INPUT_CLS =
  'mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 disabled:opacity-60';

export default function PurchaseSection({
  purchaseDate,
  purchasePrice,
  purchaseCity,
  purchaseEvent,
  cityHints,
  eventHints,
  onChange,
  disabled,
}: PurchaseSectionProps) {
  return (
    <details className="group rounded-lg border border-gray-200 dark:border-gray-700">
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-gray-700 select-none hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50 [&::-webkit-details-marker]:hidden">
        Informacje o zakupie
      </summary>
      <div className="grid grid-cols-2 gap-3 px-3 pt-2 pb-3">
        {/* Data zakupu */}
        <label className="col-span-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          Data zakupu
          <input
            type="date"
            data-testid="purchase-date"
            value={purchaseDate ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ purchaseDate: e.target.value || null })}
            className={INPUT_CLS}
          />
        </label>

        {/* Cena */}
        <label className="col-span-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          Cena
          <div className="relative mt-0.5">
            <input
              type="number"
              data-testid="purchase-price"
              min="0"
              max="99999.99"
              step="0.01"
              placeholder="0.00"
              value={purchasePrice ?? ''}
              disabled={disabled}
              onChange={(e) => {
                const val = e.target.value;
                onChange({ purchasePrice: val === '' ? null : parseFloat(val) });
              }}
              className={`${INPUT_CLS} pr-6`}
            />
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-gray-400">
              zł
            </span>
          </div>
        </label>

        {/* Miasto */}
        <label className="col-span-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          Miasto
          <input
            type="text"
            data-testid="purchase-city"
            list="purchase-city-hints"
            value={purchaseCity ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ purchaseCity: e.target.value || null })}
            className={INPUT_CLS}
          />
          {cityHints.length > 0 && (
            <datalist id="purchase-city-hints">
              {cityHints.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          )}
        </label>

        {/* Wydarzenie */}
        <label className="col-span-1 text-xs font-medium text-gray-700 dark:text-gray-300">
          Wydarzenie
          <input
            type="text"
            data-testid="purchase-event"
            list="purchase-event-hints"
            value={purchaseEvent ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ purchaseEvent: e.target.value || null })}
            className={INPUT_CLS}
          />
          {eventHints.length > 0 && (
            <datalist id="purchase-event-hints">
              {eventHints.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          )}
        </label>
      </div>
    </details>
  );
}
