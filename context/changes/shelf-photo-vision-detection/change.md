---
change_id: shelf-photo-vision-detection
title: Upload zdjęcia półki + detekcja grzbietów (vision)
status: plan_reviewed
created: 2026-05-27
updated: 2026-05-27
archived_at: null
---

## Notes

Slice **S-03** z roadmapy (Stream B, prereq S-02 ✓). Kanoniczny scope: `context/foundation/roadmap.md` § S-03.

**Outcome:** użytkownik wgrywa jedno zdjęcie półki (drag-drop / wybór z dysku) przypisane do wybranej fizycznej półki → system przetwarza → wydobywa detekcje (tytuł, autor, pewność, dominujący kolor grzbietu z palety ~10) → persistuje wszystkie detekcje **przed** matchingiem (idempotentny retry) → status z progress bar; koszt + latencja zapisane na rekordzie `photos`. PRD refs: FR-010–014, FR-039.

**Otwarte kwestie domenowe** (non-blocking, rozstrzygane w research/plan):
- Q2 — finalna paleta ~10 nazwanych kolorów grzbietu (kierunek: 11 w PRD; zamrozić przed S-08).
- Q5 — eskalacja modelu vision (MVP: jeden model; Opus jako post-MVP fallback).
- Model vision na start: **decyzja po research** (recall vs koszt vs CF Workers 30s CPU limit).

**Tryb wykonania:** modelowy cykl M2 — research (Exa+Context7) → plan (Opus) → plan-review → implement (Sonnet) → impl-review (Opus) → archive + PR + smoke. Pierwszy realny `/10x-research` i `/10x-plan-review` w projekcie.
