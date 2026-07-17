import { describe, expect, it } from 'vitest';

import {
  AI_RESOLUTION_BUDGET_LIMITS,
  effectiveDailyWindowStart,
  isAiResolutionBudgetAvailable,
} from '../../../../src/lib/resolution/budgetPolicy';

describe('isAiResolutionBudgetAvailable', () => {
  it('dostępny gdy dzienny licznik poniżej limitu', () => {
    expect(isAiResolutionBudgetAvailable({ callsForDay: 0 })).toBe(true);
    expect(
      isAiResolutionBudgetAvailable({
        callsForDay: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerDay - 1,
      }),
    ).toBe(true);
  });

  it('granica dzienna: dokładnie na limicie → niedostępny', () => {
    expect(
      isAiResolutionBudgetAvailable({ callsForDay: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerDay }),
    ).toBe(false);
  });

  it('powyżej dziennego limitu → niedostępny', () => {
    expect(
      isAiResolutionBudgetAvailable({
        callsForDay: AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerDay + 1,
      }),
    ).toBe(false);
  });

  it('respektuje custom limit przekazany jako parametr (niższy niż default)', () => {
    expect(isAiResolutionBudgetAvailable({ callsForDay: 1 }, { maxCallsPerDay: 1 })).toBe(false);
    expect(isAiResolutionBudgetAvailable({ callsForDay: 0 }, { maxCallsPerDay: 1 })).toBe(true);
  });

  it('respektuje custom limit przekazany jako parametr (wyższy niż default)', () => {
    expect(isAiResolutionBudgetAvailable({ callsForDay: 50 }, { maxCallsPerDay: 100 })).toBe(true);
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
