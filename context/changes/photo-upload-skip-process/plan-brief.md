# S-36: Upload bez uruchamiania vision — Plan Brief

> Full plan: `context/changes/photo-upload-skip-process/plan.md`

## What & Why

User płaci za każdy vision call. Checkbox „Analizuj od razu" (default: tak) daje
kontrolę: odznaczony → zdjęcie ląduje w Storage/DB jako `uploaded` bez wywołania
LLM; analiza ręcznie z taba Zdjęcia, kiedy user zechce.

## Starting Point

Backend w 100% gotowy (`status='uploaded'` to stan bazowy; `/process` woła klient;
tab Zdjęcia z S-29 ma akcję „Uruchom vision" z guardem BYOK). Brakuje tylko decyzji
w PhotoUploader + lądowania na właściwym tabie.

## Key Decisions Made (Fast track — zawetuj wyjątki)

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Przycisk w tabie | Zostaje „Uruchom vision" (bez rename na „Analizuj") | Spójność z granularnym pipeline S-29 (vision/match osobno); rename ruszałby 3 testy bez wartości |
| Persist checkboxa | localStorage `bookshelf:upload-auto-process` | Literalnie z Outcome roadmapy |
| Resume-state przy skip | NIE zapisujemy `upload_resume_photo_id` | Pitfall z roadmapy — recovery-effect wznowiłby pipeline wbrew decyzji usera |
| Redirect po skip | `/shelves/{id}?tab=photos` + obsługa `?tab=` w `useShelfTab` | User od razu widzi wgrane zdjęcie z akcją; param > localStorage na mount |

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. checkbox + tab param + testy | Cały slice (pure UI) | regres recovery-effectu na /upload |

**Prerequisites:** S-29 (done) · **Estimated effort:** 1 sesja, 1 faza (S)

## Success Criteria (Summary)

- Odznaczony checkbox → ZERO requestów `/process`/`/match` (asercja E2E), zdjęcie
  w tabie Zdjęcia z akcją „Uruchom vision"
- Zaznaczony (default) → flow jak dotąd; preferencja przeżywa reload
- Lint/typecheck/unit/E2E zielone
