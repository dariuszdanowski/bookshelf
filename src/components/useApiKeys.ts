import { useCallback, useRef, useState } from 'react';

import type { ApiKeyDTO } from '../lib/keys/schema';

// per-call-byok-key-override: lazy-fetch hook listy kluczy BYOK usera.
// fetchKeys() musi być wywoływane jawnie (np. przy otwarciu dialogu), NIGDY
// automatycznie w useEffect na mount — inaczej koliduje z kolejnością
// mockResolvedValueOnce() w testach, które nie renderują tych dialogów
// (zob. DetectionReview.tsx, komentarze przy dawnych ad-hoc fetchach).
export function useApiKeys(): {
  keys: ApiKeyDTO[] | null;
  error: string | null;
  fetchKeys: () => void;
} {
  const [keys, setKeys] = useState<ApiKeyDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // impl-review F2/F3: mirror CostAnalysisModal.tsx (data/error rozróżnienie
  // + guard przeciw wyścigom) — tu wołane imperatywnie (nie w useEffect), więc
  // guard to request-id ref zamiast "cancelled" z cleanup: każde wywołanie
  // fetchKeys() unieważnia odpowiedzi poprzednich, nadal-w-locie wywołań
  // (klik → zamknij → klik nie może nadpisać stanu starszą odpowiedzią).
  const requestIdRef = useRef(0);

  // useCallback (referencja stabilna) — konsumenci wołają fetchKeys z wnętrza
  // useEffect (np. hasNoCandidates-gated fetch w useDetectionDecision); bez
  // stabilnej referencji trzeba by albo pomijać ją w deps (lint), albo effect
  // odpalałby się na każdym renderze.
  const fetchKeys = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setError(null);
    fetch('/api/account/keys')
      .then(
        (r) =>
          r.json() as Promise<{
            data?: { keys?: ApiKeyDTO[] };
            error?: { message?: string };
          }>,
      )
      .then((body) => {
        if (requestId !== requestIdRef.current) return; // odpowiedź nieaktualnego wywołania
        if (body.data) {
          setKeys(body.data.keys ?? []);
        } else {
          setError(body.error?.message ?? 'Błąd pobierania kluczy.');
        }
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setError('Błąd sieci.');
      });
  }, []);

  return { keys, error, fetchKeys };
}
