import { useCallback, useEffect, useRef, useState } from 'react';

import type { PhotoListItemDTO } from '../lib/photos/schema';
import type { ShelfDTO } from '../lib/shelves/schema';
import ConfirmDialog from './ConfirmDialog';
import CostPanel from './CostPanel';
import ProgressModal from './ProgressModal';
import Skeleton from './Skeleton';

type Props = {
  shelfId: string;
  shelfName: string;
};

type RowState = {
  busy: boolean;
  toast: string | null;
};

const STAGE_BADGE: Record<PhotoListItemDTO['stage'], { bg: string; label: string }> = {
  uploaded: { bg: 'bg-gray-100 text-gray-600', label: 'Wgrane' },
  processing: { bg: 'bg-blue-100 text-blue-700', label: 'Vision w toku' },
  vision_done: { bg: 'bg-amber-100 text-amber-700', label: 'Wykryte' },
  match_done: { bg: 'bg-blue-100 text-blue-700', label: 'Dopasowane' },
  confirmed: { bg: 'bg-green-100 text-green-700', label: 'Zatwierdzone' },
};

function relativeTime(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'przed chwilą';
  if (diff < 3600) return `${Math.floor(diff / 60)} min temu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} godz. temu`;
  return `${Math.floor(diff / 86400)} dni temu`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pl-PL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function PhotoListIsland({ shelfId }: Props) {
  const [photos, setPhotos] = useState<PhotoListItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [pendingRerunPhotoId, setPendingRerunPhotoId] = useState<string | null>(null);
  const [pendingDeletePhotoId, setPendingDeletePhotoId] = useState<string | null>(null);
  const [shelves, setShelves] = useState<ShelfDTO[]>([]);
  const [busyOpLabel, setBusyOpLabel] = useState<string | null>(null);
  const [matchTitles, setMatchTitles] = useState<string[]>([]);
  const [matchProgress, setMatchProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [matchStats, setMatchStats] = useState<{ matched: number; unmatched: number }>({
    matched: 0,
    unmatched: 0,
  });
  const [currentMatchItem, setCurrentMatchItem] = useState<{
    title: string;
    authors?: string[];
    matched?: boolean;
  } | null>(null);
  const matchSourceRef = useRef<EventSource | null>(null);
  const [visionPhase, setVisionPhase] = useState<'vision' | 'matching' | null>(null);

  // Close any open SSE connection on unmount.
  useEffect(() => {
    const sourceRef = matchSourceRef;
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  const fetchPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/shelves/${shelfId}/photos`);
      const json = (await res.json()) as {
        data?: { photos: PhotoListItemDTO[] };
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      setPhotos(json.data.photos);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Nie udało się pobrać zdjęć.');
    } finally {
      setLoading(false);
    }
  }, [shelfId]);

  useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  // Lista półek do pickera „Przenieś" (best-effort — brak nie blokuje listy zdjęć).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/shelves');
        const json = (await res.json()) as { data?: { shelves: ShelfDTO[] } };
        if (!cancelled && res.ok && json.data) setShelves(json.data.shelves);
      } catch {
        // brak listy półek — picker po prostu się nie pokaże
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchRow = useCallback((photoId: string, patch: Partial<RowState>) => {
    setRowStates((prev) => ({
      ...prev,
      [photoId]: { ...(prev[photoId] ?? { busy: false, toast: null }), ...patch },
    }));
  }, []);

  const runMatch = useCallback(
    async (photoId: string) => {
      setBusyOpLabel('Dopasowywanie do baz książek...');
      setMatchTitles([]);
      setMatchProgress(null);
      setMatchStats({ matched: 0, unmatched: 0 });
      setCurrentMatchItem(null);
      patchRow(photoId, { busy: true, toast: null });

      try {
        const result = await new Promise<{ matched: number; rateLimited: number }>(
          (resolve, reject) => {
            let settled = false;
            let errorCount = 0;

            const source = new EventSource(`/api/photos/${photoId}/match-stream`);
            matchSourceRef.current = source;

            source.addEventListener('progress', (e) => {
              const d = JSON.parse((e as MessageEvent).data) as {
                index: number;
                total: number;
                title: string;
                matched: boolean;
                candidateTitle?: string;
                candidateAuthors?: string[];
              };
              setMatchTitles((prev) => [...prev, d.title]);
              setMatchProgress({ current: d.index, total: d.total });
              setMatchStats((prev) => ({
                matched: prev.matched + (d.matched ? 1 : 0),
                unmatched: prev.unmatched + (d.matched ? 0 : 1),
              }));
              setCurrentMatchItem({
                title: d.candidateTitle ?? d.title,
                authors: d.candidateAuthors,
                matched: d.matched,
              });
            });

            source.addEventListener('done', (e) => {
              if (settled) return;
              settled = true;
              source.close();
              matchSourceRef.current = null;
              const d = JSON.parse((e as MessageEvent).data) as {
                matched: number;
                rate_limited: number;
              };
              resolve({ matched: d.matched, rateLimited: d.rate_limited });
            });

            source.onerror = () => {
              if (settled) return;
              errorCount++;
              if (errorCount >= 3) {
                settled = true;
                source.close();
                matchSourceRef.current = null;
                fetch(`/api/photos/${photoId}/match`, { method: 'POST' })
                  .then(async (r) => {
                    const json = (await r.json()) as {
                      data?: { matched?: number; rate_limited?: number };
                      error?: { message?: string };
                    };
                    if (r.status === 429) {
                      reject(new Error('Rate limit — spróbuj za chwilę.'));
                    } else if (r.ok && json.data) {
                      resolve({
                        matched: json.data.matched ?? 0,
                        rateLimited: json.data.rate_limited ?? 0,
                      });
                    } else {
                      reject(new Error(json.error?.message ?? `Błąd matchowania (${r.status})`));
                    }
                  })
                  .catch(reject);
              }
            };
          },
        );

        // S-39: część detekcji ścięta przez limit GB mimo retry — informuj usera
        if (result.rateLimited > 0) {
          patchRow(photoId, {
            toast: `Dopasowano ${result.matched} · ${result.rateLimited} pozycji wstrzymał limit Google — ponów match za chwilę.`,
          });
        }
        await fetchPhotos();
      } catch (err) {
        patchRow(photoId, {
          toast: err instanceof Error ? err.message : 'Błąd sieci.',
        });
      } finally {
        setBusyOpLabel(null);
        setMatchTitles([]);
        setMatchProgress(null);
        patchRow(photoId, { busy: false });
      }
    },
    [fetchPhotos, patchRow],
  );

  const runVision = useCallback(
    async (photoId: string) => {
      setVisionPhase('vision');
      setBusyOpLabel('Analiza obrazu...');
      patchRow(photoId, { busy: true, toast: null });
      try {
        const res = await fetch(`/api/photos/${photoId}/process?skipMatch=1`, {
          method: 'POST',
        });
        const json = (await res.json()) as {
          data?: unknown;
          error?: { code?: string; message?: string };
        };
        if (res.status === 409) {
          patchRow(photoId, { toast: 'Run już w toku, poczekaj chwilę.' });
          return;
        }
        if (res.status === 429) {
          patchRow(photoId, { toast: 'Vision rate limit — spróbuj za chwilę.' });
          return;
        }
        if (res.status === 403 && json.error?.code === 'NO_API_KEY') {
          patchRow(photoId, { toast: 'Brak klucza API. Dodaj klucz w ustawieniach konta.' });
          return;
        }
        if (!res.ok) {
          patchRow(photoId, {
            toast: json.error?.message ?? `Błąd (${res.status})`,
          });
          return;
        }
        // Vision succeeded — run SSE matching for progress feedback
        setVisionPhase('matching');
        await runMatch(photoId);
      } catch (err) {
        patchRow(photoId, {
          toast: err instanceof Error ? err.message : 'Błąd sieci.',
        });
      } finally {
        setVisionPhase(null);
        setBusyOpLabel(null);
        patchRow(photoId, { busy: false });
      }
    },
    [patchRow, runMatch],
  );

  // Usunięcie zdjęcia: optymistyczne (zdejmujemy wiersz od razu), rollback przy błędzie.
  const deletePhoto = useCallback(
    async (photoId: string) => {
      const snapshot = photos;
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      try {
        const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
        if (!res.ok) {
          const json = (await res.json()) as { error?: { message?: string } };
          setPhotos(snapshot); // rollback
          patchRow(photoId, {
            toast: json.error?.message ?? `Nie udało się usunąć (${res.status}).`,
          });
        }
      } catch (err) {
        setPhotos(snapshot); // rollback
        patchRow(photoId, { toast: err instanceof Error ? err.message : 'Błąd sieci.' });
      }
    },
    [photos, patchRow],
  );

  // Przeniesienie zdjęcia na inną półkę: optymistyczne zdjęcie z bieżącej listy.
  const movePhoto = useCallback(
    async (photoId: string, targetShelfId: string) => {
      if (!targetShelfId || targetShelfId === shelfId) return;
      const snapshot = photos;
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      try {
        const res = await fetch(`/api/photos/${photoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shelf_id: targetShelfId }),
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: { message?: string } };
          setPhotos(snapshot); // rollback
          patchRow(photoId, {
            toast: json.error?.message ?? `Nie udało się przenieść (${res.status}).`,
          });
        }
      } catch (err) {
        setPhotos(snapshot); // rollback
        patchRow(photoId, { toast: err instanceof Error ? err.message : 'Błąd sieci.' });
      }
    },
    [photos, shelfId, patchRow],
  );

  const handleRunVision = useCallback(
    (photoId: string, isRerun: boolean) => {
      if (isRerun) {
        setPendingRerunPhotoId(photoId);
        return;
      }
      void runVision(photoId);
    },
    [runVision],
  );

  const pendingRerunPhoto = pendingRerunPhotoId
    ? (photos.find((photo) => photo.id === pendingRerunPhotoId) ?? null)
    : null;

  const pendingDeletePhoto = pendingDeletePhotoId
    ? (photos.find((photo) => photo.id === pendingDeletePhotoId) ?? null)
    : null;

  function deleteMessage(photo: PhotoListItemDTO | null): string {
    const n = photo?.detected_count ?? 0;
    const detPart =
      n > 0
        ? `Usuniemy zdjęcie wraz z ${n} wykrytymi pozycjami i propozycjami. `
        : 'Usuniemy zdjęcie. ';
    return `${detPart}Skatalogowane książki pozostaną na półkach, a historia kosztów vision zostanie zachowana. Tej operacji nie można cofnąć.`;
  }

  const otherShelves = shelves.filter((s) => s.id !== shelfId);

  function rerunEstimateMessage(photo: PhotoListItemDTO | null): string {
    if (!photo) return 'Uruchomimy nowy vision run. Poprzednie wyniki zostaną w historii.';
    const cost = photo.latest_vision_run?.cost_usd;
    const costText = cost != null ? `~$${cost.toFixed(4)}` : '~$0.01';
    const latencyText = '~10 s';
    return `Uruchomimy nowy vision run. Poprzednie wyniki zostaną w historii. Szacowany koszt: ${costText}, czas: ${latencyText}.`;
  }

  const handleRunMatch = useCallback(
    (photoId: string) => {
      void runMatch(photoId);
    },
    [runMatch],
  );

  if (loading) {
    return (
      <div data-testid="photo-list-loading" className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (globalError) {
    return (
      <div
        data-testid="photo-list-error"
        className="rounded-md border border-red-300 bg-red-50 px-4 py-3"
      >
        <p className="text-sm text-red-700">{globalError}</p>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div
        data-testid="photo-list-empty"
        className="rounded-xl border border-dashed border-gray-300 px-6 py-12 text-center"
      >
        <p className="text-gray-500">Brak zdjęć dla tej półki.</p>
        <p className="mt-2">
          <a href="/upload" className="text-sm text-blue-600 hover:text-blue-800">
            Wgraj pierwsze →
          </a>
        </p>
      </div>
    );
  }

  return (
    <>
      <ul data-testid="photo-list" className="space-y-3">
        {photos.map((photo) => {
          const rowState = rowStates[photo.id] ?? { busy: false, toast: null };
          const badge = STAGE_BADGE[photo.stage];
          const isRerun = photo.stage !== 'uploaded' && photo.stage !== 'processing';
          // Blokujemy usuwanie/przenoszenie dopóki trwa vision run — współbieżny
          // process.ts zapisuje detekcje/koszt do tego wiersza.
          const isLocked = photo.has_running_run || photo.stage === 'processing';

          return (
            <li
              key={photo.id}
              data-testid={`photo-item-${photo.id}`}
              className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start"
            >
              {/* Thumbnail — S-28: na mobile (układ kolumnowy) pełna szerokość karty,
                na sm+ wraca kompaktowy kwadrat obok treści.
                M10: klik w miniaturę otwiera propozycje (nie tylko przycisk). */}
              <a
                href={`/photos/${photo.id}`}
                data-testid={`photo-thumb-link-${photo.id}`}
                aria-label="Otwórz propozycje dla tego zdjęcia"
                className="block flex-shrink-0"
              >
                {photo.thumbnail_url ? (
                  // M16: na sm+ większy podgląd BEZ kadrowania (h-28 + w-auto =
                  // naturalne proporcje; max-w z object-contain zamiast crop).
                  // M15: lazy + async — lista nie blokuje się na obrazach.
                  <img
                    src={photo.thumbnail_url}
                    alt="Miniatura zdjęcia półki"
                    loading="lazy"
                    decoding="async"
                    className="h-40 w-full rounded object-cover sm:h-28 sm:w-auto sm:max-w-56 sm:object-contain"
                  />
                ) : (
                  <div
                    className="flex h-40 w-full items-center justify-center rounded bg-gray-100 text-gray-400 sm:h-28 sm:w-40"
                    aria-hidden="true"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                    </svg>
                  </div>
                )}
              </a>

              {/* Content */}
              <div className="min-w-0 flex-1">
                {/* Stage badge + date */}
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span
                    data-testid={`stage-badge-${photo.id}`}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.bg}`}
                  >
                    {photo.stage === 'processing' && (
                      <span className="inline-block h-2 w-2 animate-spin rounded-full border border-blue-700 border-t-transparent" />
                    )}
                    {badge.label}
                  </span>
                  {photo.legacy_no_hash && (
                    <span
                      data-testid={`legacy-hash-badge-${photo.id}`}
                      title="Wgrane przed wdrożeniem deduplikacji — możliwy duplikat"
                      className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800"
                    >
                      ⚠ Bez hash
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{formatDate(photo.created_at)}</span>
                </div>

                {/* Counters */}
                <p className="text-xs text-gray-500">
                  {photo.detected_count} wykryto · {photo.matched_count} dopasowano ·{' '}
                  {photo.confirmed_count} zatwierdzono
                </p>

                {/* Vision run metadata — M26: koszt jako przycisk CostPanel
                    (wartość = etykieta, hint tłumaczy; spójnie z review) */}
                {photo.latest_vision_run && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <p className="text-xs text-gray-400">
                      {photo.latest_vision_run.model ?? 'vision'} ·{' '}
                      {relativeTime(photo.latest_vision_run.created_at)}
                    </p>
                    <CostPanel
                      photoId={photo.id}
                      label={(() => {
                        // M26: PEŁNA suma (vision + OCR) z API; fallback latest run
                        const total = photo.total_cost_usd ?? photo.latest_vision_run.cost_usd;
                        return total != null ? `$${total.toFixed(4)}` : 'koszt';
                      })()}
                      hint="Pełny koszt AI tego zdjęcia (wszystkie analizy vision + doczytywanie OCR ramek). Kliknij, by zobaczyć listę wywołań z cenami."
                      preloadedVisionRun={{
                        id: photo.latest_vision_run.id,
                        model: photo.latest_vision_run.model,
                        created_at: photo.latest_vision_run.created_at,
                        cost_usd: photo.latest_vision_run.cost_usd,
                        latency_ms: null,
                        status: 'completed',
                      }}
                    />
                  </div>
                )}

                {/* Per-row toast */}
                {rowState.toast && (
                  <p
                    data-testid={`row-toast-${photo.id}`}
                    className="mt-1 text-xs text-amber-700"
                    role="alert"
                  >
                    {rowState.toast}
                  </p>
                )}

                {/* Action buttons */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {photo.stage === 'uploaded' && (
                    <button
                      data-testid={`run-vision-${photo.id}`}
                      disabled={rowState.busy || isLocked}
                      title={isLocked ? 'Trwa analiza, poczekaj na zakończenie' : undefined}
                      onClick={() => handleRunVision(photo.id, false)}
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {rowState.busy || isLocked ? 'Uruchamiam...' : 'Uruchom vision'}
                    </button>
                  )}

                  {isRerun && (
                    <button
                      data-testid={`rerun-vision-${photo.id}`}
                      disabled={rowState.busy || isLocked}
                      title={isLocked ? 'Trwa analiza, poczekaj na zakończenie' : undefined}
                      onClick={() => handleRunVision(photo.id, true)}
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Ponów vision (nowy run)
                    </button>
                  )}

                  {photo.stage === 'vision_done' && (
                    <button
                      data-testid={`run-match-${photo.id}`}
                      disabled={rowState.busy || isLocked}
                      title={isLocked ? 'Trwa analiza, poczekaj na zakończenie' : undefined}
                      onClick={() => handleRunMatch(photo.id)}
                      className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    >
                      {rowState.busy ? 'Dopasowuję...' : 'Uruchom match'}
                    </button>
                  )}

                  {(photo.stage === 'match_done' || photo.stage === 'confirmed') && (
                    <button
                      data-testid={`rerun-match-${photo.id}`}
                      disabled={rowState.busy || isLocked}
                      title={isLocked ? 'Trwa analiza, poczekaj na zakończenie' : undefined}
                      onClick={() => handleRunMatch(photo.id)}
                      className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    >
                      {rowState.busy ? 'Dopasowuję...' : 'Ponów match'}
                    </button>
                  )}

                  <a
                    href={`/photos/${photo.id}`}
                    data-testid={`open-review-${photo.id}`}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {isRerun ? 'Otwórz review' : 'Otwórz'}
                  </a>

                  {/* Przenieś na inną półkę (PATCH shelf_id) */}
                  {otherShelves.length > 0 && (
                    <select
                      data-testid={`move-photo-${photo.id}`}
                      disabled={isLocked}
                      value=""
                      onChange={(e) => void movePhoto(photo.id, e.target.value)}
                      title={
                        isLocked
                          ? 'Trwa analiza, poczekaj na zakończenie'
                          : 'Przenieś na inną półkę'
                      }
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="" disabled>
                        Przenieś na…
                      </option>
                      {otherShelves.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Usuń zdjęcie */}
                  <button
                    data-testid={`delete-photo-${photo.id}`}
                    disabled={isLocked}
                    onClick={() => setPendingDeletePhotoId(photo.id)}
                    title={isLocked ? 'Trwa analiza, poczekaj na zakończenie' : 'Usuń zdjęcie'}
                    className="inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Usuń
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingRerunPhoto != null}
        title="Ponowić vision?"
        message={rerunEstimateMessage(pendingRerunPhoto)}
        confirmLabel="Uruchom nowy run"
        cancelLabel="Anuluj"
        testIdPrefix="photo-rerun-confirm"
        onCancel={() => setPendingRerunPhotoId(null)}
        onConfirm={() => {
          if (!pendingRerunPhotoId) return;
          const nextPhotoId = pendingRerunPhotoId;
          setPendingRerunPhotoId(null);
          void runVision(nextPhotoId);
        }}
      />

      <ConfirmDialog
        open={pendingDeletePhoto != null}
        title="Usunąć zdjęcie?"
        message={deleteMessage(pendingDeletePhoto)}
        confirmLabel="Usuń zdjęcie"
        cancelLabel="Anuluj"
        confirmTone="danger"
        testIdPrefix="photo-delete-confirm"
        onCancel={() => setPendingDeletePhotoId(null)}
        onConfirm={() => {
          if (!pendingDeletePhotoId) return;
          const nextPhotoId = pendingDeletePhotoId;
          setPendingDeletePhotoId(null);
          void deletePhoto(nextPhotoId);
        }}
      />

      <ProgressModal
        open={busyOpLabel !== null}
        label={busyOpLabel ?? ''}
        steps={
          visionPhase !== null
            ? [
                {
                  label: 'Analiza obrazu',
                  status: visionPhase === 'vision' ? 'active' : 'done',
                },
                {
                  label: 'Dopasowywanie',
                  status: visionPhase === 'matching' ? 'active' : 'pending',
                },
              ]
            : undefined
        }
        titles={matchTitles.length > 0 ? matchTitles : undefined}
        progress={matchProgress ?? undefined}
        stats={matchProgress !== null ? matchStats : null}
        currentItem={currentMatchItem}
      />
    </>
  );
}
