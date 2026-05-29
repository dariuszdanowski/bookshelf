import { useEffect, useState } from 'react';

import type { PhotoDTO, DetectionWithCandidatesDTO } from '../lib/photos/schema';
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

// ---------------------------------------------------------------------------
// Formularz korekty / ręcznego wpisu
// ---------------------------------------------------------------------------

type CorrectFormProps = {
  initialTitle?: string;
  initialAuthors?: string;
  mode: 'field_edit' | 'manual_entry';
  candidateId?: string;
  detectionId: string;
  onSuccess: () => void;
  onCancel: () => void;
};

function CorrectForm({
  initialTitle = '',
  initialAuthors = '',
  mode,
  candidateId,
  detectionId,
  onSuccess,
  onCancel,
}: CorrectFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [authors, setAuthors] = useState(initialAuthors);
  const [publisher, setPublisher] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        mode,
        title: title.trim(),
      };
      if (candidateId) body.candidate_id = candidateId;
      if (authors.trim()) body.authors = authors.split(',').map((a) => a.trim()).filter(Boolean);
      if (publisher.trim()) body.publisher = publisher.trim();
      if (year.trim()) body.published_year = parseInt(year, 10);

      const res = await fetch(`/api/detections/${detectionId}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (res.status === 409) {
        setErr(json.error?.message ?? 'Masz już tę książkę w katalogu.');
        return;
      }
      if (!res.ok) {
        setErr(json.error?.message ?? `Błąd (${res.status})`);
        return;
      }
      onSuccess();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      data-testid="correct-form"
      onSubmit={(e) => void handleSubmit(e)}
      className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3"
    >
      <div>
        <label className="block text-xs font-medium text-gray-700">
          Tytuł <span className="text-red-500">*</span>
        </label>
        <input
          data-testid="correct-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">
          Autor(zy) <span className="text-gray-400">(oddzielone przecinkiem)</span>
        </label>
        <input
          data-testid="correct-authors"
          value={authors}
          onChange={(e) => setAuthors(e.target.value)}
          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-700">Wydawnictwo</label>
          <input
            data-testid="correct-publisher"
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="w-24">
          <label className="block text-xs font-medium text-gray-700">Rok</label>
          <input
            data-testid="correct-year"
            type="number"
            min="1000"
            max="2100"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
      {err && (
        <p data-testid="correct-error" className="text-xs text-red-600" role="alert">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          data-testid="correct-submit"
          disabled={busy || !title.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Zapisuję...' : 'Zapisz'}
        </button>
        <button
          type="button"
          data-testid="correct-cancel"
          onClick={onCancel}
          className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Karta detekcji z akcjami
// ---------------------------------------------------------------------------

type DecisionState = 'pending' | 'decided' | 'error';

type DetectionCardProps = {
  detection: DetectionWithCandidatesDTO;
  onDecided: (detectionId: string) => void;
};

function DetectionCard({ detection, onDecided }: DetectionCardProps) {
  const [showAlts, setShowAlts] = useState(false);
  const [showCorrectForm, setShowCorrectForm] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [state, setState] = useState<DecisionState>('pending');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const top = detection.candidates[0] ?? null;
  const alts = detection.candidates.slice(1);
  const activeCandidateId = selectedCandidateId ?? top?.id ?? null;
  const activeCandidate = detection.candidates.find((c) => c.id === activeCandidateId) ?? top;

  if (state === 'decided') {
    return (
      <div
        data-testid={`detection-card-${detection.position_index}`}
        className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2"
      >
        <svg className="text-green-600 flex-shrink-0" width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        <span className="text-sm text-green-700 font-medium">{detection.raw_title}</span>
      </div>
    );
  }

  async function handleConfirm() {
    if (!activeCandidateId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/detections/${detection.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_id: activeCandidateId }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (res.status === 409) {
        setErrorMsg(json.error?.message ?? 'Masz już tę książkę w katalogu.');
        return;
      }
      if (!res.ok) {
        setErrorMsg(json.error?.message ?? `Błąd (${res.status})`);
        setState('error');
        return;
      }
      setState('decided');
      onDecided(detection.id);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/detections/${detection.id}/reject`, { method: 'POST' });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        setErrorMsg(json.error?.message ?? `Błąd (${res.status})`);
        return;
      }
      setState('decided');
      onDecided(detection.id);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  function handleCorrectSuccess() {
    setShowCorrectForm(false);
    setState('decided');
    onDecided(detection.id);
  }

  const isHigh = activeCandidate && getMatchTier(activeCandidate.matchScore) === 'high';

  return (
    <div
      data-testid={`detection-card-${detection.position_index}`}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      {/* Header */}
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

      {/* No match → manual entry form */}
      {!top && !showCorrectForm && (
        <div>
          <p
            data-testid="no-match-placeholder"
            className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500"
          >
            Brak pewnego matchu
          </p>
          <button
            data-testid="manual-entry-button"
            onClick={() => setShowCorrectForm(true)}
            className="mt-2 w-full rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            Wpisz ręcznie
          </button>
        </div>
      )}

      {/* Manual entry form */}
      {!top && showCorrectForm && (
        <CorrectForm
          mode="manual_entry"
          detectionId={detection.id}
          onSuccess={handleCorrectSuccess}
          onCancel={() => setShowCorrectForm(false)}
        />
      )}

      {/* Top candidate */}
      {top && !showCorrectForm && (
        <>
          {/* Candidate selector for alternatives */}
          {alts.length > 0 && (
            <div className="mb-2">
              <label className="block text-xs text-gray-500 mb-1">Aktywna propozycja:</label>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setSelectedCandidateId(top.id)}
                  className={`rounded px-2 py-0.5 text-xs border ${activeCandidateId === top.id ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}
                >
                  {top.title.slice(0, 30)} ({Math.round(top.matchScore * 100)}%)
                </button>
                {alts.map((alt) => (
                  <button
                    key={alt.id}
                    onClick={() => setSelectedCandidateId(alt.id)}
                    className={`rounded px-2 py-0.5 text-xs border ${activeCandidateId === alt.id ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}
                  >
                    {alt.title.slice(0, 30)} ({Math.round(alt.matchScore * 100)}%)
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active candidate card */}
          {activeCandidate && (
            <div className={`flex gap-3 rounded-lg border-2 p-3 ${TIER_STYLES[getMatchTier(activeCandidate.matchScore)].border}`}>
              <CoverImage url={activeCandidate.coverUrl} title={activeCandidate.title} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start gap-2">
                  <p data-testid="candidate-title" className="font-semibold text-gray-900 leading-tight">
                    {activeCandidate.title}
                  </p>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${TIER_STYLES[getMatchTier(activeCandidate.matchScore)].badge}`}>
                    {TIER_STYLES[getMatchTier(activeCandidate.matchScore)].label}
                  </span>
                  {isHigh && <span className="text-xs text-green-600">✓ Pre-zaznaczone</span>}
                </div>
                {activeCandidate.authors.length > 0 && (
                  <p className="mt-0.5 text-sm text-gray-600">{activeCandidate.authors.join(', ')}</p>
                )}
                {activeCandidate.publisher && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {activeCandidate.publisher}{activeCandidate.publishedYear ? `, ${activeCandidate.publishedYear}` : ''}
                  </p>
                )}
                {activeCandidate.isbn13 && (
                  <p className="mt-0.5 text-xs text-gray-400">ISBN {activeCandidate.isbn13}</p>
                )}
                <p className="mt-1 text-xs text-gray-400">
                  Pewność: {Math.round(activeCandidate.matchScore * 100)}%
                </p>
              </div>
            </div>
          )}

          {/* Alternatives toggle */}
          {alts.length > 0 && (
            <button
              onClick={() => setShowAlts((v) => !v)}
              className="mt-2 text-xs text-blue-600 hover:text-blue-800 underline"
              data-testid="toggle-alts"
            >
              {showAlts ? 'Ukryj alternatywy' : `${alts.length} alternatyw${alts.length === 1 ? 'a' : 'y'}`}
            </button>
          )}
          {showAlts && (
            <div className="mt-2 space-y-1">
              {alts.map((alt) => (
                <div key={alt.id} className="flex gap-2 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600">
                  <span className="font-medium">{alt.title}</span>
                  <span className="text-gray-400">{Math.round(alt.matchScore * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Correct form (field_edit mode) */}
      {top && showCorrectForm && (
        <CorrectForm
          mode="field_edit"
          candidateId={activeCandidateId ?? undefined}
          detectionId={detection.id}
          initialTitle={activeCandidate?.title ?? ''}
          initialAuthors={activeCandidate?.authors.join(', ') ?? ''}
          onSuccess={handleCorrectSuccess}
          onCancel={() => setShowCorrectForm(false)}
        />
      )}

      {/* Error message */}
      {errorMsg && (
        <p data-testid="detection-error" className="mt-2 text-xs text-red-600" role="alert">
          {errorMsg}
        </p>
      )}

      {/* Action buttons (only when form not shown) */}
      {!showCorrectForm && (
        <div className="mt-3 flex flex-wrap gap-2">
          {top && (
            <button
              data-testid="confirm-button"
              disabled={busy || !activeCandidateId}
              onClick={() => void handleConfirm()}
              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? 'Zapisuję...' : 'Akceptuj'}
            </button>
          )}
          <button
            data-testid="reject-button"
            disabled={busy}
            onClick={() => void handleReject()}
            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            Odrzuć
          </button>
          {top && (
            <button
              data-testid="correct-button"
              disabled={busy}
              onClick={() => setShowCorrectForm(true)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Popraw
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typy głównego komponentu
// ---------------------------------------------------------------------------

type VisionRunMeta = {
  id: string;
  model: string | null;
  created_at: string;
  cost_usd: number | null;
  latency_ms: number | null;
};

type ApiResponse = {
  data?: {
    photo: PhotoDTO;
    detections?: DetectionWithCandidatesDTO[];
    vision_run: VisionRunMeta | null;
  };
  error?: { message?: string };
};

function relativeTime(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'przed chwilą';
  if (diff < 3600) return `${Math.floor(diff / 60)} min temu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} godz. temu`;
  return `${Math.floor(diff / 86400)} dni temu`;
}

// ---------------------------------------------------------------------------
// Główny komponent
// ---------------------------------------------------------------------------

export default function DetectionReview({ photoId }: { photoId: string }) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoDTO | null>(null);
  const [detections, setDetections] = useState<DetectionWithCandidatesDTO[]>([]);
  const [visionRun, setVisionRun] = useState<VisionRunMeta | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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
        setVisionRun(json.data.vision_run ?? null);
      } catch (err) {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : 'Nie udało się załadować propozycji.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [photoId]);

  function handleDecided(detectionId: string) {
    setDecidedIds((prev) => new Set([...prev, detectionId]));
  }

  // Redirect gdy wszystkie zdecydowane (osobny useEffect na świeżym stanie)
  useEffect(() => {
    if (detections.length > 0 && detections.every((d) => decidedIds.has(d.id)) && photo?.shelf_id) {
      window.location.href = `/shelves/${photo.shelf_id}`;
    }
  }, [decidedIds, detections, photo]);

  // Pre-zaznaczone = detekcje z top kandydatem ≥ 0.75, jeszcze nie zdecydowane
  const preSelected = detections.filter(
    (d) => !decidedIds.has(d.id) && d.candidates[0] && d.candidates[0].matchScore >= MATCH_HIGH
  );

  async function handleBulkConfirm() {
    if (preSelected.length === 0) return;
    setBulkBusy(true);
    setActionMsg(null);
    try {
      const items = preSelected.map((d) => ({
        detection_id: d.id,
        candidate_id: d.candidates[0].id,
      }));
      const res = await fetch(`/api/photos/${photoId}/confirm-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const json = (await res.json()) as {
        data?: { confirmed: { detection_id: string }[]; skipped: { detection_id: string; reason: string }[] };
        error?: { message?: string };
      };
      if (!res.ok) {
        setActionMsg(json.error?.message ?? `Błąd batch (${res.status})`);
        return;
      }
      const confirmed = json.data?.confirmed ?? [];
      const skipped = json.data?.skipped ?? [];
      confirmed.forEach((c) => {
        setDecidedIds((prev) => new Set([...prev, c.detection_id]));
      });
      if (skipped.length > 0) {
        setActionMsg(`${skipped.length} pominięte (duplikaty lub błędy).`);
      }
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Błąd sieci.');
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleRerunVision() {
    if (
      !window.confirm(
        'Uruchomimy nowy vision run. Poprzednie wyniki zostaną w historii. Koszt: ~$0.01 + ~10s. OK?'
      )
    ) {
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/photos/${photoId}/process`, { method: 'POST' });
      const json = (await res.json()) as { data?: unknown; error?: { message?: string } };
      if (res.status === 409) {
        setActionMsg('Vision run w toku, poczekaj 1 minutę.');
        return;
      }
      if (res.status === 429) {
        setActionMsg('Rate limit, spróbuj za chwilę.');
        return;
      }
      if (!res.ok) {
        setActionMsg(json.error?.message ?? `Błąd (${res.status})`);
        return;
      }
      window.location.reload();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Błąd sieci.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRerunMatch() {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/photos/${photoId}/match`, { method: 'POST' });
      const json = (await res.json()) as { data?: unknown; error?: { message?: string } };
      if (res.status === 429) {
        setActionMsg('Rate limit, spróbuj za chwilę.');
        return;
      }
      if (!res.ok) {
        setActionMsg(json.error?.message ?? `Błąd matchowania (${res.status})`);
        return;
      }
      window.location.reload();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Błąd sieci.');
    } finally {
      setActionBusy(false);
    }
  }

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
  const pendingCount = detections.filter((d) => !decidedIds.has(d.id)).length;

  return (
    <div data-testid="detection-review">
      {/* Vision run metadata panel */}
      {visionRun && (
        <div
          data-testid="vision-run-panel"
          className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
        >
          <p className="text-xs text-gray-500">
            Vision: {visionRun.model ?? 'model'} &bull;{' '}
            {relativeTime(visionRun.created_at)}
            {visionRun.cost_usd != null && ` · $${visionRun.cost_usd.toFixed(4)}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              data-testid="rerun-vision-button"
              disabled={actionBusy}
              onClick={() => void handleRerunVision()}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {actionBusy ? 'Uruchamiam...' : 'Ponów vision (nowy run)'}
            </button>
            <button
              data-testid="rerun-match-button"
              disabled={actionBusy}
              onClick={() => void handleRerunMatch()}
              className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {actionBusy ? 'Dopasowuję...' : 'Ponów match'}
            </button>
          </div>
          {actionMsg && (
            <p data-testid="action-message" className="mt-1 text-xs text-amber-700" role="alert">
              {actionMsg}
            </p>
          )}
        </div>
      )}

      {/* Bulk accept bar */}
      {preSelected.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-800">
            <strong>{preSelected.length}</strong> propozycji z wysoką pewnością (≥75%)
          </p>
          <button
            data-testid="bulk-confirm-button"
            disabled={bulkBusy}
            onClick={() => void handleBulkConfirm()}
            className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {bulkBusy ? 'Akceptuję...' : 'Akceptuj pre-zaznaczone'}
          </button>
        </div>
      )}

      <p className="mb-4 text-sm text-gray-600">
        Wykryto <strong>{detections.length}</strong> &bull; dopasowano <strong>{matchedCount}</strong>
        {pendingCount > 0 && <> &bull; pozostało <strong>{pendingCount}</strong></>}
        {photo?.vision_cost_usd != null && (
          <> &bull; koszt: ${photo.vision_cost_usd.toFixed(4)}</>
        )}
      </p>

      <div className="space-y-4">
        {detections.map((det) => (
          <DetectionCard
            key={det.id}
            detection={det}
            onDecided={handleDecided}
          />
        ))}
      </div>
    </div>
  );
}
