// Guardrail kosztowy dla AI-resolution (S-50) — w przeciwieństwie do
// matching/fallbackPolicy.ts::REFINE_BUDGET_LIMITS (martwy kod, nigdy niewpięty),
// ten budżet jest faktycznie wołany z endpointu (src/pages/api/detections/[id]/resolve.ts).
export const AI_RESOLUTION_BUDGET_LIMITS = {
  maxCallsPerPhoto: 3,
  maxCallsPerUserAction: 1,
  maxCallsPerDay: 20,
} as const;

export type AiResolutionBudgetState = {
  callsForPhoto: number;
  callsForDay: number;
};

export type AiResolutionBudgetLimits = { maxCallsPerPhoto: number; maxCallsPerDay: number };

export function isAiResolutionBudgetAvailable(
  state: AiResolutionBudgetState,
  limits: AiResolutionBudgetLimits = AI_RESOLUTION_BUDGET_LIMITS,
): boolean {
  return state.callsForPhoto < limits.maxCallsPerPhoto && state.callsForDay < limits.maxCallsPerDay;
}

// Efektywny początek "dzisiaj" dla liczenia dziennego budżetu — domyślnie północ UTC,
// chyba że user zresetował licznik później (miękki reset bez naruszania resolution_calls).
export function effectiveDailyWindowStart(now: Date, resetAt: string | null): Date {
  const todayStartUtc = new Date(now);
  todayStartUtc.setUTCHours(0, 0, 0, 0);
  if (!resetAt) return todayStartUtc;
  const reset = new Date(resetAt);
  return reset > todayStartUtc ? reset : todayStartUtc;
}
