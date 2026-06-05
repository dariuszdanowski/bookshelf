---
change_id: byok-pipeline
roadmap_slice: S-33
status: implementing
created: 2026-06-05
updated: 2026-06-05
---

# S-33 — BYOK Pipeline Enforcement

Pipeline vision wymaga klucza usera: `/api/photos/[id]/process` i `/api/detections/[id]/refine`
sprawdzają aktywny klucz w `user_api_keys`, brak klucza → 403 `NO_API_KEY`;
`src/lib/vision/client.ts` refaktorowany do abstrakcji `VisionProvider` (Anthropic SDK +
OpenAI-compatible fetch); `PhotoUploader` pokazuje empty state z CTA do `/account` gdy brak
aktywnego klucza.

Prereq: S-32 (done).
