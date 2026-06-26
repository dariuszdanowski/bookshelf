import type { DetectionDTO, PhotoDTO } from '../photos/schema';

export interface ProcessSSEResult {
  photo: PhotoDTO;
  detections: DetectionDTO[];
}

/**
 * POST /api/photos/:id/process?skipMatch=1 jako SSE stream.
 *
 * Pre-stream errors (auth / key / conflict) zwracają nie-ok HTTP →
 * throw z .status i .code. Stream errors → event: error → throw z .code.
 *
 * Używaj zamiast bezpośredniego fetch, żeby uniknąć crashu taba na mobile
 * (Android OS zabija tab po ~6s czekania na blokujący HTTP request;
 * SSE stream keepalive jest traktowany inaczej przez system).
 */
export async function runProcessSSE(
  photoId: string,
  onStarted?: () => void,
): Promise<ProcessSSEResult> {
  const res = await fetch(`/api/photos/${photoId}/process?skipMatch=1`, { method: 'POST' });

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    const err = new Error(json.error?.message ?? `Błąd przetwarzania (${res.status})`);
    (err as Error & { code?: string; status?: number }).code = json.error?.code;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }

  if (!res.body) throw new Error('Brak ciała odpowiedzi.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        let event = 'message';
        let data = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }

        if (event === 'started') {
          onStarted?.();
        } else if (event === 'done') {
          reader.cancel().catch(() => {});
          return JSON.parse(data) as ProcessSSEResult;
        } else if (event === 'error') {
          reader.cancel().catch(() => {});
          const d = JSON.parse(data) as { message?: string; code?: string };
          const err = new Error(d.message ?? 'Błąd przetwarzania.');
          (err as Error & { code?: string }).code = d.code;
          throw err;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  throw new Error('Stream zakończony bez zdarzenia done.');
}
