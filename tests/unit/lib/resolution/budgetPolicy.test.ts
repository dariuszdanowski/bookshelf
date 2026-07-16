import { describe, expect, it } from 'vitest';

import {
  AI_RESOLUTION_BUDGET_LIMITS,
  effectiveDailyWindowStart,
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

  it('respektuje custom limity przekazane jako parametr (niższe niż default)', () => {
    expect(
      isAiResolutionBudgetAvailable(
        { callsForPhoto: 1, callsForDay: 0 },
        { maxCallsPerPhoto: 1, maxCallsPerDay: 20 },
      ),
    ).toBe(false);
    expect(
      isAiResolutionBudgetAvailable(
        { callsForPhoto: 0, callsForDay: 0 },
        { maxCallsPerPhoto: 1, maxCallsPerDay: 20 },
      ),
    ).toBe(true);
  });

  it('respektuje custom limity przekazane jako parametr (wyższe niż default)', () => {
    expect(
      isAiResolutionBudgetAvailable(
        { callsForPhoto: 5, callsForDay: 50 },
        { maxCallsPerPhoto: 10, maxCallsPerDay: 100 },
      ),
    ).toBe(true);
  });
});

describe('effectiveDailyWindowStart', () => {
  const now = new Date('2026-07-16T14:30:00.000Z');
  const todayMidnightUtc = new Date('2026-07-16T00:00:00.000Z');

  it('brak resetu → dzisiejsza północ UTC', () => {
    expect(effectiveDailyWindowStart(now, null).getTime()).toBe(todayMidnightUtc.getTime());
  });

  it('reset sprzed dzisiejszej północy → ignorowany, zwraca dzisiejszą północ', () => {
    const yesterdayReset = '2026-07-15T20:00:00.000Z';
    expect(effectiveDailyWindowStart(now, yesterdayReset).getTime()).toBe(
      todayMidnightUtc.getTime(),
    );
  });

  it('reset po dzisiejszej północy → honorowany, zawęża okno', () => {
    const todayReset = '2026-07-16T10:00:00.000Z';
    expect(effectiveDailyWindowStart(now, todayReset).getTime()).toBe(
      new Date(todayReset).getTime(),
    );
  });
});
