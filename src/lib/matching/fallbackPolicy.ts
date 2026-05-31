export const LOW_CONFIDENCE_THRESHOLD = 0.62;
export const LOW_MATCH_SCORE_THRESHOLD = 0.55;
export const CONSERVATIVE_REPLACE_MARGIN = 0.08;

export const REFINE_BUDGET_LIMITS = {
  maxRefineCallsPerPhoto: 3,
  maxRefineCallsPerUserAction: 1,
  maxRefineCallsPerDay: 30,
} as const;

export type RefineRolloutMode = 'manual_only' | 'auto_for_triggered';
export const REFINE_ROLLOUT_MODE: RefineRolloutMode = 'manual_only';

export type CropQuality =
  | 'clean_single_spine'
  | 'multi_spine_overlap'
  | 'uncertain_localization'
  | 'missing_bbox';

export type NormalizedBbox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type FallbackBudgetState = {
  refineCallsForPhoto: number;
  refineCallsForUserAction: number;
  refineCallsForDay: number;
};

export type FallbackTriggerReason =
  | 'low_confidence'
  | 'no_candidates'
  | 'low_top_score'
  | 'title_looks_like_author'
  | 'missing_title';

export type TriggerInput = {
  visionConfidence: number | null;
  candidateCount: number;
  topMatchScore: number | null;
  rawTitle: string | null;
  rawAuthor: string | null;
  forceManual?: boolean;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normText(value: string | null): string {
  return (value ?? '').trim();
}

function looksLikeAuthorName(value: string): boolean {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length < 4 || compact.length > 40) return false;
  const parts = compact.split(' ');
  if (parts.length < 2 || parts.length > 4) return false;
  const lettersOnly = parts.every((part) => /^[\p{L}.'-]+$/u.test(part));
  if (!lettersOnly) return false;
  return parts.every((part) => part.length >= 2 && part.length <= 20);
}

export function classifyCropQuality(bbox: NormalizedBbox | null): CropQuality {
  if (!bbox) return 'missing_bbox';

  const x1 = clamp01(bbox.x1);
  const y1 = clamp01(bbox.y1);
  const x2 = clamp01(bbox.x2);
  const y2 = clamp01(bbox.y2);

  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const area = width * height;

  if (width <= 0 || height <= 0) return 'uncertain_localization';
  if (area > 0.55 || width > 0.55) return 'multi_spine_overlap';
  if (area < 0.01 || width < 0.02 || height < 0.2) return 'uncertain_localization';

  const aspect = height / width;
  if (aspect >= 1.8 && width <= 0.4 && height >= 0.3) {
    return 'clean_single_spine';
  }

  return 'uncertain_localization';
}

export function isBudgetAvailable(state: FallbackBudgetState): boolean {
  return (
    state.refineCallsForPhoto < REFINE_BUDGET_LIMITS.maxRefineCallsPerPhoto &&
    state.refineCallsForUserAction < REFINE_BUDGET_LIMITS.maxRefineCallsPerUserAction &&
    state.refineCallsForDay < REFINE_BUDGET_LIMITS.maxRefineCallsPerDay
  );
}

export function shouldTriggerRefine(
  input: TriggerInput,
  budget: FallbackBudgetState
): {
  triggered: boolean;
  reasons: FallbackTriggerReason[];
  blockedByBudget: boolean;
  rolloutMode: RefineRolloutMode;
} {
  const reasons: FallbackTriggerReason[] = [];
  const title = normText(input.rawTitle);

  if (input.forceManual === true) {
    return {
      triggered: isBudgetAvailable(budget),
      reasons: [],
      blockedByBudget: !isBudgetAvailable(budget),
      rolloutMode: REFINE_ROLLOUT_MODE,
    };
  }

  if (input.visionConfidence != null && input.visionConfidence < LOW_CONFIDENCE_THRESHOLD) {
    reasons.push('low_confidence');
  }
  if (input.candidateCount === 0) {
    reasons.push('no_candidates');
  }
  if (input.topMatchScore != null && input.topMatchScore < LOW_MATCH_SCORE_THRESHOLD) {
    reasons.push('low_top_score');
  }
  if (title.length === 0) {
    reasons.push('missing_title');
  }
  if (title.length > 0 && looksLikeAuthorName(title) && !input.rawAuthor) {
    reasons.push('title_looks_like_author');
  }

  const wantsRefine = reasons.length > 0;
  const budgetAvailable = isBudgetAvailable(budget);

  if (!wantsRefine) {
    return {
      triggered: false,
      reasons,
      blockedByBudget: false,
      rolloutMode: REFINE_ROLLOUT_MODE,
    };
  }

  return {
    triggered: budgetAvailable,
    reasons,
    blockedByBudget: !budgetAvailable,
    rolloutMode: REFINE_ROLLOUT_MODE,
  };
}
