<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Dwa tory identyfikacji książek (OCR bez LLM + fallback LLM)

- **Plan**: `context/changes/image-identification-dual-path/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-01
- **Verdict**: REVISE
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

Grounding: 5/5 paths ✓, 3/3 symbols ✓, brief↔plan ✓

## Findings

### F1 — Brak jawnego kryterium ekonomicznego dla fallbacku

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 2 — Trigger policy
- **Detail**: Plan definiuje gating techniczny, ale nie zawiera mierzalnego progu kosztowego (np. max dodatkowych refine-calli / zdjęcie / dzień). Bez tego łatwo o stopniowe przekroczenie budżetu.
- **Fix A ⭐ Recommended**: Dodać SLO kosztowe do planu (np. max refine-calls per photo i per user action) oraz telemetryjny alert przekroczeń.
  - Strength: Koszt staje się sterowalny operacyjnie.
  - Tradeoff: Wymaga doprecyzowania metryk i logowania.
  - Confidence: HIGH — bez tego gating pozostaje miękki.
  - Blind spot: Brak danych o realnym wolumenie produkcyjnym.
- **Fix B**: Ograniczyć fallback do trybu manualnego (user click) na pierwszym rollout.
  - Strength: Proste, natychmiastowe ograniczenie kosztu.
  - Tradeoff: Mniejszy automatyczny zysk jakości.
  - Confidence: HIGH — szybka dźwignia kosztowa.
  - Blind spot: Potencjalny spadek UX przy większej liczbie ręcznych akcji.
- **Decision**: ACCEPTED (Fix A)

### F2 — Brak twardego gate dla jakości bbox przed OCR/LLM fallback

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 / Phase 2
- **Detail**: Plan wspomina bbox quality gate, ale nie definiuje algorytmu klasyfikacji cropa (`clean_single_spine` vs `multi_spine_overlap`) ani fallbacku, gdy crop jest zły. To krytyczny warunek dla przypadków podobnych do zdjęcia `ca035e1e-a58d-42ff-86be-66eb521853e1`.
- **Fix A ⭐ Recommended**: Dodać jawną funkcję klasyfikującą jakość cropa i zablokować refine, gdy crop nie izoluje pojedynczego grzbietu.
  - Strength: Ogranicza koszt i halucynacje na złym wejściu.
  - Tradeoff: Wymaga dodatkowej heurystyki i testów.
  - Confidence: HIGH — potwierdzone badaniami cropów.
  - Blind spot: Dobór progów heurystyki może wymagać iteracji.
- **Fix B**: Zamiast heurystyki, wymusić manualne potwierdzenie cropa przed refine.
  - Strength: Bardzo bezpieczne jakościowo.
  - Tradeoff: Wolniejsze i mniej skalowalne UX.
  - Confidence: MEDIUM — dobre krótkoterminowo, słabe długoterminowo.
  - Blind spot: Brak danych o akceptowalności UX.
- **Decision**: ACCEPTED (Fix A)

### F3 — Faza 4 warunkowa bez jawnego kryterium wejścia

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4
- **Detail**: Plan opisuje fazę warunkową, ale nie zawiera jednego kryterium przejścia z fazy 3 do 4.
- **Fix**: Dodać jednozdaniowy gate: „Phase 4 startuje tylko jeśli benchmark OCR osiągnie min. X poprawy recall przy koszcie <= Y”.
- **Decision**: ACCEPTED

## Triage Outcome

- F1 applied in plan: dodane twarde SLO kosztowe (`3/photo`, `1/action`, `30/day`) + rollout `manual_only`.
- F2 applied in plan and code scope: dodana jawna klasyfikacja jakości bbox i wymóg `clean_single_spine`.
- F3 applied in plan: dodany jednoznaczny gate wejścia do Phase 4.
