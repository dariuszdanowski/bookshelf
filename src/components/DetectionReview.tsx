import { useEffect, useState } from 'react';

import type { PhotoDTO, DetectionWithCandidatesDTO } from '../lib/photos/schema';
import type { BookCandidateDTO } from '../lib/books/schema';
import Skeleton from './Skeleton';

const MATCH_HIGH = 0.75;
const MATCH_MID = 0.55;

type MatchTier = 'high' | 'mid' | 'low';

function getMatchTier(score: number): MatchTier {
  if (score >= MATCH_HIGH) return 'high';
  if (score >= MATCH_MID) return 'mid';
  return 'low';
}

const TIER_STYLES: Record<MatchTier, { border: string; badge: string; label: string }> = {
  high: {
    border: 'border-green-300 bg-green-50',
    badge: 'bg-green-100 text-green-800',
    label: 'Wysoka pewność',
  },
  mid: {
    border: 'border-amber-300 bg-amber-50',
    badge: 'bg-amber-100 text-amber-800',
    label: 'Sprawdź',
  },
  low: {
    border: 'border-gray-200 bg-white',
    badge: 'bg-gray-100 text-gray-600',
    label: 'Niska pewność',
  },
};

function CoverImage({ url, title }: { url: string | null; title: string }) {
  if (!url) {
    return (
      <div
        className="h-20 w-14 flex-shrink-0 rounded bg-gray-100 text-gray-300 flex items-center justify-center"
        aria-hidden="true"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 15H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V7h10v2z" />
        </svg>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Okładka: ${title}`}
      className="h-20 w-14 flex-shrink-0 rounded object-cover"
      loading="lazy"
    />
  );
}

function CandidateCard({
  candidate,
  isTop,
}: {
  candidate: BookCandidateDTO;
  isTop: boolean;
}) {
  const tier = getMatchTier(candidate.matchScore);
  const styles = TIER_STYLES[tier];
  const authorsStr = candidate.authors.join(', ');

  if (isTop) {
    return (
      <div
        data-testid="candidate-top"
        className={`flex gap-3 rounded-lg border-2 p-3 ${styles.border}`}
      >
        <CoverImage url={candidate.coverUrl} title={candidate.title} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-2">
            <p className="font-semibold text-gray-900 leading-tight">{candidate.title}</p>
            <span
              data-testid={`tier-badge-${tier}`}
              className={`rounded px-2 py-0.5 text-xs font-medium ${styles.badge}`}
            >
              {styles.label}
            </span>
          </div>
          {authorsStr && (
            <p className="mt-0.5 text-sm text-gray-600">{authorsStr}</p>
          )}
          {candidate.publisher && (
            <p className="mt-0.5 text-xs text-gray-500">{candidate.publisher}{candidate.publishedYear ? `, ${candidate.publishedYear}` : ''}</p>
          )}
          {candidate.isbn13 && (
            <p className="mt-0.5 text-xs text-gray-400">ISBN {candidate.isbn13}</p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            Pewność dopasowania: {Math.round(candidate.matchScore * 100)}%
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="candidate-alt"
      className="flex gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2"
    >
      <CoverImage url={candidate.coverUrl} title={candidate.title} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 leading-tight">{candidate.title}</p>
        {authorsStr && <p className="text-xs text-gray-600">{authorsStr}</p>}
        <p className="mt-0.5 text-xs text-gray-400">
          {Math.round(candidate.matchScore * 100)}% &bull; {candidate.source === 'google_books' ? 'Google Books' : 'OpenLibrary'}
        </p>
      </div>
    </div>
  );
}

function DetectionCard({ detection }: { detection: DetectionWithCandidatesDTO }) {
  const [showAlts, setShowAlts] = useState(false);
  const top = detection.candidates[0] ?? null;
  const alts = detection.candidates.slice(1);

  return (
    <div
      data-testid={`detection-card-${detection.position_index}`}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium text-gray-400">#{detection.position_index}</span>
        <span className="text-sm font-medium text-gray-700 truncate">{detection.raw_title}</span>
        {detection.raw_author && (
          <span className="text-xs text-gray-500 truncate">&mdash; {detection.raw_author}</span>
        )}
      </div>

      {/* Duplicate flag */}
      {detection.duplicate && (
        <div
          data-testid="duplicate-flag"
          className={`mb-2 rounded px-2 py-1 text-xs font-medium ${
            detection.duplicate.type === 'exact'
              ? 'bg-red-100 text-red-700'
              : 'bg-orange-100 text-orange-700'
          }`}
        >
          {detection.duplicate.type === 'exact'
            ? 'Masz już tę książkę w katalogu'
            : 'Masz inną edycję tej książki'}
          {detection.duplicate.shelfHint ? ` (${detection.duplicate.shelfHint})` : ''}
        </div>
      )}

      {/* No match */}
      {!top && (
        <p
          data-testid="no-match-placeholder"
          className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500"
        >
          Brak pewnego matchu — wpisz ręcznie (krok potwierdzania)
        </p>
      )}

      {/* Top candidate */}
      {top && <CandidateCard candidate={top} isTop />}

      {/* Alternatives toggle */}
      {alts.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowAlts((v) => !v)}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
            data-testid="toggle-alts"
          >
            {showAlts ? 'Ukryj alternatywy' : `${alts.length} alternatyw${alts.length === 1 ? 'a' : 'y'}`}
          </button>
          {showAlts && (
            <div className="mt-2 space-y-2">
              {alts.map((alt) => (
                <CandidateCard key={alt.id} candidate={alt} isTop={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ApiResponse = {
  data?: {
    photo: PhotoDTO;
    detections?: DetectionWithCandidatesDTO[];
  };
  error?: { message?: string };
};

export default function DetectionReview({ photoId }: { photoId: string }) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoDTO | null>(null);
  const [detections, setDetections] = useState<DetectionWithCandidatesDTO[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/photos/${photoId}`);
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok || !json.data) {
          throw new Error(json.error?.message ?? `HTTP ${res.status}`);
        }
        setPhoto(json.data.photo);
        setDetections(json.data.detections ?? []);
      } catch (err) {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : 'Nie udało się załadować propozycji.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [photoId]);

  if (loading) {
    return (
      <div data-testid="detection-review-loading" className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-4">
            <Skeleton className="mb-3 h-4 w-1/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div
        data-testid="detection-review-error"
        className="rounded-md border border-red-300 bg-red-50 px-4 py-3"
      >
        <p className="text-sm text-red-700">{errorMsg}</p>
      </div>
    );
  }

  if (detections.length === 0) {
    return (
      <div data-testid="detection-review-empty" className="rounded-xl border border-dashed border-gray-300 px-6 py-12 text-center">
        <p className="text-gray-500">Brak detekcji dla tego zdjęcia.</p>
        {photo?.status !== 'processed' && (
          <p className="mt-2 text-sm text-gray-400">Zdjęcie może być jeszcze przetwarzane.</p>
        )}
      </div>
    );
  }

  const matchedCount = detections.filter((d) => d.candidates.length > 0).length;

  return (
    <div data-testid="detection-review">
      <p className="mb-4 text-sm text-gray-600">
        Wykryto <strong>{detections.length}</strong> książek &bull; dopasowano <strong>{matchedCount}</strong>
        {photo?.vision_cost_usd != null && (
          <> &bull; koszt vision: ${photo.vision_cost_usd.toFixed(4)}</>
        )}
      </p>
      <div className="space-y-4">
        {detections.map((det) => (
          <DetectionCard key={det.id} detection={det} />
        ))}
      </div>
    </div>
  );
}
