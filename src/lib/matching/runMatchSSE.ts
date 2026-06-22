export interface MatchSSEProgressEvent {
  index: number;
  total: number;
  title: string;
  matched: boolean;
  candidateTitle?: string;
  candidateAuthors?: string[];
}

/**
 * Runs the SSE match-stream for a single batch and chains to the next via nextOffset.
 * MATCH_BATCH_SIZE=1: each detection gets its own CF Worker invocation. The client
 * chains batches serially via nextOffset in the `done` event.
 *
 * Race condition safety: `settled = true` is set BEFORE `source.close()` so that
 * the transport-level `onerror` handler that fires synchronously on close cannot
 * sneak in between those two lines.
 */
export function runMatchSSE(
  photoId: string,
  sourceRef: { current: EventSource | null },
  onProgress: (data: MatchSSEProgressEvent) => void,
  offset = 0,
): Promise<{ matched: number; rateLimited: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let errorCount = 0;

    const source = new EventSource(`/api/photos/${photoId}/match-stream?offset=${offset}`);
    sourceRef.current = source;

    source.addEventListener('progress', (e) => {
      onProgress(JSON.parse((e as MessageEvent).data) as MatchSSEProgressEvent);
    });

    source.addEventListener('done', (e) => {
      if (settled) return;
      settled = true;
      source.close();
      sourceRef.current = null;
      const d = JSON.parse((e as MessageEvent).data) as {
        matched: number;
        rate_limited: number;
        nextOffset?: number;
        grandTotal?: number;
      };
      if (d.nextOffset != null && d.grandTotal != null && d.nextOffset < d.grandTotal) {
        runMatchSSE(photoId, sourceRef, onProgress, d.nextOffset)
          .then((next) =>
            resolve({
              matched: d.matched + next.matched,
              rateLimited: d.rate_limited + next.rateLimited,
            }),
          )
          .catch(reject);
      } else {
        resolve({ matched: d.matched, rateLimited: d.rate_limited });
      }
    });

    source.addEventListener('error', (e) => {
      if (settled) return;
      const msg = (() => {
        try {
          return (JSON.parse((e as MessageEvent).data) as { message?: string }).message;
        } catch {
          return undefined;
        }
      })();
      settled = true;
      source.close();
      sourceRef.current = null;
      reject(new Error(msg ?? 'Błąd matchowania.'));
    });

    source.onerror = () => {
      if (settled) return;
      errorCount++;
      if (errorCount >= 3) {
        settled = true;
        source.close();
        sourceRef.current = null;
        reject(new Error('Błąd połączenia podczas matchowania.'));
      }
    };
  });
}
