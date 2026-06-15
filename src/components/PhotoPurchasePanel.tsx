import { useCallback, useEffect, useRef, useState } from 'react';

interface PhotoPurchasePanelProps {
  photoId: string;
  initialPurchaseDate: string | null;
  initialCity: string | null;
  initialEvent: string | null;
  cityHints?: string[];
  eventHints?: string[];
}

const INPUT_CLS =
  'mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 disabled:opacity-60';

export default function PhotoPurchasePanel({
  photoId,
  initialPurchaseDate,
  initialCity,
  initialEvent,
  cityHints: initialCityHints = [],
  eventHints: initialEventHints = [],
}: PhotoPurchasePanelProps) {
  const [purchaseDate, setPurchaseDate] = useState<string>(initialPurchaseDate ?? '');
  const [purchaseCity, setPurchaseCity] = useState<string>(initialCity ?? '');
  const [purchaseEvent, setPurchaseEvent] = useState<string>(initialEvent ?? '');
  const [cityHints, setCityHints] = useState<string[]>(initialCityHints);
  const [eventHints, setEventHints] = useState<string[]>(initialEventHints);
  const [savedMsg, setSavedMsg] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch hints on mount — AbortController zapobiega setState po unmount (F2)
  useEffect(() => {
    const ctrl = new AbortController();
    const fetchHints = async () => {
      try {
        const [cityRes, eventRes] = await Promise.all([
          fetch('/api/books/purchase-hints?type=city', { signal: ctrl.signal }),
          fetch('/api/books/purchase-hints?type=event', { signal: ctrl.signal }),
        ]);
        if (cityRes.ok) {
          const json = (await cityRes.json()) as { data?: { hints: string[] } };
          if (json.data?.hints) setCityHints(json.data.hints);
        }
        if (eventRes.ok) {
          const json = (await eventRes.json()) as { data?: { hints: string[] } };
          if (json.data?.hints) setEventHints(json.data.hints);
        }
      } catch {
        /* hints są opcjonalne — cisza (w tym AbortError przy unmount) */
      }
    };
    void fetchHints();
    return () => ctrl.abort();
  }, []);

  // Cleanup timerów przy unmount — zapobiega wyciekowi i setState po unmount (F1)
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const savePatch = useCallback(
    (patch: {
      purchase_date?: string | null;
      purchase_city?: string | null;
      purchase_event?: string | null;
    }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void (async () => {
          try {
            const res = await fetch(`/api/photos/${photoId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patch),
            });
            if (res.ok) {
              setSavedMsg(true);
              if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
              savedTimerRef.current = setTimeout(() => setSavedMsg(false), 2000);
            } else {
              console.error('[PhotoPurchasePanel] PATCH failed', res.status);
            }
          } catch {
            /* silent — UI nie blokuje edycji przy chwilowym braku sieci */
          }
        })();
      }, 600);
    },
    [photoId],
  );

  function handleDateChange(val: string) {
    setPurchaseDate(val);
    savePatch({ purchase_date: val || null });
  }

  function handleCityChange(val: string) {
    setPurchaseCity(val);
    savePatch({ purchase_city: val || null });
  }

  function handleEventChange(val: string) {
    setPurchaseEvent(val);
    savePatch({ purchase_event: val || null });
  }

  return (
    <details
      data-testid="photo-purchase-panel"
      className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700"
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-gray-700 select-none hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50 [&::-webkit-details-marker]:hidden">
        Informacje o zakupie tej partii
        {savedMsg && (
          <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400">
            Zapisano
          </span>
        )}
      </summary>
      <div className="px-3 pt-2 pb-3">
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          Data, miasto i wydarzenie zostaną skopiowane do każdej zatwierdzonej książki ze zdjęcia.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Data */}
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Data zakupu
            <input
              type="date"
              data-testid="panel-purchase-date"
              value={purchaseDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className={INPUT_CLS}
            />
          </label>

          {/* Miasto */}
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Miasto
            <input
              type="text"
              data-testid="panel-purchase-city"
              list="panel-city-hints"
              value={purchaseCity}
              onChange={(e) => handleCityChange(e.target.value)}
              className={INPUT_CLS}
            />
            {cityHints.length > 0 && (
              <datalist id="panel-city-hints">
                {cityHints.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
            )}
          </label>

          {/* Wydarzenie */}
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Wydarzenie
            <input
              type="text"
              data-testid="panel-purchase-event"
              list="panel-event-hints"
              value={purchaseEvent}
              onChange={(e) => handleEventChange(e.target.value)}
              className={INPUT_CLS}
            />
            {eventHints.length > 0 && (
              <datalist id="panel-event-hints">
                {eventHints.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
            )}
          </label>
        </div>
      </div>
    </details>
  );
}
