import { describe, expect, it } from 'vitest';

import {
  classifyCropQuality,
  isBudgetAvailable,
  shouldTriggerRefine,
  REFINE_BUDGET_LIMITS,
} from '../../../../src/lib/matching/fallbackPolicy';

describe('fallbackPolicy', () => {
  it('classifies missing bbox', () => {
    expect(classifyCropQuality(null)).toBe('missing_bbox');
  });

  it('classifies clean single spine bbox', () => {
    expect(classifyCropQuality({ x1: 0.2, y1: 0.1, x2: 0.32, y2: 0.95 })).toBe('clean_single_spine');
  });

  it('classifies narrow short spine as clean_single_spine when aspect >= 1.0 (relaxed threshold)', () => {
    // width=0.08, height=0.15, aspect≈1.875 — small book previously blocked by height>=0.3 gate
    expect(classifyCropQuality({ x1: 0.1, y1: 0.4, x2: 0.18, y2: 0.55 })).toBe('clean_single_spine');
  });

  it('classifies squarish bbox (aspect < 1.0) as uncertain_localization', () => {
    // width=0.15, height=0.10, aspect≈0.67 — wider than tall, not a vertical spine
    expect(classifyCropQuality({ x1: 0.1, y1: 0.3, x2: 0.25, y2: 0.4 })).toBe('uncertain_localization');
  });

  it('classifies multi-spine overlap bbox when area is too large', () => {
    expect(classifyCropQuality({ x1: 0.1, y1: 0.05, x2: 0.95, y2: 0.9 })).toBe('multi_spine_overlap');
  });

  it('blocks refine when budget limit is reached', () => {
    const result = shouldTriggerRefine(
      {
        visionConfidence: 0.45,
        candidateCount: 0,
        topMatchScore: null,
        rawTitle: 'RACHEL CAINE',
        rawAuthor: null,
      },
      {
        refineCallsForPhoto: REFINE_BUDGET_LIMITS.maxRefineCallsPerPhoto,
        refineCallsForUserAction: 0,
        refineCallsForDay: 0,
      }
    );

    expect(result.triggered).toBe(false);
    expect(result.blockedByBudget).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('triggers refine for low confidence and no candidates when budget is available', () => {
    const result = shouldTriggerRefine(
      {
        visionConfidence: 0.4,
        candidateCount: 0,
        topMatchScore: null,
        rawTitle: 'Poraniona blyskawica',
        rawAuthor: 'Natasza Socha',
      },
      {
        refineCallsForPhoto: 0,
        refineCallsForUserAction: 0,
        refineCallsForDay: 0,
      }
    );

    expect(result.triggered).toBe(true);
    expect(result.blockedByBudget).toBe(false);
    expect(result.reasons).toContain('low_confidence');
    expect(result.reasons).toContain('no_candidates');
  });

  it('isBudgetAvailable returns true only below all limits', () => {
    expect(
      isBudgetAvailable({
        refineCallsForPhoto: 1,
        refineCallsForUserAction: 0,
        refineCallsForDay: 5,
      })
    ).toBe(true);

    expect(
      isBudgetAvailable({
        refineCallsForPhoto: 1,
        refineCallsForUserAction: REFINE_BUDGET_LIMITS.maxRefineCallsPerUserAction,
        refineCallsForDay: 5,
      })
    ).toBe(false);
  });
});
