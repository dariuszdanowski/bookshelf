import { useEffect, useRef, useState } from 'react';

import type { BookCandidateDTO } from '../lib/books/schema';
import type { PhotoDTO, DetectionWithCandidatesDTO, BboxEditSet } from '../lib/photos/schema';
import { classifyCropQuality } from '../lib/matching/fallbackPolicy';
import BookModal, { type BookModalBook } from './BookModal';
import ConfirmDialog from './ConfirmDialog';
import CostPanel from './CostPanel';
import HelpTip from './HelpTip';
import PhotoDetectionOverlay from './PhotoDetectionOverlay';
import Skeleton from './Skeleton';
import { ViewModeSwitcher, useViewMode, type ViewMode } from './ViewModeSwitcher';

const MATCH_HIGH = 0.75;
const MATCH_MID = 0.55;

type MatchTier = 'high' | 'mid' | 'low';

function getMatchTier(score: number): MatchTier {
  if (score >= MATCH_HIGH) return 'high';
  if (score >= MATCH_MID) return 'mid';
  return 'low';
}

// ---------------------------------------------------------------------------
// RefineButton — wspólny przycisk „Doprecyzuj odczyt" dla wszystkich trybów
// review. Jeden label (rozróżnialność weak/good po ⚠ prefixie, nie po kolorze
// — M3L4), sygnał weak-crop (⚠ + amber + tooltip) i widoczna informacja o
// koszcie (refine = dodatkowe płatne wywołanie AI). Likwiduje 3 kopie inline.
// ---------------------------------------------------------------------------
function RefineButton({
  bbox,
  busy,
  onClick,
  size = 'md',
}: {
  bbox: DetectionWithCandidatesDTO['bbox'];
  busy: boolean;
  onClick: () => void;
  size?: 'lg' | 'md' | 'sm';
}) {
  const isWeak = classifyCropQuality(bbox) === 'uncertain_localization';
  const sizeCls = size === 'lg' ? 'px-3 py-1.5' : size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1';
  const colorCls = isWeak
    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
    : 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100';
  const label = busy ? 'Doprecyzowuję...' : isWeak ? '⚠ Doprecyzuj odczyt' : 'Doprecyzuj odczyt';
  const title = isWeak
    ? '⚠ Crop o niskiej jakości — wynik może być słaby. Dodatkowa analiza AI (płatne).'
    : 'Doprecyzuj odczyt — dodatkowa analiza AI (płatne)';
  return (
    <span className="inline-flex items-center gap-1">
      <button
        data-testid="refine-button"
        disabled={busy}
        onClick={onClick}
        title={title}
        className={`rounded-md border text-xs font-medium disabled:opacity-50 ${sizeCls} ${colorCls}`}
      >
        {label}
      </button>
      {size === 'lg' ? (
        <span data-testid="refine-cost-hint" className="text-[10px] leading-tight text-gray-400">
          dodatkowa analiza AI — płatne
        </span>
      ) : (
        <span
          data-testid="refine-cost-hint"
          title="dodatkowa analiza AI — płatne"
          aria-label="dodatkowa analiza AI — płatne"
          className="cursor-help text-xs text-gray-400"
        >
          ⓘ
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// WebSearchButton — „Szukaj w sieci": otwiera nową kartę z Google na naszych
// danych (tytuł + autor). Ratunek gdy Google Books/OpenLibrary nie indeksują
// danej edycji (małe polskie wydawnictwa), a zwykła wyszukiwarka ją znajduje.
// Link <a target="_blank">, nie fetch — żadnego kosztu API, user wybiera ręcznie.
// ---------------------------------------------------------------------------
function WebSearchButton({
  title,
  author,
  size = 'md',
}: {
  title: string;
  author: string | null | undefined;
  size?: 'lg' | 'md' | 'sm';
}) {
  const query = [title, author].filter(Boolean).join(' ').trim();
  if (!query) return null;
  const href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  const sizeCls = size === 'lg' ? 'px-3 py-1.5' : size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1';
  return (
    <a
      data-testid="web-search-button"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Wyszukaj „${query}" w Google (nowa karta)`}
      className={`inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-300 dark:hover:bg-sky-900/40 ${sizeCls}`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="8.5" cy="8.5" r="5.5" />
        <line x1="13" y1="13" x2="18" y2="18" />
      </svg>
      Szukaj w sieci
    </a>
  );
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
        className="flex h-20 w-14 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-gray-300"
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

// Mapuje kandydata (propozycję) na wspólny kształt podglądu — ten sam modal
// co dla książek zatwierdzonych (jednolity dostęp przez klik w okładkę).
function candidateToDetail(c: BookCandidateDTO): BookModalBook {
  return {
    title: c.title,
    authors: c.authors,
    coverUrl: c.coverUrl,
    isbn13: c.isbn13,
    isbn10: c.isbn10,
    publisher: c.publisher,
    publishedYear: c.publishedYear,
    source: c.source,
    matchScore: c.matchScore,
  };
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
      if (authors.trim())
        body.authors = authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean);
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
          className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
          className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-700">Wydawnictwo</label>
          <input
            data-testid="correct-publisher"
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
// Formularz wyszukiwania po tytule (rematch)
// ---------------------------------------------------------------------------

type RematchFormProps = {
  initialTitle: string;
  initialAuthor: string;
  initialIsbn: string;
  busy: boolean;
  errorMsg: string | null;
  onSubmit: (
    title: string,
    author: string | null,
    isbn: string | null,
    publisher: string | null,
  ) => void;
  onCancel: () => void;
};

function RematchForm({
  initialTitle,
  initialAuthor,
  initialIsbn,
  busy,
  errorMsg,
  onSubmit,
  onCancel,
}: RematchFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState(initialAuthor);
  const [isbn, setIsbn] = useState(initialIsbn);
  // M22: wydawnictwo z grzbietu (np. logo Naszej Księgarni) zawęża wyniki GB
  const [publisher, setPublisher] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), author.trim() || null, isbn.trim() || null, publisher.trim() || null);
  }

  return (
    <form
      data-testid="rematch-form"
      onSubmit={handleSubmit}
      className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950"
    >
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Tytuł
          <input
            data-testid="rematch-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            required
          />
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Autor (opcjonalnie)
          <input
            data-testid="rematch-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Wydawnictwo (opcjonalnie — gdy widoczne na grzbiecie)
          <input
            data-testid="rematch-publisher"
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            placeholder="np. Nasza Księgarnia"
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          ISBN (opcjonalnie — gdy tytuł nie daje wyników)
          <input
            data-testid="rematch-isbn"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            placeholder="np. 9788308073087"
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </label>
      </div>
      {errorMsg && (
        <p
          data-testid="rematch-error"
          className="text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          {errorMsg}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          data-testid="rematch-submit"
          disabled={busy || !title.trim()}
          className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Szukam...' : 'Szukaj'}
        </button>
        <button
          type="button"
          data-testid="rematch-cancel"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Widok detekcji odrzuconej — wspólny dla 3 trybów (Karty/Lista/Kafelki).
// Świadomie ODRÓŻNIA się od widoku zaakceptowanej (zielony ptaszek): szary,
// przekreślony tytuł, ikona „×", etykieta „Odrzucono" + przycisk „Cofnij".
// Bez tego odrzucenie wyglądało jak akceptacja i było nieodwracalne (dziura UX).
// ---------------------------------------------------------------------------
function RejectedDecidedView({
  title,
  busy,
  onUndo,
  testId,
}: {
  title: string;
  busy: boolean;
  onUndo: () => void;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50"
    >
      <svg
        className="flex-shrink-0 text-gray-400"
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
      <span className="truncate text-sm text-gray-500 line-through dark:text-gray-400">
        {title}
      </span>
      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
        Odrzucono
      </span>
      <button
        data-testid="undo-reject-button"
        disabled={busy}
        onClick={onUndo}
        className="ml-auto rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
      >
        {busy ? 'Cofam...' : 'Cofnij'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Karta detekcji z akcjami
// ---------------------------------------------------------------------------

type DecisionState = 'pending' | 'decided' | 'error';
type DecisionKind = 'confirmed' | 'rejected';

// ---------------------------------------------------------------------------
// Hook decyzji — współdzielona logika akceptacji/odrzucenia/korekty per detekcja.
// Wyekstrahowany z DetectionCard, by 3 tryby prezentacji (Karty/Lista/Kafelki)
// nie duplikowały wywołań API. Render-specific UI (showAlts, showCorrectForm)
// zostaje lokalny w każdym wariancie prezentacji.
// ---------------------------------------------------------------------------

function useDetectionDecision(
  detection: DetectionWithCandidatesDTO,
  onDecided: (detectionId: string, kind: DecisionKind) => void,
  onRefined?: (next: DetectionWithCandidatesDTO) => void,
  onUndecided?: (detectionId: string) => void,
) {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  // M20: detekcja potwierdzona w DB (np. wejście deep-linkiem S-37 do skatalogowanej
  // książki) od razu renderuje widok „dodano do katalogu" — wcześniej udawała pending
  // i dedup meldował absurdalne „Masz już tę książkę w katalogu".
  const initiallyConfirmed = detection.status === 'confirmed';
  const [state, setState] = useState<DecisionState>(initiallyConfirmed ? 'decided' : 'pending');
  const [decidedKind, setDecidedKind] = useState<DecisionKind | null>(
    initiallyConfirmed ? 'confirmed' : null,
  );
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
      setDecidedKind('confirmed');
      setState('decided');
      onDecided(detection.id, 'confirmed');
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
      setDecidedKind('rejected');
      setState('decided');
      onDecided(detection.id, 'rejected');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  // Cofnięcie odrzucenia — przywraca detekcję do edycji (status w DB → matched/pending).
  async function handleUndoReject() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/detections/${detection.id}/unreject`, { method: 'POST' });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        setErrorMsg(json.error?.message ?? `Błąd (${res.status})`);
        return;
      }
      setDecidedKind(null);
      setState('pending');
      onUndecided?.(detection.id);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Błąd sieci.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRematch(
    title: string,
    author: string | null,
    isbn: string | null,
    publisher: string | null = null, // M22
  ): Promise<boolean> {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/detections/${detection.id}/rematch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, author, isbn, publisher }),
      });
      const json = (await res.json()) as {
        data?: {
          applied?: boolean;
          detection?: Partial<DetectionWithCandidatesDTO>;
          candidates?: BookCandidateDTO[];
          duplicate?: DetectionWithCandidatesDTO['duplicate'];
        };
        error?: { message?: string };
      };
      if (res.status === 429) {
        setErrorMsg('Rate limit, spróbuj za chwilę.');
        return false;
      }
      if (!res.ok) {
        setErrorMsg(json.error?.message ?? `Błąd wyszukiwania (${res.status})`);
        return false;
      }
      const nextDetection = json.data?.detection;
      const candidates = json.data?.candidates ?? [];
      if (nextDetection) {
        onRefined?.({
          ...detection,
          ...nextDetection,
          candidates,
          duplicate: json.data?.duplicate ?? null,
        });
      }
      return candidates.length > 0;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Błąd sieci.');
      return false;
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
        error?: { code?: string; message?: string };
      };

      if (res.status === 429) {
        setErrorMsg('Rate limit, spróbuj za chwilę.');
        return;
      }

      if (res.status === 403 && json.error?.code === 'NO_API_KEY') {
        setErrorMsg('Brak klucza API. Dodaj klucz w ustawieniach konta.');
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
    setDecidedKind('confirmed');
    setState('decided');
    onDecided(detection.id, 'confirmed');
  }

  return {
    selectedCandidateId,
    setSelectedCandidateId,
    state,
    decidedKind,
    busy,
    errorMsg,
    top,
    alts,
    activeCandidateId,
    activeCandidate,
    handleConfirm,
    handleReject,
    handleUndoReject,
    handleRefine,
    handleRematch,
    handleCorrectSuccess,
  };
}

type DetectionCardProps = {
  detection: DetectionWithCandidatesDTO;
  onDecided: (detectionId: string, kind: DecisionKind) => void;
  onRefined?: (next: DetectionWithCandidatesDTO) => void;
  onUndecided?: (detectionId: string) => void;
  onSelect?: (detectionId: string) => void;
  isSelected?: boolean;
  onNavigateToMarker?: () => void;
  photoId?: string;
};

function DetectionCard({
  detection,
  onDecided,
  onRefined,
  onUndecided,
  onSelect,
  isSelected = false,
  onNavigateToMarker,
  photoId,
}: DetectionCardProps) {
  const [showAlts, setShowAlts] = useState(false);
  const [showCorrectForm, setShowCorrectForm] = useState(false);
  const [showRematchForm, setShowRematchForm] = useState(false);
  const [rematchNoResults, setRematchNoResults] = useState(false);
  const [showCandidateDetail, setShowCandidateDetail] = useState(false);
  const {
    setSelectedCandidateId,
    state,
    decidedKind,
    busy,
    errorMsg,
    top,
    alts,
    activeCandidateId,
    activeCandidate,
    handleConfirm,
    handleReject,
    handleUndoReject,
    handleRefine,
    handleRematch,
    handleCorrectSuccess,
  } = useDetectionDecision(detection, onDecided, onRefined, onUndecided);

  if (state === 'decided') {
    if (decidedKind === 'rejected') {
      return (
        <RejectedDecidedView
          testId={`detection-card-${detection.position_index}`}
          title={detection.raw_title}
          busy={busy}
          onUndo={() => void handleUndoReject()}
        />
      );
    }
    return (
      <div
        data-testid={`detection-card-${detection.position_index}`}
        className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3"
      >
        <svg
          className="flex-shrink-0 text-green-600"
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        <div className="min-w-0 flex-1">
          {/* Pokazujemy KSIĄŻKĘ z katalogu (zaakceptowany kandydat), nie surowy wpis
              detekcji — inaczej user nie wie co zatwierdził (S-43 UX). */}
          <span
            data-testid="confirmed-title"
            className="block truncate text-sm font-medium text-green-700"
          >
            {activeCandidate?.title ?? detection.raw_title}
          </span>
          {activeCandidate?.authors.length ? (
            <span className="block truncate text-xs text-green-600">
              {activeCandidate.authors.join(', ')}
            </span>
          ) : null}
        </div>
        <span className="flex-shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
          Dodano do katalogu
        </span>
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
        <span className="truncate text-sm font-medium text-gray-700">{detection.raw_title}</span>
        {detection.raw_author && (
          <span className="truncate text-xs text-gray-500">&mdash; {detection.raw_author}</span>
        )}
        {onNavigateToMarker && (
          <button
            type="button"
            title="Przejdź do ramki na zdjęciu"
            className="ml-auto flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-blue-50 hover:text-blue-500"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToMarker();
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="7" cy="7" r="3" />
              <line x1="7" y1="1" x2="7" y2="4" />
              <line x1="7" y1="10" x2="7" y2="13" />
              <line x1="1" y1="7" x2="4" y2="7" />
              <line x1="10" y1="7" x2="13" y2="7" />
            </svg>
          </button>
        )}
        {photoId && (
          <span onClick={(e) => e.stopPropagation()}>
            {/* M26: wartość kosztu OCR jako etykieta (gdy >0; bez OCR — sama ikona) */}
            <CostPanel
              photoId={photoId}
              detectionId={detection.id}
              align="left"
              label={
                detection.refine_cost_usd != null && detection.refine_cost_usd > 0
                  ? `$${detection.refine_cost_usd.toFixed(4)}`
                  : undefined
              }
              hint="Koszt doczytywania OCR tej ramki. Kliknij, by zobaczyć wywołania z cenami."
            />
          </span>
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

      {/* No match → rematch + manual entry */}
      {!top && !showCorrectForm && !showRematchForm && (
        <div>
          <p
            data-testid="no-match-placeholder"
            className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500"
          >
            Brak pewnego matchu
          </p>
          {rematchNoResults && (
            <p className="mt-1 text-center text-xs text-amber-600" data-testid="rematch-no-results">
              Nie znaleziono wyników dla podanego tytułu
            </p>
          )}
          <button
            data-testid="rematch-button"
            onClick={() => {
              setShowRematchForm(true);
              setRematchNoResults(false);
            }}
            className="mt-2 w-full rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
          >
            Szukaj po tytule
          </button>
          <button
            data-testid="manual-entry-button"
            onClick={() => setShowCorrectForm(true)}
            className="mt-2 w-full rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            Wpisz ręcznie
          </button>
        </div>
      )}

      {/* Rematch form */}
      {!top && showRematchForm && (
        <RematchForm
          initialTitle={detection.raw_title ?? ''}
          initialAuthor={detection.raw_author ?? ''}
          initialIsbn={''}
          busy={busy}
          errorMsg={errorMsg}
          onSubmit={async (title, author, isbn, publisher) => {
            const found = await handleRematch(title, author, isbn, publisher);
            // M12: zamykaj ZAWSZE — po sukcesie pojawia się kandydat (top) i stan
            // showRematchForm=true przejmowała gałąź „z kandydatem", renderując
            // formularz ponownie pod zaktualizowaną propozycją.
            setShowRematchForm(false);
            if (!found) setRematchNoResults(true);
          }}
          onCancel={() => setShowRematchForm(false)}
        />
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
              <label className="mb-1 block text-xs text-gray-500">Aktywna propozycja:</label>
              <div className="flex flex-wrap gap-1">
                <button
                  key={top.id}
                  onClick={() => setSelectedCandidateId(top.id)}
                  className={`rounded border px-2 py-0.5 text-xs ${activeCandidateId === top.id ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 bg-white text-gray-600'}`}
                >
                  {top.title.slice(0, 30)} ({Math.round(top.matchScore * 100)}%)
                </button>
                {alts.map((alt) => (
                  <button
                    key={alt.id}
                    onClick={() => setSelectedCandidateId(alt.id)}
                    className={`rounded border px-2 py-0.5 text-xs ${activeCandidateId === alt.id ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 bg-white text-gray-600'}`}
                  >
                    {alt.title.slice(0, 30)} ({Math.round(alt.matchScore * 100)}%)
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active candidate card */}
          {activeCandidate && (
            <div
              className={`flex gap-3 rounded-lg border-2 p-3 ${TIER_STYLES[getMatchTier(activeCandidate.matchScore)].border}`}
            >
              <button
                type="button"
                data-testid="candidate-cover-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCandidateDetail(true);
                }}
                title="Pokaż szczegóły książki"
                className="cursor-zoom-in rounded focus:ring-2 focus:ring-blue-400 focus:outline-none"
              >
                <CoverImage url={activeCandidate.coverUrl} title={activeCandidate.title} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start gap-2">
                  <p
                    data-testid="candidate-title"
                    className="leading-tight font-semibold text-gray-900"
                  >
                    {activeCandidate.title}
                  </p>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${TIER_STYLES[getMatchTier(activeCandidate.matchScore)].badge}`}
                  >
                    {TIER_STYLES[getMatchTier(activeCandidate.matchScore)].label}
                  </span>
                  {isHigh && <span className="text-xs text-green-600">✓ Pre-zaznaczone</span>}
                </div>
                {activeCandidate.authors.length > 0 && (
                  <p className="mt-0.5 text-sm text-gray-600">
                    {activeCandidate.authors.join(', ')}
                  </p>
                )}
                {activeCandidate.publisher && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {activeCandidate.publisher}
                    {activeCandidate.publishedYear ? `, ${activeCandidate.publishedYear}` : ''}
                  </p>
                )}
                {activeCandidate.isbn13 && (
                  <p className="mt-0.5 text-xs text-gray-400">ISBN {activeCandidate.isbn13}</p>
                )}
                <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                  Pewność: {Math.round(activeCandidate.matchScore * 100)}%
                  <HelpTip label="match-score">
                    Wynik dopasowania tytułu do bazy Google Books / OpenLibrary. ≥75% (zielony) =
                    wysoka pewność, pre-zaznaczone. 55–74% (żółty) = sprawdź ręcznie. &lt;55% =
                    niska pewność, rozważ korektę lub wyszukanie ręczne.
                  </HelpTip>
                </p>
              </div>
            </div>
          )}

          {/* Alternatives toggle */}
          {alts.length > 0 && (
            <button
              onClick={() => setShowAlts((v) => !v)}
              className="mt-2 text-xs text-blue-600 underline hover:text-blue-800"
              data-testid="toggle-alts"
            >
              {showAlts
                ? 'Ukryj alternatywy'
                : `${alts.length} alternatyw${alts.length === 1 ? 'a' : 'y'}`}
            </button>
          )}
          {showAlts && (
            <div className="mt-2 space-y-1">
              {alts.map((alt) => (
                <div
                  key={alt.id}
                  className="flex gap-2 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600"
                >
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
          {top && (
            <button
              data-testid="rematch-button"
              disabled={busy}
              onClick={() => {
                setShowRematchForm(true);
                setRematchNoResults(false);
              }}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              Szukaj po tytule
            </button>
          )}
          <WebSearchButton title={detection.raw_title} author={detection.raw_author} size="lg" />
          <RefineButton
            bbox={detection.bbox}
            busy={busy}
            onClick={() => void handleRefine()}
            size="lg"
          />
        </div>
      )}

      {/* Rematch form when candidates already exist */}
      {top && showRematchForm && (
        <RematchForm
          initialTitle={detection.raw_title ?? ''}
          initialAuthor={detection.raw_author ?? ''}
          initialIsbn={top.isbn13 ?? top.isbn10 ?? ''}
          busy={busy}
          errorMsg={errorMsg}
          onSubmit={async (title, author, isbn, publisher) => {
            const found = await handleRematch(title, author, isbn, publisher);
            setShowRematchForm(false);
            if (!found) setRematchNoResults(true);
          }}
          onCancel={() => setShowRematchForm(false)}
        />
      )}
      {top && rematchNoResults && !showRematchForm && (
        <p className="mt-1 text-center text-xs text-amber-600" data-testid="rematch-no-results">
          Nie znaleziono wyników dla podanego tytułu
        </p>
      )}

      {showCandidateDetail && activeCandidate && (
        <BookModal
          mode="propose"
          book={candidateToDetail(activeCandidate)}
          onClose={() => setShowCandidateDetail(false)}
        />
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
  onDecided: (detectionId: string, kind: DecisionKind) => void;
  onRefined?: (next: DetectionWithCandidatesDTO) => void;
  onUndecided?: (detectionId: string) => void;
  onSelect?: (detectionId: string) => void;
  isSelected?: boolean;
  onNavigateToMarker?: () => void;
};

export function DetectionRow({
  detection,
  onDecided,
  onRefined,
  onUndecided,
  onSelect,
  isSelected = false,
  onNavigateToMarker,
}: DetectionRowProps) {
  const [showModal, setShowModal] = useState(false);
  const [showRematchForm, setShowRematchForm] = useState(false);
  const {
    state,
    decidedKind,
    busy,
    errorMsg,
    top,
    activeCandidateId,
    activeCandidate,
    handleConfirm,
    handleReject,
    handleUndoReject,
    handleRefine,
    handleRematch,
    handleCorrectSuccess,
  } = useDetectionDecision(detection, onDecided, onRefined, onUndecided);

  if (state === 'decided') {
    if (decidedKind === 'rejected') {
      return (
        <RejectedDecidedView
          testId={`detection-row-${detection.position_index}`}
          title={detection.raw_title}
          busy={busy}
          onUndo={() => void handleUndoReject()}
        />
      );
    }
    return (
      <div
        data-testid={`detection-row-${detection.position_index}`}
        className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2"
      >
        <svg
          className="flex-shrink-0 text-green-600"
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        <span data-testid="confirmed-title" className="truncate text-sm font-medium text-green-700">
          {activeCandidate?.title ?? detection.raw_title}
        </span>
        {activeCandidate?.authors.length ? (
          <span className="truncate text-xs text-green-600">
            &mdash; {activeCandidate.authors.join(', ')}
          </span>
        ) : null}
        <span className="ml-auto flex-shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
          Dodano
        </span>
      </div>
    );
  }

  const displayTitle = activeCandidate?.title ?? detection.raw_title;
  const displayAuthor =
    (activeCandidate?.authors.length ? activeCandidate.authors.join(', ') : detection.raw_author) ??
    '';

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
          onClick={(e) => {
            e.stopPropagation();
            onNavigateToMarker();
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
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

      {/* S-28: wrap na wąskim ekranie — flex-shrink-0 bez wrap dawał 479 px min-content i poziomy scroll na 375 px */}
      <div className="flex flex-wrap gap-1 sm:flex-shrink-0">
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
          // M19: parytet z Kartami — „Szukaj" także przy istniejącym kandydacie
          <>
            <button
              data-testid="correct-button"
              disabled={busy}
              onClick={() => setShowModal(true)}
              className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Popraw
            </button>
            <button
              data-testid="rematch-button"
              disabled={busy}
              onClick={() => setShowRematchForm(true)}
              className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              Szukaj
            </button>
          </>
        ) : (
          <>
            <button
              data-testid="rematch-button"
              disabled={busy}
              onClick={() => setShowRematchForm(true)}
              className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              Szukaj
            </button>
            <button
              data-testid="manual-entry-button"
              onClick={() => setShowModal(true)}
              className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              Wpisz ręcznie
            </button>
          </>
        )}
        <WebSearchButton title={detection.raw_title} author={detection.raw_author} size="md" />
        <RefineButton
          bbox={detection.bbox}
          busy={busy}
          onClick={() => void handleRefine()}
          size="md"
        />
      </div>

      {showRematchForm && (
        <RematchForm
          initialTitle={detection.raw_title ?? ''}
          initialAuthor={detection.raw_author ?? ''}
          initialIsbn={detection.candidates?.[0]?.isbn13 ?? detection.candidates?.[0]?.isbn10 ?? ''}
          busy={busy}
          errorMsg={errorMsg}
          onSubmit={async (title, author, isbn, publisher) => {
            const found = await handleRematch(title, author, isbn, publisher);
            if (found) setShowRematchForm(false);
          }}
          onCancel={() => setShowRematchForm(false)}
        />
      )}

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
  onDecided: (detectionId: string, kind: DecisionKind) => void;
  onRefined?: (next: DetectionWithCandidatesDTO) => void;
  onUndecided?: (detectionId: string) => void;
  onSelect?: (detectionId: string) => void;
  isSelected?: boolean;
  onNavigateToMarker?: () => void;
};

export function DetectionTile({
  detection,
  onDecided,
  onRefined,
  onUndecided,
  onSelect,
  isSelected = false,
  onNavigateToMarker,
}: DetectionTileProps) {
  const [showModal, setShowModal] = useState(false);
  const [showRematchForm, setShowRematchForm] = useState(false);
  const [showCandidateDetail, setShowCandidateDetail] = useState(false);
  const {
    state,
    decidedKind,
    busy,
    errorMsg,
    top,
    activeCandidateId,
    activeCandidate,
    handleConfirm,
    handleReject,
    handleUndoReject,
    handleRefine,
    handleRematch,
    handleCorrectSuccess,
  } = useDetectionDecision(detection, onDecided, onRefined, onUndecided);

  if (state === 'decided') {
    if (decidedKind === 'rejected') {
      return (
        <RejectedDecidedView
          testId={`detection-tile-${detection.position_index}`}
          title={detection.raw_title}
          busy={busy}
          onUndo={() => void handleUndoReject()}
        />
      );
    }
    return (
      <div
        data-testid={`detection-tile-${detection.position_index}`}
        className="flex flex-col items-center justify-center rounded-xl border border-green-200 bg-green-50 p-3 text-center"
      >
        <svg
          className="text-green-600"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        <span
          data-testid="confirmed-title"
          className="mt-1 w-full truncate text-xs font-medium text-green-700"
        >
          {activeCandidate?.title ?? detection.raw_title}
        </span>
        {activeCandidate?.authors.length ? (
          <span className="w-full truncate text-[10px] text-green-600">
            {activeCandidate.authors.join(', ')}
          </span>
        ) : null}
        <span className="mt-1 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
          Dodano
        </span>
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
        {activeCandidate ? (
          <button
            type="button"
            data-testid="candidate-cover-button"
            onClick={(e) => {
              e.stopPropagation();
              setShowCandidateDetail(true);
            }}
            title="Pokaż szczegóły książki"
            className="cursor-zoom-in rounded focus:ring-2 focus:ring-blue-400 focus:outline-none"
          >
            <CoverImage url={activeCandidate.coverUrl} title={displayTitle} />
          </button>
        ) : (
          <CoverImage url={null} title={displayTitle} />
        )}
      </div>

      {showCandidateDetail && activeCandidate && (
        <BookModal
          mode="propose"
          book={candidateToDetail(activeCandidate)}
          onClose={() => setShowCandidateDetail(false)}
        />
      )}

      <div className="mt-2 flex items-center gap-1">
        <span className="text-xs font-medium text-gray-400">#{detection.position_index}</span>
        {onNavigateToMarker && (
          <button
            type="button"
            title="Przejdź do ramki na zdjęciu"
            className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-blue-50 hover:text-blue-500"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToMarker();
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="7" cy="7" r="3" />
              <line x1="7" y1="1" x2="7" y2="4" />
              <line x1="7" y1="10" x2="7" y2="13" />
              <line x1="1" y1="7" x2="4" y2="7" />
              <line x1="10" y1="7" x2="13" y2="7" />
            </svg>
          </button>
        )}
        {activeCandidate ? (
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${TIER_STYLES[getMatchTier(activeCandidate.matchScore)].badge}`}
          >
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
          // M19: parytet z Kartami — „Szukaj" także przy istniejącym kandydacie
          <>
            <button
              data-testid="correct-button"
              disabled={busy}
              onClick={() => setShowModal(true)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Popraw
            </button>
            <button
              data-testid="rematch-button"
              disabled={busy}
              onClick={() => setShowRematchForm(true)}
              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              Szukaj
            </button>
          </>
        ) : (
          <>
            <button
              data-testid="rematch-button"
              disabled={busy}
              onClick={() => setShowRematchForm(true)}
              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              Szukaj
            </button>
            <button
              data-testid="manual-entry-button"
              onClick={() => setShowModal(true)}
              className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              Wpisz ręcznie
            </button>
          </>
        )}
        <WebSearchButton title={detection.raw_title} author={detection.raw_author} size="sm" />
        <RefineButton
          bbox={detection.bbox}
          busy={busy}
          onClick={() => void handleRefine()}
          size="sm"
        />
      </div>

      {showRematchForm && (
        <RematchForm
          initialTitle={detection.raw_title ?? ''}
          initialAuthor={detection.raw_author ?? ''}
          initialIsbn={detection.candidates?.[0]?.isbn13 ?? detection.candidates?.[0]?.isbn10 ?? ''}
          busy={busy}
          errorMsg={errorMsg}
          onSubmit={async (title, author, isbn, publisher) => {
            const found = await handleRematch(title, author, isbn, publisher);
            if (found) setShowRematchForm(false);
          }}
          onCancel={() => setShowRematchForm(false)}
        />
      )}

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
// AddMissedBookForm — lekki formularz tytułu do ścieżki identity-first
// (brak rysowania bbox — user wpisuje tytuł → POST /detections → rematch)
// ---------------------------------------------------------------------------

type AddMissedBookFormProps = {
  busy: boolean;
  errorMsg: string | null;
  onSubmit: (
    title: string,
    author: string | null,
    isbn: string | null,
    publisher: string | null,
  ) => void;
  onCancel: () => void;
};

function AddMissedBookForm({ busy, errorMsg, onSubmit, onCancel }: AddMissedBookFormProps) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [publisher, setPublisher] = useState('');
  const [isbn, setIsbn] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), author.trim() || null, isbn.trim() || null, publisher.trim() || null);
  }

  return (
    <form
      data-testid="add-missed-book-form"
      onSubmit={handleSubmit}
      className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950"
    >
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Tytuł
          <input
            data-testid="add-missed-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            required
          />
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Autor (opcjonalnie)
          <input
            data-testid="add-missed-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Wydawnictwo (opcjonalnie — gdy widoczne na grzbiecie)
          <input
            data-testid="add-missed-publisher"
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            placeholder="np. Nasza Księgarnia"
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          ISBN (opcjonalnie — gdy tytuł nie daje wyników)
          <input
            data-testid="add-missed-isbn"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            placeholder="np. 9788308073087"
            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </label>
      </div>
      {errorMsg && (
        <p
          data-testid="add-missed-error"
          className="text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          {errorMsg}
        </p>
      )}
      <div className="flex gap-2">
        <button
          data-testid="add-missed-submit"
          type="submit"
          disabled={busy || !title.trim()}
          className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Szukam...' : 'Szukaj'}
        </button>
        <button
          data-testid="add-missed-cancel"
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          Anuluj
        </button>
      </div>
    </form>
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
    /** M26: pełny koszt zdjęcia (vision + OCR) — etykieta przycisku kosztów */
    costs_total_usd?: number | null;
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

// Tryby widoku wyniesione do wspólnego ./ViewModeSwitcher (S-34). Poniżej back-compat
// shimy: zachowują publiczne API importowane przez istniejące testy (useDetectionViewMode,
// VIEW_MODE_STORAGE_KEY, ViewModeSwitcher, DetectionViewMode).
export type DetectionViewMode = ViewMode;

export const VIEW_MODE_STORAGE_KEY = 'bookshelf:detection-view-mode';

export { ViewModeSwitcher };

export function useDetectionViewMode(): [DetectionViewMode, (m: DetectionViewMode) => void] {
  return useViewMode(VIEW_MODE_STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Główny komponent
// ---------------------------------------------------------------------------

export default function DetectionReview({
  photoId,
  initialFocusedDetectionId = null,
}: {
  photoId: string;
  // S-37: deep-link z karty książki (?detection=) — fokus ramki + scroll listy po załadowaniu.
  initialFocusedDetectionId?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoDTO | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionWithCandidatesDTO[]>([]);
  const [visionRun, setVisionRun] = useState<VisionRunMeta | null>(null);
  // M26: pełny koszt zdjęcia (vision + OCR) z API — etykieta przycisku kosztów
  const [costsTotalUsd, setCostsTotalUsd] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set());
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [viewMode, setViewMode] = useDetectionViewMode();
  const [focusedDetectionId, setFocusedDetectionId] = useState<string | null>(null);
  const [confirmRerunOpen, setConfirmRerunOpen] = useState(false);
  const [isBboxEditing, setIsBboxEditing] = useState(false);
  const [applyingEdits, setApplyingEdits] = useState(false);
  const [showAddMissedForm, setShowAddMissedForm] = useState(false);
  const [addMissedBusy, setAddMissedBusy] = useState(false);
  const [addMissedErrorMsg, setAddMissedErrorMsg] = useState<string | null>(null);
  // S-43: detekcja utworzona z „Dodaj pominiętą książkę" po wyszukaniu — modal
  // zostaje otwarty na etapie potwierdzania (karta z kandydatami). null = etap formularza.
  const [addMissedDetection, setAddMissedDetection] = useState<DetectionWithCandidatesDTO | null>(
    null,
  );
  // M20: id potwierdzonych już w DB przy wejściu — odróżnia decyzje sesyjne od historycznych
  const initialDecidedRef = useRef<Set<string>>(new Set());

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
        setCostsTotalUsd(json.data.costs_total_usd ?? null);
        // M20: potwierdzone w DB liczą się jako zdecydowane (liczniki, bulk),
        // ale NIE jako akcja sesyjna — auto-redirect ich nie uwzględnia.
        const confirmedFromDb = new Set(
          loadedDetections.filter((d) => d.status === 'confirmed').map((d) => d.id),
        );
        initialDecidedRef.current = confirmedFromDb;
        if (confirmedFromDb.size > 0) {
          setDecidedIds(new Set(confirmedFromDb));
          setConfirmedIds(new Set(confirmedFromDb));
        }
      } catch (err) {
        if (!cancelled)
          setErrorMsg(err instanceof Error ? err.message : 'Nie udało się załadować propozycji.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  // S-37: initial focus z deep-linku — jednorazowo po załadowaniu detekcji.
  // Nieznane id (detekcja skasowana przy re-process) → cichy no-op, pełny widok.
  const initialFocusApplied = useRef(false);
  useEffect(() => {
    if (loading || initialFocusApplied.current || !initialFocusedDetectionId) return;
    initialFocusApplied.current = true;
    const det = detections.find((d) => d.id === initialFocusedDetectionId);
    if (!det) return;
    setFocusedDetectionId(det.id);
    const prefix =
      viewMode === 'list'
        ? 'detection-row'
        : viewMode === 'tiles'
          ? 'detection-tile'
          : 'detection-card';
    // rAF: scroll po wyrenderowaniu listy w bieżącym commicie renderu
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-testid="${prefix}-${det.position_index}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [loading, detections, initialFocusedDetectionId, viewMode]);

  function handleDecided(detectionId: string, kind: DecisionKind = 'confirmed') {
    setDecidedIds((prev) => new Set([...prev, detectionId]));
    if (kind === 'confirmed') {
      setConfirmedIds((prev) => new Set([...prev, detectionId]));
    }
  }

  // Cofnięcie odrzucenia — detekcja wraca do nierozstrzygniętych, blokuje też
  // ewentualny auto-redirect (poniżej), bo „pozostało" znów > 0.
  function handleUndecided(detectionId: string) {
    setDecidedIds((prev) => {
      const next = new Set(prev);
      next.delete(detectionId);
      return next;
    });
    setConfirmedIds((prev) => {
      const next = new Set(prev);
      next.delete(detectionId);
      return next;
    });
  }

  function handleRefined(next: DetectionWithCandidatesDTO) {
    setDetections((prev) => prev.map((d) => (d.id === next.id ? next : d)));
  }

  // Redirect gdy wszystkie zdecydowane ORAZ co najmniej jedna zaakceptowana.
  // Bez warunku confirmedIds.size > 0 odrzucenie ostatniej detekcji wyrzucało
  // usera na półkę, zanim zdążył kliknąć „Cofnij" (dziura UX).
  useEffect(() => {
    // M20: redirect wymaga AKCJI w tej sesji — wejście deep-linkiem na zdjęcie,
    // gdzie wszystko było już potwierdzone, NIE może wyrzucać usera na półkę.
    const sessionActed = [...decidedIds].some((id) => !initialDecidedRef.current.has(id));
    if (
      detections.length > 0 &&
      detections.every((d) => decidedIds.has(d.id)) &&
      confirmedIds.size > 0 &&
      sessionActed &&
      photo?.shelf_id
    ) {
      window.location.href = `/shelves/${photo.shelf_id}`;
    }
  }, [decidedIds, confirmedIds, detections, photo]);

  // Pre-zaznaczone = detekcje z top kandydatem ≥ 0.75, jeszcze nie zdecydowane
  const preSelected = detections.filter(
    (d) => !decidedIds.has(d.id) && d.candidates[0] && d.candidates[0].matchScore >= MATCH_HIGH,
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
        data?: {
          confirmed: { detection_id: string }[];
          skipped: { detection_id: string; reason: string }[];
        };
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
        setConfirmedIds((prev) => new Set([...prev, c.detection_id]));
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
      const json = (await res.json()) as {
        data?: unknown;
        error?: { code?: string; message?: string };
      };
      if (res.status === 409) {
        setActionMsg('Vision run w toku, poczekaj 1 minutę.');
        return;
      }
      if (res.status === 429) {
        setActionMsg('Rate limit, spróbuj za chwilę.');
        return;
      }
      if (res.status === 403 && json.error?.code === 'NO_API_KEY') {
        setActionMsg('Brak klucza API. Dodaj klucz w ustawieniach konta.');
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
  const estimateSource =
    visionRun?.cost_usd != null || visionRun?.latency_ms != null
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

  async function handleSaveSingleBbox(
    detectionId: string,
    bbox: BboxEditSet['updated'][number]['bbox'],
    quad?: BboxEditSet['updated'][number]['quad'],
  ): Promise<void> {
    const res = await fetch(`/api/detections/${detectionId}/bbox`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox, quad: quad ?? null }),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: { message?: string } };
      throw new Error(json.error?.message ?? `Błąd zapisu bbox (${res.status})`);
    }
    setDetections((prev) =>
      prev.map((d) => (d.id === detectionId ? { ...d, bbox, quad: quad ?? null } : d)),
    );
  }

  async function handleAddMissedBook(
    title: string,
    author: string | null,
    isbn: string | null,
    publisher: string | null,
  ) {
    setAddMissedBusy(true);
    setAddMissedErrorMsg(null);
    try {
      const createRes = await fetch(`/api/photos/${photoId}/detections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, ...(author ? { author } : {}) }),
      });
      const createJson = (await createRes.json()) as {
        data?: DetectionWithCandidatesDTO;
        error?: { message?: string };
      };
      if (!createRes.ok) {
        setAddMissedErrorMsg(createJson.error?.message ?? `Błąd (${createRes.status})`);
        return;
      }
      const newDet = createJson.data!;

      // Rematch to populate candidates immediately
      const rematchRes = await fetch(`/api/detections/${newDet.id}/rematch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, author, isbn, publisher }),
      });
      const rematchJson = (await rematchRes.json()) as {
        data?: {
          detection?: Partial<DetectionWithCandidatesDTO>;
          candidates?: BookCandidateDTO[];
          duplicate?: DetectionWithCandidatesDTO['duplicate'];
        };
        error?: { message?: string };
      };

      const finalDet: DetectionWithCandidatesDTO =
        rematchRes.ok && rematchJson.data
          ? {
              ...newDet,
              ...(rematchJson.data.detection ?? {}),
              candidates: rematchJson.data.candidates ?? [],
              duplicate: rematchJson.data.duplicate ?? null,
            }
          : newDet;

      // S-43: NIE zamykaj modala — przejdź do etapu potwierdzania (karta z kandydatami).
      // Książka trafia do katalogu dopiero po „Akceptuj"/„Wpisz ręcznie"; przy braku
      // wyników karta zostaje na ekranie z opcją „Wpisz ręcznie" (dodaj mimo to) lub „Zamknij".
      setAddMissedDetection(finalDet);
    } catch (e) {
      setAddMissedErrorMsg(e instanceof Error ? e.message : 'Błąd sieci.');
    } finally {
      setAddMissedBusy(false);
    }
  }

  // S-43: zamknięcie modala „Dodaj pominiętą książkę" — reset obu etapów.
  function closeAddMissed() {
    setShowAddMissedForm(false);
    setAddMissedDetection(null);
    setAddMissedErrorMsg(null);
  }

  // S-43: decyzja podjęta na karcie wewnątrz modala. Po potwierdzeniu książka jest
  // już w katalogu (POST /confirm lub /correct wykonany przez kartę) — dorzucamy
  // detekcję do listy jako zdecydowaną i zamykamy modal. Odrzucenie tylko zamyka.
  function finishAddMissed(detectionId: string, kind: DecisionKind) {
    if (kind === 'confirmed' && addMissedDetection) {
      const confirmedDet: DetectionWithCandidatesDTO = {
        ...addMissedDetection,
        status: 'confirmed',
      };
      setDetections((prev) =>
        prev.some((d) => d.id === confirmedDet.id)
          ? prev.map((d) => (d.id === confirmedDet.id ? confirmedDet : d))
          : [...prev, confirmedDet],
      );
      handleDecided(detectionId, 'confirmed');
    }
    closeAddMissed();
  }

  function handleMarkerContextMenu(detectionId: string) {
    const det = detections.find((d) => d.id === detectionId);
    if (!det) return;
    const prefix =
      viewMode === 'list'
        ? 'detection-row'
        : viewMode === 'tiles'
          ? 'detection-tile'
          : 'detection-card';
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
      changes.updated.map(({ detectionId, bbox, quad }) =>
        fetch(`/api/detections/${detectionId}/bbox`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox, quad: quad ?? null }),
        }).then((r) => {
          if (!r.ok) throw new Error(`PATCH ${r.status}`);
          return { detectionId, bbox, quad: quad ?? null };
        }),
      ),
    );

    const removeResults = await Promise.allSettled(
      changes.removed.map(({ detectionId }) =>
        fetch(`/api/detections/${detectionId}/reject`, { method: 'POST' }).then((r) => {
          if (!r.ok) throw new Error(`reject ${r.status}`);
          return detectionId;
        }),
      ),
    );

    // Sequential (not parallel) — each POST reads MAX(position_index) from DB,
    // concurrent requests would all read the same max and produce duplicate indices.
    const addResults: PromiseSettledResult<DetectionWithCandidatesDTO>[] = [];
    for (const { bbox } of changes.added) {
      const result = await fetch(`/api/photos/${photoId}/detections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`POST ${r.status}`);
          return ((await r.json()) as { data: DetectionWithCandidatesDTO }).data;
        })
        .then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason) => ({ status: 'rejected' as const, reason }),
        );
      addResults.push(result);
    }

    const failCount = [...updateResults, ...removeResults, ...addResults].filter(
      (r) => r.status === 'rejected',
    ).length;
    if (failCount > 0) setActionMsg(`${failCount} operacji nie powiodło się.`);

    setDetections((prev) => {
      let next = [...prev];

      for (const r of updateResults) {
        if (r.status !== 'fulfilled') continue;
        const { detectionId, bbox, quad } = r.value;
        next = next.map((d) => (d.id === detectionId ? { ...d, bbox, quad: quad ?? null } : d));
      }

      const removedIds = new Set(
        removeResults
          .filter((r) => r.status === 'fulfilled')
          .map((r) => (r as PromiseFulfilledResult<string>).value),
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

  if (detections.length === 0 && !isBboxEditing) {
    const status = photo?.status;
    const notYetProcessed = status === 'uploaded' || status === 'processing';
    const processFailed = status === 'failed';
    const subMsg = notYetProcessed
      ? 'Zdjęcie nie zostało jeszcze przetworzone.'
      : processFailed
        ? 'Poprzednie przetwarzanie zakończyło się błędem.'
        : 'Zdjęcie zostało przetworzone, ale nie wykryto żadnych książek.';
    const btnLabel = notYetProcessed ? 'Przetwórz zdjęcie' : 'Ponów przetwarzanie';
    return (
      <div data-testid="detection-review-empty">
        {photoUrl && (
          <div className="mb-6">
            <img
              src={photoUrl}
              alt="Zdjęcie półki"
              className="max-h-[60vh] w-full rounded-xl object-contain"
            />
          </div>
        )}
        <div className="rounded-xl border border-dashed border-gray-300 px-6 py-8 text-center">
          <p className="text-gray-500">Brak detekcji dla tego zdjęcia.</p>
          <p className="mt-1 text-sm text-gray-400">{subMsg}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {actionMsg && <p className="mb-3 w-full text-sm text-red-600">{actionMsg}</p>}
            <button
              data-testid="process-now-button"
              onClick={() => void runRerunVision()}
              disabled={actionBusy}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {actionBusy ? 'Przetwarzanie...' : btnLabel}
            </button>
            <button
              data-testid="manual-bbox-button"
              onClick={() => setIsBboxEditing(true)}
              disabled={actionBusy || !photoUrl}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Dodaj ramki ręcznie
            </button>
          </div>
        </div>
      </div>
    );
  }

  const matchedCount = detections.filter((d) => d.candidates.length > 0).length;
  const pendingCount = detections.filter((d) => !decidedIds.has(d.id)).length;

  return (
    <div data-testid="detection-review">
      {/* Zdjęcie z ramkami detekcji — 'Pokaż wszystkie' jest w toolbarze overlay */}
      {(detections.length > 0 || isBboxEditing) && (
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
          {/* M26: koszt jako etykieta przycisku CostPanel (zamiast gołej wartości
              w tekście i ikony $ w toolbarze zdjęcia) — hint tłumaczy, co to. */}
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-gray-500">
              Vision: {visionRun.model ?? 'model'} &bull; {relativeTime(visionRun.created_at)}
            </p>
            <CostPanel
              photoId={photoId}
              label={(() => {
                // M26: PEŁNA suma (vision + OCR ramek) — spójna z sumą w dropdownie;
                // fallback do kosztu ostatniego runa, gdy suma niedostępna.
                const total = costsTotalUsd ?? visionRun.cost_usd;
                return total != null ? `$${total.toFixed(4)}` : 'koszt';
              })()}
              hint="Pełny koszt AI tego zdjęcia (wszystkie analizy vision + doczytywanie OCR ramek). Kliknij, by zobaczyć listę wywołań z cenami."
              preloadedVisionRun={{ ...visionRun, status: 'completed' }}
            />
          </div>
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
            <button
              data-testid="add-missed-book-button"
              disabled={actionBusy || isBboxEditing || applyingEdits}
              onClick={() => {
                setShowAddMissedForm(true);
                setAddMissedErrorMsg(null);
              }}
              className="inline-flex items-center rounded-md border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
            >
              + Dodaj pominiętą książkę
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
        Wykryto <strong>{detections.length}</strong> &bull; dopasowano{' '}
        <strong>{matchedCount}</strong>
        {pendingCount > 0 && (
          <>
            {' '}
            &bull; pozostało <strong>{pendingCount}</strong>
          </>
        )}
        {/* M26: koszt zniknął stąd — żyje jako przycisk w panelu vision-run wyżej */}
      </p>

      <ViewModeSwitcher mode={viewMode} onChange={setViewMode} />

      {viewMode === 'list' ? (
        <div className="space-y-2">
          {detections.map((det) => (
            <div
              key={det.id}
              onContextMenu={(e) => {
                if (e.ctrlKey) {
                  e.preventDefault();
                  handleCardContextMenu(det);
                }
              }}
            >
              <DetectionRow
                detection={det}
                onDecided={handleDecided}
                onRefined={handleRefined}
                onUndecided={handleUndecided}
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
            <div
              key={det.id}
              onContextMenu={(e) => {
                if (e.ctrlKey) {
                  e.preventDefault();
                  handleCardContextMenu(det);
                }
              }}
            >
              <DetectionTile
                detection={det}
                onDecided={handleDecided}
                onRefined={handleRefined}
                onUndecided={handleUndecided}
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
            <div
              key={det.id}
              onContextMenu={(e) => {
                if (e.ctrlKey) {
                  e.preventDefault();
                  handleCardContextMenu(det);
                }
              }}
            >
              <DetectionCard
                detection={det}
                onDecided={handleDecided}
                onRefined={handleRefined}
                onUndecided={handleUndecided}
                onSelect={setFocusedDetectionId}
                isSelected={focusedDetectionId === det.id}
                onNavigateToMarker={() => handleCardContextMenu(det)}
                photoId={photoId}
              />
            </div>
          ))}
        </div>
      )}

      {/* Modal: Dodaj pominiętą książkę — otwierany z panelu Vision. Dwuetapowy:
          (1) formularz tytułu → Szukaj; (2) karta z kandydatami → Akceptuj/Wpisz ręcznie.
          Modal zostaje otwarty przez cały proces (S-43). */}
      {showAddMissedForm && (
        <CorrectionModal onClose={closeAddMissed}>
          {addMissedDetection ? (
            <div className="space-y-3" data-testid="add-missed-review">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Potwierdź książkę
              </p>
              <DetectionCard
                detection={addMissedDetection}
                photoId={photoId}
                onDecided={finishAddMissed}
                onRefined={setAddMissedDetection}
              />
              <button
                type="button"
                data-testid="add-missed-close"
                onClick={closeAddMissed}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                Zamknij
              </button>
            </div>
          ) : (
            <AddMissedBookForm
              busy={addMissedBusy}
              errorMsg={addMissedErrorMsg}
              onSubmit={(title, author, isbn, publisher) =>
                void handleAddMissedBook(title, author, isbn, publisher)
              }
              onCancel={closeAddMissed}
            />
          )}
        </CorrectionModal>
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
