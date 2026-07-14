import { useCallback, useState } from 'react';

import type { ApiKeyDTO } from '../lib/keys/schema';

// per-call-byok-key-override: lazy-fetch hook listy kluczy BYOK usera.
// fetchKeys() musi być wywoływane jawnie (np. przy otwarciu dialogu), NIGDY
// automatycznie w useEffect na mount — inaczej koliduje z kolejnością
// mockResolvedValueOnce() w testach, które nie renderują tych dialogów
// (zob. DetectionReview.tsx, komentarze przy dawnych ad-hoc fetchach).
export function useApiKeys(): { keys: ApiKeyDTO[] | null; fetchKeys: () => void } {
  const [keys, setKeys] = useState<ApiKeyDTO[] | null>(null);

  // useCallback (referencja stabilna) — konsumenci wołają fetchKeys z wnętrza
  // useEffect (np. hasNoCandidates-gated fetch w useDetectionDecision); bez
  // stabilnej referencji trzeba by albo pomijać ją w deps (lint), albo effect
  // odpalałby się na każdym renderze.
  const fetchKeys = useCallback(() => {
    fetch('/api/account/keys')
      .then((r) => r.json() as Promise<{ data?: { keys?: ApiKeyDTO[] } }>)
      .then((body) => setKeys(body.data?.keys ?? []))
      .catch(() => {
        /* silent — brak listy kluczy nie blokuje żadnego flow */
      });
  }, []);

  return { keys, fetchKeys };
}
