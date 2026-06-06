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
    expect(classifyCropQuality({ x1: 0.2, y1: 0.1, x2: 0.32, y2: 0.95 })).toBe(
      'clean_single_spine',
    );
  });

  it('classifies narrow short spine as clean_single_spine when aspect >= 1.0 (relaxed threshold)', () => {
    // width=0.08, height=0.15, aspect≈1.875 — small book previously blocked by height>=0.3 gate
    expect(classifyCropQuality({ x1: 0.1, y1: 0.4, x2: 0.18, y2: 0.55 })).toBe(
      'clean_single_spine',
    );
  });

  it('classifies squarish bbox (aspect < 1.0) as uncertain_localization', () => {
    // width=0.15, height=0.10, aspect≈0.67 — wider than tall, not a vertical spine
    expect(classifyCropQuality({ x1: 0.1, y1: 0.3, x2: 0.25, y2: 0.4 })).toBe(
      'uncertain_localization',
    );
  });

  it('classifies multi-spine overlap bbox when area is too large', () => {
    expect(classifyCropQuality({ x1: 0.1, y1: 0.05, x2: 0.95, y2: 0.9 })).toBe(
      'multi_spine_overlap',
    );
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
      },
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
      },
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
      }),
    ).toBe(true);

    expect(
      isBudgetAvailable({
        refineCallsForPhoto: 1,
        refineCallsForUserAction: REFINE_BUDGET_LIMITS.maxRefineCallsPerUserAction,
        refineCallsForDay: 5,
      }),
    ).toBe(false);
  });

  // --- Testy graniczne dopisane po pierwszym runie mutation testing (Stryker,
  // P3 planu certyfikacyjnego): zabijają mutanty progów, geometrii bbox
  // i heurystyki looksLikeAuthorName, które przeżyły run bazowy (score 34%).

  it('granica dzienna budżetu: 29 → dostępny, 30 (limit) → wyczerpany', () => {
    const base = { refineCallsForPhoto: 0, refineCallsForUserAction: 0 };
    expect(isBudgetAvailable({ ...base, refineCallsForDay: 29 })).toBe(true);
    expect(
      isBudgetAvailable({ ...base, refineCallsForDay: REFINE_BUDGET_LIMITS.maxRefineCallsPerDay }),
    ).toBe(false);
  });

  it('próg low_confidence jest ostry: 0.62 nie triggeruje, 0.61 triggeruje', () => {
    const budget = { refineCallsForPhoto: 0, refineCallsForUserAction: 0, refineCallsForDay: 0 };
    const input = {
      candidateCount: 3,
      topMatchScore: 0.9,
      rawTitle: 'Solaris',
      rawAuthor: 'Stanisław Lem',
    };
    expect(shouldTriggerRefine({ ...input, visionConfidence: 0.62 }, budget).reasons).toEqual([]);
    expect(shouldTriggerRefine({ ...input, visionConfidence: 0.61 }, budget).reasons).toEqual([
      'low_confidence',
    ]);
    // null confidence nie generuje powodu
    expect(shouldTriggerRefine({ ...input, visionConfidence: null }, budget).reasons).toEqual([]);
  });

  it('próg low_top_score jest ostry: 0.55 nie triggeruje, 0.54 triggeruje', () => {
    const budget = { refineCallsForPhoto: 0, refineCallsForUserAction: 0, refineCallsForDay: 0 };
    const input = {
      visionConfidence: 0.9,
      candidateCount: 3,
      rawTitle: 'Solaris',
      rawAuthor: 'Stanisław Lem',
    };
    expect(shouldTriggerRefine({ ...input, topMatchScore: 0.55 }, budget).reasons).toEqual([]);
    expect(shouldTriggerRefine({ ...input, topMatchScore: 0.54 }, budget).reasons).toEqual([
      'low_top_score',
    ]);
  });

  it('pusty / białoznakowy tytuł daje powód missing_title', () => {
    const budget = { refineCallsForPhoto: 0, refineCallsForUserAction: 0, refineCallsForDay: 0 };
    const input = {
      visionConfidence: 0.9,
      candidateCount: 3,
      topMatchScore: 0.9,
      rawAuthor: null,
    };
    expect(shouldTriggerRefine({ ...input, rawTitle: null }, budget).reasons).toEqual([
      'missing_title',
    ]);
    expect(shouldTriggerRefine({ ...input, rawTitle: '   ' }, budget).reasons).toEqual([
      'missing_title',
    ]);
  });

  it('title_looks_like_author tylko gdy brak rawAuthor i tytuł wygląda jak 2-4 słowa nazwiska', () => {
    const budget = { refineCallsForPhoto: 0, refineCallsForUserAction: 0, refineCallsForDay: 0 };
    const clean = { visionConfidence: 0.9, candidateCount: 3, topMatchScore: 0.9 };

    // 2 słowa wyglądające jak imię+nazwisko, brak autora → trigger
    expect(
      shouldTriggerRefine({ ...clean, rawTitle: 'Rachel Caine', rawAuthor: null }, budget).reasons,
    ).toEqual(['title_looks_like_author']);
    // ten sam tytuł, ale autor już odczytany → bez powodu
    expect(
      shouldTriggerRefine({ ...clean, rawTitle: 'Rachel Caine', rawAuthor: 'Rachel Caine' }, budget)
        .reasons,
    ).toEqual([]);
    // jedno słowo → nie wygląda jak nazwisko
    expect(
      shouldTriggerRefine({ ...clean, rawTitle: 'Solaris', rawAuthor: null }, budget).reasons,
    ).toEqual([]);
    // 5 słów → za dużo członów na nazwisko
    expect(
      shouldTriggerRefine(
        { ...clean, rawTitle: 'Bardzo Długi Tytuł Pełen Słów', rawAuthor: null },
        budget,
      ).reasons,
    ).toEqual([]);
    // cyfra w członie → odpada (lettersOnly)
    expect(
      shouldTriggerRefine({ ...clean, rawTitle: 'Rachel 1234', rawAuthor: null }, budget).reasons,
    ).toEqual([]);
    // człon 1-znakowy → odpada (część < 2 znaki)
    expect(
      shouldTriggerRefine({ ...clean, rawTitle: 'R Caine', rawAuthor: null }, budget).reasons,
    ).toEqual([]);
  });

  it('forceManual pomija powody i triggeruje przy dostępnym budżecie', () => {
    const input = {
      visionConfidence: 0.99,
      candidateCount: 5,
      topMatchScore: 0.99,
      rawTitle: 'Solaris',
      rawAuthor: 'Stanisław Lem',
      forceManual: true,
    };
    const ok = shouldTriggerRefine(input, {
      refineCallsForPhoto: 0,
      refineCallsForUserAction: 0,
      refineCallsForDay: 0,
    });
    expect(ok).toEqual({
      triggered: true,
      reasons: [],
      blockedByBudget: false,
      rolloutMode: 'manual_only',
    });

    const blocked = shouldTriggerRefine(input, {
      refineCallsForPhoto: REFINE_BUDGET_LIMITS.maxRefineCallsPerPhoto,
      refineCallsForUserAction: 0,
      refineCallsForDay: 0,
    });
    expect(blocked.triggered).toBe(false);
    expect(blocked.blockedByBudget).toBe(true);
  });

  it('brak powodów = triggered false i blockedByBudget false nawet przy wyczerpanym budżecie', () => {
    const result = shouldTriggerRefine(
      {
        visionConfidence: 0.9,
        candidateCount: 3,
        topMatchScore: 0.9,
        rawTitle: 'Solaris',
        rawAuthor: 'Stanisław Lem',
      },
      {
        refineCallsForPhoto: REFINE_BUDGET_LIMITS.maxRefineCallsPerPhoto,
        refineCallsForUserAction: 0,
        refineCallsForDay: 0,
      },
    );
    expect(result.triggered).toBe(false);
    expect(result.blockedByBudget).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('geometria bbox: granice szerokości/pola/aspektu klasyfikowane ostro', () => {
    // szerokość > 0.55 → multi_spine_overlap (nawet przy małym polu; warunek
    // area > 0.55 jest subsumowany przez width > 0.55, bo area ≤ width przy y ≤ 1)
    expect(classifyCropQuality({ x1: 0, y1: 0, x2: 0.6, y2: 0.4 })).toBe('multi_spine_overlap');
    // zerowa szerokość (x1 == x2) → uncertain
    expect(classifyCropQuality({ x1: 0.3, y1: 0.1, x2: 0.3, y2: 0.9 })).toBe(
      'uncertain_localization',
    );
    // szerokość < 0.02 → uncertain (za wąski crop)
    expect(classifyCropQuality({ x1: 0.1, y1: 0.1, x2: 0.115, y2: 0.9 })).toBe(
      'uncertain_localization',
    );
    // pole < 0.005 → uncertain (za mały crop)
    expect(classifyCropQuality({ x1: 0.1, y1: 0.1, x2: 0.14, y2: 0.2 })).toBe(
      'uncertain_localization',
    );
    // aspect < 0.5 (leżąca książka, landscape) → uncertain
    expect(classifyCropQuality({ x1: 0.1, y1: 0.4, x2: 0.5, y2: 0.55 })).toBe(
      'uncertain_localization',
    );
    // aspect dokładnie 1.0 (kwadrat) → clean_single_spine (granica >= 1.0)
    expect(classifyCropQuality({ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4 })).toBe('clean_single_spine');
    // clamp01: współrzędne poza 0..1 przycinane przed liczeniem
    expect(classifyCropQuality({ x1: -0.5, y1: 0, x2: 0.3, y2: 1.8 })).toBe('clean_single_spine');
  });
});
