import { useCallback, useEffect, useState } from 'react';

import type { PhotoListItemDTO } from '../lib/photos/schema';
import Skeleton from './Skeleton';

type Props = {
  shelfId: string;
  shelfName: string;
};

type RowState = {
  busy: boolean;
  toast: string | null;
};

const STAGE_BADGE: Record<
  PhotoListItemDTO['stage'],
  { bg: string; label: string }
> = {
  uploaded:   { bg: 'bg-gray-100 text-gray-600',   label: 'Wgrane' },
  processing: { bg: 'bg-blue-100 text-blue-700',   label: 'Vision w toku' },
  vision_done:{ bg: 'bg-amber-100 text-amber-700', label: 'Wykryte' },
  match_done: { bg: 'bg-blue-100 text-blue-700',   label: 'Dopasowane' },
  confirmed:  { bg: 'bg-green-100 text-green-700', label: 'Zatwierdzone' },
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
      setGlobalError(
        err instanceof Error ? err.message : 'Nie udało się pobrać zdjęć.'
      );
    } finally {
      setLoading(false);
    }
  }, [shelfId]);

  useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  const patchRow = useCallback(
    (photoId: string, patch: Partial<RowState>) => {
      setRowStates((prev) => ({
        ...prev,
        [photoId]: { ...(prev[photoId] ?? { busy: false, toast: null }), ...patch },
      }));
    },
    []
  );

  const runVision = useCallback(
    async (photoId: string) => {
      patchRow(photoId, { busy: true, toast: null });
      try {
        const res = await fetch(`/api/photos/${photoId}/process`, {
          method: 'POST',
        });
        const json = (await res.json()) as {
          data?: unknown;
          error?: { message?: string };
        };
        if (res.status === 409) {
          patchRow(photoId, { toast: 'Run już w toku, poczekaj chwilę.' });
          return;
        }
        if (res.status === 429) {
          patchRow(photoId, { toast: 'Vision rate limit — spróbuj za chwilę.' });
          return;
        }
        if (!res.ok) {
          patchRow(photoId, {
            toast: json.error?.message ?? `Błąd (${res.status})`,
          });
          return;
        }
        await fetchPhotos();
      } catch (err) {
        patchRow(photoId, {
          toast: err instanceof Error ? err.message : 'Błąd sieci.',
        });
      } finally {
        patchRow(photoId, { busy: false });
      }
    },
    [fetchPhotos, patchRow]
  );

  const runMatch = useCallback(
    async (photoId: string) => {
      patchRow(photoId, { busy: true, toast: null });
      try {
        const res = await fetch(`/api/photos/${photoId}/match`, {
          method: 'POST',
        });
        const json = (await res.json()) as {
          data?: unknown;
          error?: { message?: string };
        };
        if (res.status === 429) {
          patchRow(photoId, { toast: 'Rate limit — spróbuj za chwilę.' });
          return;
        }
        if (!res.ok) {
          patchRow(photoId, {
            toast: json.error?.message ?? `Błąd matchowania (${res.status})`,
          });
          return;
        }
        await fetchPhotos();
      } catch (err) {
        patchRow(photoId, {
          toast: err instanceof Error ? err.message : 'Błąd sieci.',
        });
      } finally {
        patchRow(photoId, { busy: false });
      }
    },
    [fetchPhotos, patchRow]
  );

  const handleRunVision = useCallback(
    (photoId: string, isRerun: boolean) => {
      if (
        isRerun &&
        !window.confirm(
          'Uruchomimy nowy vision run. Poprzednie wyniki zostaną w historii. Koszt: ~$0.01 + ~10s. OK?'
        )
      ) {
        return;
      }
      void runVision(photoId);
    },
    [runVision]
  );

  const handleRunMatch = useCallback(
    (photoId: string) => {
      void runMatch(photoId);
    },
    [runMatch]
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
    <ul data-testid="photo-list" className="space-y-3">
      {photos.map((photo) => {
        const rowState = rowStates[photo.id] ?? { busy: false, toast: null };
        const badge = STAGE_BADGE[photo.stage];
        const isRerun =
          photo.stage !== 'uploaded' && photo.stage !== 'processing';

        return (
          <li
            key={photo.id}
            data-testid={`photo-item-${photo.id}`}
            className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start"
          >
            {/* Thumbnail */}
            <div className="flex-shrink-0">
              {photo.thumbnail_url ? (
                <img
                  src={photo.thumbnail_url}
                  alt="Miniatura zdjęcia półki"
                  className="h-16 w-16 rounded object-cover"
                />
              ) : (
                <div
                  className="flex h-16 w-16 items-center justify-center rounded bg-gray-100 text-gray-400"
                  aria-hidden="true"
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                  </svg>
                </div>
              )}
            </div>

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
                <span className="text-xs text-gray-400">
                  {formatDate(photo.created_at)}
                </span>
              </div>

              {/* Counters */}
              <p className="text-xs text-gray-500">
                {photo.detected_count} wykryto · {photo.matched_count} dopasowano ·{' '}
                {photo.confirmed_count} zatwierdzono
              </p>

              {/* Vision run metadata */}
              {photo.latest_vision_run && (
                <p className="mt-0.5 text-xs text-gray-400">
                  {photo.latest_vision_run.model ?? 'vision'} ·{' '}
                  {relativeTime(photo.latest_vision_run.created_at)}
                  {photo.latest_vision_run.cost_usd != null &&
                    ` · $${photo.latest_vision_run.cost_usd.toFixed(4)}`}
                </p>
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
                    disabled={rowState.busy}
                    onClick={() => handleRunVision(photo.id, false)}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {rowState.busy ? 'Uruchamiam...' : 'Uruchom vision'}
                  </button>
                )}

                {isRerun && (
                  <button
                    data-testid={`rerun-vision-${photo.id}`}
                    disabled={rowState.busy}
                    onClick={() => handleRunVision(photo.id, true)}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Ponów vision (nowy run)
                  </button>
                )}

                {photo.stage === 'vision_done' && (
                  <button
                    data-testid={`run-match-${photo.id}`}
                    disabled={rowState.busy}
                    onClick={() => handleRunMatch(photo.id)}
                    className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {rowState.busy ? 'Dopasowuję...' : 'Uruchom match'}
                  </button>
                )}

                {(photo.stage === 'match_done' || photo.stage === 'confirmed') && (
                  <button
                    data-testid={`rerun-match-${photo.id}`}
                    disabled={rowState.busy}
                    onClick={() => handleRunMatch(photo.id)}
                    className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {rowState.busy ? 'Dopasowuję...' : 'Ponów match'}
                  </button>
                )}

                {isRerun && (
                  <a
                    href={`/photos/${photo.id}`}
                    data-testid={`open-review-${photo.id}`}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Otwórz review
                  </a>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
