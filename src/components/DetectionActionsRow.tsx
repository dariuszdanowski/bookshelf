import type { BookCandidateDTO } from '../lib/books/schema';
import type { DetectionWithCandidatesDTO } from '../lib/photos/schema';
import { classifyCropQuality } from '../lib/matching/fallbackPolicy';
import CorrectionHistoryPanel from './CorrectionHistoryPanel';

// ---------------------------------------------------------------------------
// RefineButton — wspólny przycisk „Doprecyzuj odczyt" dla wszystkich trybów
// review. Jeden label (rozróżnialność weak/good po ⚠ prefixie, nie po kolorze
// — M3L4), sygnał weak-crop (⚠ + amber + tooltip) i widoczna informacja o
// koszcie (refine = dodatkowe płatne wywołanie AI). Likwiduje 3 kopie inline.
// ---------------------------------------------------------------------------
export function RefineButton({
  bbox,
  busy,
  onClick,
  size = 'md',
  noApiKey = false,
}: {
  bbox: DetectionWithCandidatesDTO['bbox'];
  busy: boolean;
  onClick: () => void;
  size?: 'lg' | 'md' | 'sm';
  // per-call-byok-key-override: user z 0 kluczami BYOK — przycisk disabled
  // zamiast pozwalać kliknąć i dostać błąd NO_API_KEY po fakcie.
  noApiKey?: boolean;
}) {
  // identity-first: refine = crop re-OCR; bez bboxa nie ma co przycinać
  if (bbox === null) return null;
  const isWeak = classifyCropQuality(bbox) === 'uncertain_localization';
  const sizeCls = size === 'lg' ? 'px-3 py-1.5' : size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1';
  const colorCls = isWeak
    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
    : 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100';
  const label = busy ? 'Doprecyzowuję...' : isWeak ? '⚠ Doprecyzuj odczyt' : 'Doprecyzuj odczyt';
  const title = noApiKey
    ? 'Brak klucza API — dodaj klucz w ustawieniach konta (/account)'
    : isWeak
      ? '⚠ Crop o niskiej jakości — wynik może być słaby. Dodatkowa analiza AI (płatne).'
      : 'Doprecyzuj odczyt — dodatkowa analiza AI (płatne)';
  return (
    <span className="inline-flex items-center gap-1">
      <button
        data-testid="refine-button"
        disabled={busy || noApiKey}
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
export function WebSearchButton({
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

// ---------------------------------------------------------------------------
// AiResolutionButton — „Rozwiąż przez AI" (S-50): ostatni poziom kaskady
// matchingu, widoczny wyłącznie gdy detekcja nie ma żadnych kandydatów.
// Ten sam idiom co RefineButton (label + widoczny cost-hint), ale bez bbox
// (wywołanie tekstowe web_search, nie crop).
// ---------------------------------------------------------------------------
export function AiResolutionButton({
  busy,
  onClick,
  size = 'md',
  activeProviderIsAnthropic = null,
  noApiKey = false,
}: {
  busy: boolean;
  onClick: () => void;
  size?: 'lg' | 'md' | 'sm';
  activeProviderIsAnthropic?: boolean | null;
  // per-call-byok-key-override: user z 0 kluczami BYOK — przycisk disabled
  // zamiast pozwalać kliknąć i dostać błąd NO_API_KEY po fakcie.
  noApiKey?: boolean;
}) {
  const sizeCls = size === 'lg' ? 'px-3 py-1.5' : size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1';
  const label = busy ? 'Rozwiązuję...' : 'Rozwiąż przez AI';
  const title = noApiKey
    ? 'Brak klucza API — dodaj klucz w ustawieniach konta (/account)'
    : activeProviderIsAnthropic === false
      ? 'Rozwiąż przez AI — dodatkowa analiza AI (bez dostępu do internetu, wynik może być mniej trafny dla niszowych wydań)'
      : 'Rozwiąż przez AI (web search) — dodatkowa analiza AI (płatne, wymaga klucza Anthropic)';
  // impl-review F3: koszt jest realnie $0 dla openai_compatible (costUsd zawsze
  // 0 w resolveViaOpenAICompat) — hint musi to odzwierciedlać, nie twierdzić
  // "płatne" bezwarunkowo jak przed poprawką.
  const costHintText =
    activeProviderIsAnthropic === false ? 'dodatkowa analiza AI' : 'dodatkowa analiza AI — płatne';
  return (
    <span className="inline-flex items-center gap-1">
      <button
        data-testid="ai-resolution-button"
        disabled={busy || noApiKey}
        onClick={onClick}
        title={title}
        className={`rounded-md border border-purple-300 bg-purple-50 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 dark:border-purple-700 dark:bg-purple-900/20 dark:text-purple-300 dark:hover:bg-purple-900/40 ${sizeCls}`}
      >
        {label}
      </button>
      {size === 'lg' ? (
        <span
          data-testid="ai-resolution-cost-hint"
          className="text-[10px] leading-tight text-gray-400"
        >
          {costHintText}
        </span>
      ) : (
        <span
          data-testid="ai-resolution-cost-hint"
          title={costHintText}
          aria-label={costHintText}
          className="cursor-help text-xs text-gray-400"
        >
          ⓘ
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// DetectionActionsRow — Faza 4 (unify-detection-edit-entrypoint): rząd akcji
// wspólny dla Lista (DetectionRow) i Kafelki (DetectionTile) — jedyna różnica
// dziś to Tailwind padding (px-2.5 vs px-2, sterowane przez `size`) oraz prop
// `size` przekazywany do WebSearch/Refine/AiResolution. Karty (DetectionCard)
// zostają osobno — inny layout (selektor alternatyw, pełny detail kandydata),
// świadomie nie-konsolidowane.
//
// `showAiResolution` liczony jest przez wywołującego (nie tutaj) — próg
// MATCH_MID jest zdefiniowany w DetectionReview.tsx i używany też poza
// action-row (badge pewności, bulk-confirm), więc zamiast duplikować/
// importować go tutaj (cykliczny import: DetectionReview → ten plik →
// DetectionReview), wywołujący przekazuje już wyliczony boolean.
// ---------------------------------------------------------------------------

export type DetectionActionsRowProps = {
  size: 'md' | 'sm';
  detection: DetectionWithCandidatesDTO;
  top: BookCandidateDTO | null;
  activeCandidateId: string | null;
  busy: boolean;
  showAiResolution: boolean;
  hasNoApiKeys: boolean;
  activeProviderIsAnthropic: boolean | null;
  onConfirm: () => void;
  onReject: () => void;
  onCorrect: () => void;
  onRematch: () => void;
  onOpenRefineConfirm: () => void;
  onOpenAiResolveConfirm: () => void;
};

export default function DetectionActionsRow({
  size,
  detection,
  top,
  activeCandidateId,
  busy,
  showAiResolution,
  hasNoApiKeys,
  activeProviderIsAnthropic,
  onConfirm,
  onReject,
  onCorrect,
  onRematch,
  onOpenRefineConfirm,
  onOpenAiResolveConfirm,
}: DetectionActionsRowProps) {
  const padCls = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-1';
  return (
    <>
      {top && (
        <button
          data-testid="confirm-button"
          disabled={busy || !activeCandidateId}
          onClick={onConfirm}
          className={`rounded bg-green-600 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 ${padCls}`}
        >
          {busy ? '...' : 'Akceptuj'}
        </button>
      )}
      <button
        data-testid="reject-button"
        disabled={busy}
        onClick={onReject}
        className={`rounded border border-red-300 bg-red-50 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 ${padCls}`}
      >
        Odrzuć
      </button>
      {top && (
        // M19: parytet z Kartami — „Szukaj" także przy istniejącym kandydacie.
        // Bez matcha: brak odpowiednika — klik okładki załatwia edycję
        // (unify-detection-edit-entrypoint, Faza 3).
        <>
          <button
            data-testid="correct-button"
            disabled={busy}
            onClick={onCorrect}
            className={`rounded border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${padCls}`}
          >
            Popraw
          </button>
          <button
            data-testid="rematch-button"
            disabled={busy}
            onClick={onRematch}
            className={`rounded border border-emerald-300 bg-emerald-50 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40 ${padCls}`}
          >
            Szukaj
          </button>
        </>
      )}
      <WebSearchButton title={detection.raw_title} author={detection.raw_author} size={size} />
      <RefineButton
        bbox={detection.bbox}
        busy={busy}
        onClick={onOpenRefineConfirm}
        size={size}
        noApiKey={hasNoApiKeys}
      />
      {showAiResolution && (
        <AiResolutionButton
          busy={busy}
          onClick={onOpenAiResolveConfirm}
          size={size}
          activeProviderIsAnthropic={activeProviderIsAnthropic}
          noApiKey={hasNoApiKeys}
        />
      )}
      <CorrectionHistoryPanel detectionId={detection.id} />
    </>
  );
}
