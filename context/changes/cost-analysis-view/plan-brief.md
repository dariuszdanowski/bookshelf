# S-41 Cost Analysis View — Plan Brief

> Full plan: `context/changes/cost-analysis-view/plan.md`

## What & Why

Drill-down kosztów AI na `/account`: modal z listą pojedynczych wywołań (vision + OCR) filtrowaną per klucz API / typ / okres, z paginacją i linkiem do zdjęcia źródłowego. Agregaty i chipy per klucz weszły w M26/M27 — brakuje odpowiedzi „co dokładnie składa się na tę kwotę".

## Starting Point

Substrat kompletny po uwagi-round3: `api_key_id` w `vision_runs`/`refine_calls` (migracja 0020, zapis przy callach, backfill prod — 26 wywołań → klucz „Anthropic"), `cost_by_key` w `GET /api/account/stats`, statyczny chip sumy przy każdym kluczu na /account.

## Desired End State

Użytkownik klika „Szczegóły" w sekcji Koszty analizy (lub chip przy kluczu → prefiltr) i widzi przeszukiwalną historię: typ, model, data, latencja, koszt, klucz, link „Zdjęcie". Filtry: klucz (w tym „Bez przypisania"), typ (vision/OCR), okres (7d/30d/wszystko); footer z sumą i liczbą wywołań dla filtra; strony po 25.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Forma widoku | Modal (`CostAnalysisModal`), nie strona | Roadmapa „widok/modal"; wzorzec BookModal; zero routingu |
| Źródło danych | Widok SQL `cost_events` (UNION ALL, `security_invoker=true`) — migracja 0021 | Jedna spójna paginacja/sort; RLS tabel bazowych zachowane |
| Endpoint | Nowy `GET /api/account/costs?key&type&period&page` | Stats zostaje agregatem; lista to inny kształt |
| Paginacja | Offset (range) + count exact, 25/str. | Skala osobista; wzorzec „Hundreds → offset" |
| Filtr klucza | Wszystkie / per klucz / „Bez przypisania" (NULL) | Koszty po usuniętych kluczach i sprzed 0020 nie znikają |
| Failed runs | Tylko `succeeded` w widoku | Spójność z agregatami stats (failed: `cost_usd NULL`) |
| Suma dla filtra | Drugie lekkie query bez paginacji | Pełna suma dla dowolnego filtra; wzorzec stats |
| Drill-down | Link `/photos/[id]` tylko gdy `photo_id != null` | FK SET NULL po delete zdjęcia; bez martwych linków |
| Formattery | Ekstrakcja do zod-free `src/lib/costs/format.ts` | Lekcja vite-stale-deps; likwiduje 2. kopię |

## Scope

**In scope:** migracja 0021 (widok), endpoint listy z filtrami+paginacją+sumą, modal, 2 punkty wejścia na /account (przycisk + klikalne chipy), unit + E2E.

**Out of scope:** zmiany w stats/chipach (poza onClick), wykresy, date-pickery, eksport CSV, pokazywanie failed runs, backfill.

## Architecture / Approach

`vision_runs` + `refine_calls` → widok `cost_events` (UNION ALL, LEFT JOIN `detections` po `raw_title`) → `GET /api/account/costs` (Zod query, F-02 envelope, 2 query: strona + suma) → `CostAnalysisModal` (React island przez AccountIsland).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Widok + API | Migracja 0021, `GET /api/account/costs`, unit testy | RLS na widoku (`security_invoker`) — walidowane przez `db reset` + e2e CI |
| 2. Modal + E2E | `CostAnalysisModal`, wpięcie w AccountIsland, E2E | Manual test na dev wymaga 0021 na prod DB (precedens M27) lub lokalnej Supabase |

**Prerequisites:** brak — substrat (0020, `cost_by_key`) zmergowany w PR #79.
**Estimated effort:** ~2 sesje (1 faza = 1 commit).

## Open Risks & Assumptions

- Dev server → prod DB: widok nie istnieje na prodzie do merge; user decyduje (ręczna aplikacja 0021 jak przy 0020 vs test na lokalnej Supabase).
- `cost_events` nie będzie w `database.types.ts` do regen — precedens `as any` ze stats.ts.

## Success Criteria (Summary)

- Z /account da się obejrzeć pełną historię wywołań z kosztami, przefiltrować per klucz/typ/okres i dotrzeć do zdjęcia źródłowego.
- Suma w footerze modalu zgadza się z chipem klucza przy pełnym zakresie (w tym 26 zbackfillowanych wywołań „Anthropic", $0.8801).
- Zielone: unit + nowy spec E2E + pełna suita + typecheck/lint/build.
