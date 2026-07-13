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

export function isAiResolutionBudgetAvailable(state: AiResolutionBudgetState): boolean {
  return (
    state.callsForPhoto < AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerPhoto &&
    state.callsForDay < AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerDay
  );
}
