We are adding an E2E test for this risk from context/foundation/test-plan.md:
[risk id/title + short description]

Research anchor:
[test-plan.md phase reference, change folder, or specific flow from the rollout plan]

Business scenario (one observable behavior that must stay true after this flow):
[what the user sees that must not break — this becomes your assertion]

Real boundaries (do not mock — the risk hides here):
[auth, routing, API, database]

Mocked boundaries (mock at network layer):
[external APIs that are expensive or non-deterministic]

Write a Playwright test following seed.spec.ts patterns and the E2E rules
in the project rules file.
Assert the business outcome that would fail if this risk materialized.
Explain in one sentence which regression this test catches.

---
Worked example (10xCards, test-plan.md Phase 6):
---

We are adding an E2E test for this risk from context/foundation/test-plan.md:
Risk #1+#2: Generated flashcards are lost after page reload — atomic save
writes cards to DB, but data doesn't survive a full SSR page reload.

Research anchor:
test-plan.md Phase 6, scenario (a): "generate → review → save full happy path
with OpenRouter mocked at network layer, asserts atomic save and deck state
across SSR↔island handoff."

Business scenario (one observable behavior that must stay true after this flow):
After generating flashcards, accepting drafts, and reloading the page, the deck
and its cards are still visible. If the data is lost, this test must fail.

Real boundaries (do not mock — the risk hides here):
Auth (storageState), API routes (/api/generate, /api/cards), Supabase DB,
SSR rendering after reload.

Mocked boundaries (mock at network layer):
OpenRouter API — return a valid, schema-conformant response without hitting
the real LLM.

Write a Playwright test following seed.spec.ts patterns and the E2E rules
in the project rules file.
Assert the business outcome that would fail if this risk materialized.
Explain in one sentence which regression this test catches.
