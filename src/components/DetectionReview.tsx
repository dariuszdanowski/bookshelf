import { useEffect, useState } from 'react';

import type { BookCandidateDTO } from '../lib/books/schema';
import type { PhotoDTO, DetectionWithCandidatesDTO, BboxEditSet } from '../lib/photos/schema';
import { classifyCropQuality } from '../lib/matching/fallbackPolicy';
import ConfirmDialog from './ConfirmDialog';
import PhotoDetectionOverlay from './PhotoDetectionOverlay';
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
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
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
      onError={() => setFailed(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Formularz korekty / ręcznego wpisu
// ---------------------------------------------------------------------------

type CorrectFormProps = {
  initialTitle?: string;
  initialAuthors?: string;
  initialPublisher?: string;
  initialYear?: string;
  mode: 'field_edit' | 'manual_entry';
  candidateId?: string;
  detectionId: string;
  onSuccess: () => void;
  onCancel: () => void;
};

function CorrectForm({
  initialTitle = '',
  initialAuthors = '',
  initialPublisher = '',
  initialYear = '',
  mode,
  candidateId,
  detectionId,
  onSuccess,
  onCancel,
}: CorrectFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [authors, setAuthors] = useState(initialAuthors);
  const [publisher, setPublisher] = useState(initialPublisher);
  const [year, setYear] = useState(initialYear);
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

// ---------------------------------------------------------------------------
// Hook decyzji — współdzielona logika akceptacji/odrzucenia/korekty per detekcja.
// Wyekstrahowany z DetectionCard, by 3 tryby prezentacji (Karty/Lista/Kafelki)
// nie duplikowały wywołań API. Render-specific UI (showAlts, showCorrectForm)
// zostaje lokalny w każdym wariancie prezentacji.
// ---------------------------------------------------------------------------

function useDetectionDecision(
  detection: DetectionWithCandidatesDTO,
  onDecided: (detectionId: string) => void,
  onRefined?: (next: DetectionWithCandidatesDTO) => void
) {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [state, setState] = useState<DecisionState>('pending');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const top = detection.candidates[0] ?? null;
  const alts = detection.candidates.slice(1);
  const activeCandidateId = selectedCandidateId ?? top?.id ?? null;
  const activeCandidate = detection.candidates.find((c) => c.id === activeCandidateId) ?? top;

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

  async function handleRefine() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/detections/${detection.id}/refine`, { method: 'POST' });
      const json = (await res.json()) as {
        data?: {
          applied?: boolean;
          message?: string;
          detection?: Partial<DetectionWithCandidatesDTO>;
          candidates?: BookCandidateDTO[];
          duplicate?: DetectionWithCandidatesDTO['duplicate'];
        };
        error?: { message?: string };
      };

      if (res.status === 429) {
        setErrorMsg('Rate limit, spróbuj za chwilę.');
        return;
      }

      if (!res.ok) {
        setErrorMsg(json.error?.message ?? `Błąd refine (${res.status})`);
        return;
      }

      if (json.data?.applied === false) {
        setErrorMsg(json.data.message ?? 'Doprecyzowanie nie poprawiło odczytu.');
        return;
      }

      const nextDetection = json.data?.detection;
      if (nextDetection) {
        onRefined?.({
          ...detection,
          ...nextDetection,
          candidates: json.data?.candidates ?? detection.candidates,
          duplicate: json.data?.duplicate ?? detection.duplicate,
        });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  // Po sukcesie korekty: detekcja zdecydowana. Komponent przechodzi w widok
  // 'decided' (early return), więc reset lokalnego showCorrectForm jest zbędny.
  function handleCorrectSuccess() {
    setState('decided');
    onDecided(detection.id);
  }

  return {
    selectedCandidateId,
    setSelectedCandidateId,
    state,
    busy,
    errorMsg,
    top,
    alts,
    activeCandidateId,
    activeCandidate,
    handleConfirm,
    handleReject,
    handleRefine,
    handleCorrectSuccess,
  };
}

type DetectionCardProps = {
  detection: DetectionWithCandidatesDTO;
  onDecided: (detectionId: string) => void;
  onRefined?: (next: DetectionWithCandidatesDTO) => void;
  onSelect?: (detectionId: string) => void;
  isSelected?: boolean;
  onNavigateToMarker?: () => void;
};

function DetectionCard({ detection, onDecided, onRefined, onSelect, isSelected = false, onNavigateToMarker }: DetectionCardProps) {
  const [showAlts, setShowAlts] = useState(false);
  const [showCorrectForm, setShowCorrectForm] = useState(false);
  const {
    setSelectedCandidateId,
    state,
    busy,
    errorMsg,
    top,
    alts,
    activeCandidateId,
    activeCandidate,
    handleConfirm,
    handleReject,
    handleRefine,
    handleCorrectSuccess,
  } = useDetectionDecision(detection, onDecided, onRefined);

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

  const isHigh = activeCandidate && getMatchTier(activeCandidate.matchScore) === 'high';

  return (
    <div
      data-testid={`detection-card-${detection.position_index}`}
      className={`rounded-xl border bg-white p-4 shadow-sm ${isSelected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-200'}`}
      onClick={() => onSelect?.(detection.id)}
    >
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium text-gray-400">#{detection.position_index}</span>
        <span className="text-sm font-medium text-gray-700 truncate">{detection.raw_title}</span>
        {detection.raw_author && (
          <span className="text-xs text-gray-500 truncate">&mdash; {detection.raw_author}</span>
        )}
        {onNavigateToMarker && (
          <button
            type="button"
            title="Przejdź do ramki na zdjęciu"
            className="ml-auto flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-blue-50 hover:text-blue-500"
            onClick={(e) => { e.stopPropagation(); onNavigateToMarker(); }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="7" cy="7" r="3" />
              <line x1="7" y1="1" x2="7" y2="4" />
              <line x1="7" y1="10" x2="7" y2="13" />
              <line x1="1" y1="7" x2="4" y2="7" />
              <line x1="10" y1="7" x2="13" y2="7" />
            </svg>
          </button>
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
          initialPublisher={activeCandidate?.publisher ?? ''}
          initialYear={activeCandidate?.publishedYear ? String(activeCandidate.publishedYear) : ''}
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
          {(() => {
            const quality = classifyCropQuality(detection.bbox);
            const isWeak = quality === 'uncertain_localization';
            return (
              <button
                data-testid="refine-button"
                disabled={busy}
                onClick={() => void handleRefine()}
                title={isWeak ? '⚠ Crop o niskiej jakości (poziomy lub mały bbox) — wynik OCR może być słaby. Kliknij żeby spróbować mimo to.' : detection.bbox ? 'Doprecyzuj odczyt z cropa' : 'Doprecyzuj odczyt bez bbox'}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${isWeak ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
              >
                {busy ? 'Doprecyzowuję...' : isWeak ? '⚠ Spróbuj OCR' : 'Doprecyzuj odczyt'}
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal korekty — opakowuje istniejący CorrectForm dla trybów Lista/Kafelki
// (w trybie Karty korekta zostaje inline). Zamknięcie: Esc lub klik w tło.
// ---------------------------------------------------------------------------

export function CorrectionModal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        data-testid="correction-modal"
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-md overflow-auto rounded-xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// Wspólny modal korekty dla trybów Lista/Kafelki — wybiera tryb field_edit vs
// manual_entry na podstawie obecności kandydata i pre-wypełnia z activeCandidate.
function DetectionCorrectionModal({
  detection,
  activeCandidate,
  activeCandidateId,
  onClose,
  onSuccess,
}: {
  detection: DetectionWithCandidatesDTO;
  activeCandidate: BookCandidateDTO | null;
  activeCandidateId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const hasMatch = detection.candidates.length > 0;
  return (
    <CorrectionModal onClose={onClose}>
      <CorrectForm
        mode={hasMatch ? 'field_edit' : 'manual_entry'}
        candidateId={hasMatch ? (activeCandidateId ?? undefined) : undefined}
        detectionId={detection.id}
        initialTitle={activeCandidate?.title ?? ''}
        initialAuthors={activeCandidate?.authors.join(', ') ?? ''}
        initialPublisher={activeCandidate?.publisher ?? ''}
        initialYear={activeCandidate?.publishedYear ? String(activeCandidate.publishedYear) : ''}
        onSuccess={onSuccess}
        onCancel={onClose}
      />
    </CorrectionModal>
  );
}

// ---------------------------------------------------------------------------
// Wiersz detekcji (tryb Lista) — kompakt 1-linia, akcje na top-kandydacie,
// korekta przez modal. Współdzieli logikę decyzji z Kartami (useDetectionDecision).
// ---------------------------------------------------------------------------

type DetectionRowProps = {
  detection: DetectionWithCandidatesDTO;
  onDecided: (detectionId: string) => void;
  onRefined?: (next: DetectionWithCandidatesDTO) => void;
  onSelect?: (detectionId: string) => void;
  isSelected?: boolean;
  onNavigateToMarker?: () => void;
};

export function DetectionRow({ detection, onDecided, onRefined, onSelect, isSelected = false, onNavigateToMarker }: DetectionRowProps) {
  const [showModal, setShowModal] = useState(false);
  const {
    state,
    busy,
    errorMsg,
    top,
    activeCandidateId,
    activeCandidate,
    handleConfirm,
    handleReject,
    handleRefine,
    handleCorrectSuccess,
  } = useDetectionDecision(detection, onDecided, onRefined);

  if (state === 'decided') {
    return (
      <div
        data-testid={`detection-row-${detection.position_index}`}
        className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2"
      >
        <svg className="flex-shrink-0 text-green-600" width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        <span className="truncate text-sm font-medium text-green-700">{detection.raw_title}</span>
      </div>
    );
  }

  const displayTitle = activeCandidate?.title ?? detection.raw_title;
  const displayAuthor =
    (activeCandidate?.authors.length ? activeCandidate.authors.join(', ') : detection.raw_author) ?? '';

  return (
    <div
      data-testid={`detection-row-${detection.position_index}`}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-white px-3 py-2 ${isSelected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-200'}`}
      onClick={() => onSelect?.(detection.id)}
    >
      <span className="text-xs font-medium text-gray-400">#{detection.position_index}</span>
      {onNavigateToMarker && (
        <button
          type="button"
          title="Przejdź do ramki na zdjęciu"
          className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-blue-50 hover:text-blue-500"
          onClick={(e) => { e.stopPropagation(); onNavigateToMarker(); }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="3" />
            <line x1="7" y1="1" x2="7" y2="4" />
            <line x1="7" y1="10" x2="7" y2="13" />
            <line x1="1" y1="7" x2="4" y2="7" />
            <line x1="10" y1="7" x2="13" y2="7" />
          </svg>
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-gray-800">{displayTitle}</span>
        {displayAuthor && (
          <span className="truncate text-xs text-gray-500">&mdash; {displayAuthor}</span>
        )}
        {detection.duplicate && (
          <span
            data-testid="duplicate-flag"
            className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              detection.duplicate.type === 'exact'
                ? 'bg-red-100 text-red-700'
                : 'bg-orange-100 text-orange-700'
            }`}
          >
            {detection.duplicate.type === 'exact' ? 'Duplikat' : 'Inna edycja'}
          </span>
        )}
      </div>

      {activeCandidate ? (
        <span
          className={`flex-shrink-0 rounded px-2 py-0.5 text-xs font-medium ${TIER_STYLES[getMatchTier(activeCandidate.matchScore)].badge}`}
        >
          {Math.round(activeCandidate.matchScore * 100)}%
        </span>
      ) : (
        <span data-testid="no-match-placeholder" className="flex-shrink-0 text-xs text-gray-400">
          Brak matchu
        </span>
      )}

      {errorMsg && (
        <span data-testid="detection-error" className="w-full text-xs text-red-600" role="alert">
          {errorMsg}
        </span>
      )}

      <div className="flex flex-shrink-0 gap-1">
        {top && (
          <button
            data-testid="confirm-button"
            disabled={busy || !activeCandidateId}
            onClick={() => void handleConfirm()}
            className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? '...' : 'Akceptuj'}
          </button>
        )}
        <button
          data-testid="reject-button"
          disabled={busy}
          onClick={() => void handleReject()}
          className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Odrzuć
        </button>
        {top ? (
          <button
            data-testid="correct-button"
            disabled={busy}
            onClick={() => setShowModal(true)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Popraw
          </button>
        ) : (
          <button
            data-testid="manual-entry-button"
            onClick={() => setShowModal(true)}
            className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            Wpisz ręcznie
          </button>
        )}
        {(() => {
          const quality = classifyCropQuality(detection.bbox);
          const isWeak = quality === 'uncertain_localization';
          return (
            <button
              data-testid="refine-button"
              disabled={busy}
              onClick={() => void handleRefine()}
              title={isWeak ? '⚠ Słaby crop — wynik może być słaby' : 'Doprecyzuj odczyt'}
              className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${isWeak ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
            >
              {busy ? '...' : isWeak ? '⚠ OCR' : 'Refine'}
            </button>
          );
        })()}
      </div>

      {showModal && (
        <DetectionCorrectionModal
          detection={detection}
          activeCandidate={activeCandidate}
          activeCandidateId={activeCandidateId}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            handleCorrectSuccess();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kafelek detekcji (tryb Kafelki) — okładka + tytuł + badge + mini-akcje;
// korekta przez modal. Współdzieli logikę decyzji (useDetectionDecision).
// ---------------------------------------------------------------------------

type DetectionTileProps = {
  detection: DetectionWithCandidatesDTO;
  onDecided: (detectionId: string) => void;
  onRefined?: (next: DetectionWithCandidatesDTO) => void;
  onSelect?: (detectionId: string) => void;
  isSelected?: boolean;
  onNavigateToMarker?: () => void;
};

export function DetectionTile({ detection, onDecided, onRefined, onSelect, isSelected = false, onNavigateToMarker }: DetectionTileProps) {
  const [showModal, setShowModal] = useState(false);
  const {
    state,
    busy,
    errorMsg,
    top,
    activeCandidateId,
    activeCandidate,
    handleConfirm,
    handleReject,
    handleRefine,
    handleCorrectSuccess,
  } = useDetectionDecision(detection, onDecided, onRefined);

  if (state === 'decided') {
    return (
      <div
        data-testid={`detection-tile-${detection.position_index}`}
        className="flex flex-col items-center justify-center rounded-xl border border-green-200 bg-green-50 p-3 text-center"
      >
        <svg className="text-green-600" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        <span className="mt-1 w-full truncate text-xs font-medium text-green-700">{detection.raw_title}</span>
      </div>
    );
  }

  const displayTitle = activeCandidate?.title ?? detection.raw_title;

  return (
    <div
      data-testid={`detection-tile-${detection.position_index}`}
      className={`flex flex-col rounded-xl border bg-white p-3 shadow-sm ${isSelected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-200'}`}
      onClick={() => onSelect?.(detection.id)}
    >
      <div className="flex justify-center">
        <CoverImage url={activeCandidate?.coverUrl ?? null} title={displayTitle} />
      </div>

      <div className="mt-2 flex items-center gap-1">
        <span className="text-xs font-medium text-gray-400">#{detection.position_index}</span>
        {onNavigateToMarker && (
          <button
            type="button"
            title="Przejdź do ramki na zdjęciu"
            className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-blue-50 hover:text-blue-500"
            onClick={(e) => { e.stopPropagation(); onNavigateToMarker(); }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="7" cy="7" r="3" />
              <line x1="7" y1="1" x2="7" y2="4" />
              <line x1="7" y1="10" x2="7" y2="13" />
              <line x1="1" y1="7" x2="4" y2="7" />
              <line x1="10" y1="7" x2="13" y2="7" />
            </svg>
          </button>
        )}
        {activeCandidate ? (
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TIER_STYLES[getMatchTier(activeCandidate.matchScore)].badge}`}>
            {Math.round(activeCandidate.matchScore * 100)}%
          </span>
        ) : (
          <span data-testid="no-match-placeholder" className="text-xs text-gray-400">
            Brak matchu
          </span>
        )}
      </div>

      <p className="mt-1 line-clamp-2 text-sm font-medium text-gray-800" title={displayTitle}>
        {displayTitle}
      </p>

      {detection.duplicate && (
        <span
          data-testid="duplicate-flag"
          className={`mt-1 w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${
            detection.duplicate.type === 'exact'
              ? 'bg-red-100 text-red-700'
              : 'bg-orange-100 text-orange-700'
          }`}
        >
          {detection.duplicate.type === 'exact' ? 'Duplikat' : 'Inna edycja'}
        </span>
      )}

      {errorMsg && (
        <p data-testid="detection-error" className="mt-1 text-xs text-red-600" role="alert">
          {errorMsg}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {top && (
          <button
            data-testid="confirm-button"
            disabled={busy || !activeCandidateId}
            onClick={() => void handleConfirm()}
            className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? '...' : 'Akceptuj'}
          </button>
        )}
        <button
          data-testid="reject-button"
          disabled={busy}
          onClick={() => void handleReject()}
          className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Odrzuć
        </button>
        {top ? (
          <button
            data-testid="correct-button"
            disabled={busy}
            onClick={() => setShowModal(true)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Popraw
          </button>
        ) : (
          <button
            data-testid="manual-entry-button"
            onClick={() => setShowModal(true)}
            className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            Wpisz ręcznie
          </button>
        )}
        <button
          data-testid="refine-button"
          disabled={busy}
          onClick={() => void handleRefine()}
          title={detection.bbox ? 'Refine crop' : 'Refine without bbox'}
          className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          {busy ? '...' : 'Refine'}
        </button>
      </div>

      {showModal && (
        <DetectionCorrectionModal
          detection={detection}
          activeCandidate={activeCandidate}
          activeCandidateId={activeCandidateId}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            handleCorrectSuccess();
          }}
        />
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
    photo_url?: string | null;
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

function formatCostEstimate(costUsd: number | null | undefined): string {
  if (costUsd == null || !Number.isFinite(costUsd) || costUsd <= 0) {
    return '~$0.01';
  }
  return `~$${costUsd.toFixed(4)}`;
}

function formatDurationEstimate(latencyMs: number | null | undefined): string {
  if (latencyMs == null || !Number.isFinite(latencyMs) || latencyMs <= 0) {
    return '~10 s';
  }
  const seconds = Math.max(1, Math.round(latencyMs / 1000));
  return `~${seconds} s`;
}

// ---------------------------------------------------------------------------
// Tryb prezentacji listy detekcji (Karty / Lista / Kafelki)
// ---------------------------------------------------------------------------

export type DetectionViewMode = 'cards' | 'list' | 'tiles';

export const VIEW_MODE_STORAGE_KEY = 'bookshelf:detection-view-mode';
const VIEW_MODES: readonly DetectionViewMode[] = ['cards', 'list', 'tiles'];
const VIEW_MODE_LABELS: Record<DetectionViewMode, string> = {
  cards: 'Karty',
  list: 'Lista',
  tiles: 'Kafelki',
};

function isViewMode(v: unknown): v is DetectionViewMode {
  return typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v);
}

// Default zależny od szerokości. W SSR oraz jsdom (brak window.matchMedia)
// świadomie zwracamy 'cards' — inaczej testy review oczekujące kart by padły.
// Do 'list' schodzimy WYŁĄCZNIE przy pozytywnym dopasowaniu mobile.
function defaultViewMode(): DetectionViewMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'cards';
  }
  return window.matchMedia('(min-width: 640px)').matches ? 'cards' : 'list';
}

function readStoredViewMode(): DetectionViewMode {
  if (typeof window === 'undefined') return 'cards';
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (isViewMode(stored)) return stored; // walidacja: śmieciowa wartość → default
  } catch {
    // localStorage niedostępny (tryb prywatny / wyłączony) — fallback do default
  }
  return defaultViewMode();
}

export function useDetectionViewMode(): [DetectionViewMode, (m: DetectionViewMode) => void] {
  // Start od 'cards' (hydration-safe); preferencję czytamy po mount, gdy window istnieje.
  const [mode, setModeState] = useState<DetectionViewMode>('cards');

  useEffect(() => {
    setModeState(readStoredViewMode());
  }, []);

  const setMode = (m: DetectionViewMode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, m);
    } catch {
      // zapis niemożliwy — preferencja zostaje tylko w pamięci sesji
    }
  };

  return [mode, setMode];
}

export function ViewModeSwitcher({
  mode,
  onChange,
}: {
  mode: DetectionViewMode;
  onChange: (m: DetectionViewMode) => void;
}) {
  return (
    <div
      data-testid="view-mode-switcher"
      role="group"
      aria-label="Tryb prezentacji listy"
      className="mb-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5"
    >
      {VIEW_MODES.map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            data-testid={`view-mode-${m}`}
            aria-pressed={active}
            onClick={() => onChange(m)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {VIEW_MODE_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Główny komponent
// ---------------------------------------------------------------------------

export default function DetectionReview({ photoId }: { photoId: string }) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoDTO | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionWithCandidatesDTO[]>([]);
  const [visionRun, setVisionRun] = useState<VisionRunMeta | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [viewMode, setViewMode] = useDetectionViewMode();
  const [focusedDetectionId, setFocusedDetectionId] = useState<string | null>(null);
  const [confirmRerunOpen, setConfirmRerunOpen] = useState(false);
  const [isBboxEditing, setIsBboxEditing] = useState(false);
  const [applyingEdits, setApplyingEdits] = useState(false);

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
        setPhotoUrl(json.data.photo_url ?? null);
        const loadedDetections = json.data.detections ?? [];
        setDetections(loadedDetections);
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

  function handleRefined(next: DetectionWithCandidatesDTO) {
    setDetections((prev) => prev.map((d) => (d.id === next.id ? next : d)));
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

  async function runRerunVision() {
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
      // Auto-match after vision — user expects proposals immediately, not a blank list.
      // Ignore match errors: reload will show detections even if match fails.
      try {
        await fetch(`/api/photos/${photoId}/match`, { method: 'POST' });
      } catch {
        // non-fatal — reload shows detections even if match fails
      }
      window.location.reload();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Błąd sieci.');
    } finally {
      setActionBusy(false);
    }
  }

  function handleRerunVisionClick() {
    setConfirmRerunOpen(true);
  }

  const estimatedCost = visionRun?.cost_usd ?? photo?.vision_cost_usd;
  const estimatedLatencyMs = visionRun?.latency_ms ?? photo?.vision_latency_ms;
  const estimateSource = visionRun?.cost_usd != null || visionRun?.latency_ms != null
    ? 'na bazie ostatniego runu'
    : photo?.vision_cost_usd != null || photo?.vision_latency_ms != null
      ? 'na bazie cache zdjęcia'
      : 'wartość orientacyjna';
  const rerunConfirmMessage = `Uruchomimy nowy vision run. Poprzednie wyniki zostaną w historii. Szacowany koszt: ${formatCostEstimate(estimatedCost)} i czas: ${formatDurationEstimate(estimatedLatencyMs)} (${estimateSource}).`;

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

  async function handleSaveSingleBbox(detectionId: string, bbox: BboxEditSet['updated'][number]['bbox']): Promise<void> {
    const res = await fetch(`/api/detections/${detectionId}/bbox`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox }),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: { message?: string } };
      throw new Error(json.error?.message ?? `Błąd zapisu bbox (${res.status})`);
    }
    setDetections((prev) => prev.map((d) => d.id === detectionId ? { ...d, bbox } : d));
  }

  function handleMarkerContextMenu(detectionId: string) {
    const det = detections.find((d) => d.id === detectionId);
    if (!det) return;
    const prefix = viewMode === 'list' ? 'detection-row' : viewMode === 'tiles' ? 'detection-tile' : 'detection-card';
    document
      .querySelector(`[data-testid="${prefix}-${det.position_index}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function handleCardContextMenu(det: DetectionWithCandidatesDTO) {
    setFocusedDetectionId(det.id);
    document
      .querySelector('[data-testid="photo-overlay"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleApplyEdits(changes: BboxEditSet): Promise<void> {
    setApplyingEdits(true);
    setActionMsg(null);

    const updateResults = await Promise.allSettled(
      changes.updated.map(({ detectionId, bbox }) =>
        fetch(`/api/detections/${detectionId}/bbox`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox }),
        }).then((r) => {
          if (!r.ok) throw new Error(`PATCH ${r.status}`);
          return { detectionId, bbox };
        })
      )
    );

    const removeResults = await Promise.allSettled(
      changes.removed.map(({ detectionId }) =>
        fetch(`/api/detections/${detectionId}/reject`, { method: 'POST' }).then((r) => {
          if (!r.ok) throw new Error(`reject ${r.status}`);
          return detectionId;
        })
      )
    );

    const addResults = await Promise.allSettled(
      changes.added.map(({ bbox }) =>
        fetch(`/api/photos/${photoId}/detections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox }),
        }).then(async (r) => {
          if (!r.ok) throw new Error(`POST ${r.status}`);
          return ((await r.json()) as { data: DetectionWithCandidatesDTO }).data;
        })
      )
    );

    const failCount = [...updateResults, ...removeResults, ...addResults].filter(
      (r) => r.status === 'rejected'
    ).length;
    if (failCount > 0) setActionMsg(`${failCount} operacji nie powiodło się.`);

    setDetections((prev) => {
      let next = [...prev];

      for (const r of updateResults) {
        if (r.status !== 'fulfilled') continue;
        const { detectionId, bbox } = r.value;
        next = next.map((d) => (d.id === detectionId ? { ...d, bbox } : d));
      }

      const removedIds = new Set(
        removeResults.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<string>).value)
      );
      next = next.filter((d) => !removedIds.has(d.id));

      for (const r of addResults) {
        if (r.status === 'fulfilled') next = [...next, r.value];
      }

      return next;
    });

    setApplyingEdits(false);
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
      {/* Zdjęcie z ramkami detekcji — 'Pokaż wszystkie' jest w toolbarze overlay */}
      {detections.length > 0 && (
        <PhotoDetectionOverlay
          photoUrl={photoUrl}
          detections={detections}
          focusedDetectionId={focusedDetectionId}
          onClearFocus={() => setFocusedDetectionId(null)}
          isEditing={isBboxEditing}
          onEditingChange={setIsBboxEditing}
          onApplyEdits={handleApplyEdits}
          onMarkerContextMenu={handleMarkerContextMenu}
          onSaveSingleBbox={handleSaveSingleBbox}
        />
      )}

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
              disabled={actionBusy || isBboxEditing || applyingEdits}
              onClick={handleRerunVisionClick}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {actionBusy ? 'Uruchamiam...' : 'Ponów vision (nowy run)'}
            </button>
            <button
              data-testid="rerun-match-button"
              disabled={actionBusy || isBboxEditing || applyingEdits}
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
            disabled={bulkBusy || isBboxEditing || applyingEdits}
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

      <ViewModeSwitcher mode={viewMode} onChange={setViewMode} />

      {viewMode === 'list' ? (
        <div className="space-y-2">
          {detections.map((det) => (
            <div key={det.id} onContextMenu={(e) => { if (e.ctrlKey) { e.preventDefault(); handleCardContextMenu(det); } }}>
              <DetectionRow
                detection={det}
                onDecided={handleDecided}
                onRefined={handleRefined}
                onSelect={setFocusedDetectionId}
                isSelected={focusedDetectionId === det.id}
                onNavigateToMarker={() => handleCardContextMenu(det)}
              />
            </div>
          ))}
        </div>
      ) : viewMode === 'tiles' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {detections.map((det) => (
            <div key={det.id} onContextMenu={(e) => { if (e.ctrlKey) { e.preventDefault(); handleCardContextMenu(det); } }}>
              <DetectionTile
                detection={det}
                onDecided={handleDecided}
                onRefined={handleRefined}
                onSelect={setFocusedDetectionId}
                isSelected={focusedDetectionId === det.id}
                onNavigateToMarker={() => handleCardContextMenu(det)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {detections.map((det) => (
            <div key={det.id} onContextMenu={(e) => { if (e.ctrlKey) { e.preventDefault(); handleCardContextMenu(det); } }}>
              <DetectionCard
                detection={det}
                onDecided={handleDecided}
                onRefined={handleRefined}
                onSelect={setFocusedDetectionId}
                isSelected={focusedDetectionId === det.id}
                onNavigateToMarker={() => handleCardContextMenu(det)}
              />
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmRerunOpen}
        title="Ponowić vision?"
        message={rerunConfirmMessage}
        confirmLabel="Uruchom nowy run"
        cancelLabel="Anuluj"
        testIdPrefix="rerun-vision-confirm"
        onCancel={() => setConfirmRerunOpen(false)}
        onConfirm={() => {
          setConfirmRerunOpen(false);
          void runRerunVision();
        }}
      />
    </div>
  );
}
