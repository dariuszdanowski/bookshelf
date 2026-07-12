import { describe, expect, it } from 'vitest';

import {
  AI_RESOLUTION_BUDGET_LIMITS,
  isAiResolutionBudgetAvailable,
} from '../../../../src/lib/resolution/budgetPolicy';

describe('isAiResolutionBudgetAvailable', () => {
  it('dostępny gdy oba liczniki poniżej limitu', () => {
    expect(isAiResolutionBudgetAvailable({ callsForPhoto: 0, callsForDay: 0 })).toBe(true);
    expect(
      isAiResolutionBudgetAvailable({
        callsForPhoto: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerPhoto - 1,
        callsForDay: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerDay - 1,
      }),
    ).toBe(true);
  });

  it('granica per-photo: dokładnie na limicie → niedostępny', () => {
    expect(
      isAiResolutionBudgetAvailable({
        callsForPhoto: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerPhoto,
        callsForDay: 0,
      }),
    ).toBe(false);
  });

  it('granica dzienna: dokładnie na limicie → niedostępny', () => {
    expect(
      isAiResolutionBudgetAvailable({
        callsForPhoto: 0,
        callsForDay: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerDay,
      }),
    ).toBe(false);
  });

  it('oba liczniki są niezależne — przekroczenie jednego blokuje mimo że drugi jest w normie', () => {
    expect(
      isAiResolutionBudgetAvailable({
        callsForPhoto: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerPhoto,
        callsForDay: 0,
      }),
    ).toBe(false);
    expect(
      isAiResolutionBudgetAvailable({
        callsForPhoto: 0,
        callsForDay: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerDay,
      }),
    ).toBe(false);
  });

  it('powyżej obu limitów → niedostępny', () => {
    expect(
      isAiResolutionBudgetAvailable({
        callsForPhoto: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerPhoto + 1,
        callsForDay: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerDay + 1,
      }),
    ).toBe(false);
  });
});
