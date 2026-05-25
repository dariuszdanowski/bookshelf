<!-- PLAN-REVIEW-REPORT -->
# Plan Review: F-01 Persystencja + izolacja per-user

- **Plan**: context/changes/data-and-rls-substrate/plan.md
- **Mode**: Deep
- **Date**: 2026-05-25
- **Verdict**: REVISE (po triage: SOUND — wszystkie findingi zaadresowane)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

existing paths ✓, @supabase/ssr 0.10.3 (getAll/setAll) ✓, @supabase/supabase-js 2.106.0 (admin API) ✓, contract-surfaces.md absent (skip), brief↔plan ✓; ⚠ supabase CLI not on PATH (F1), vitest.config.ts already excludes integration via `include: tests/unit/**` (F3).

## Findings

### F1 — Plan używa gołych `supabase` komend, CLI nie ma na PATH

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 + Prerequisites
- **Detail**: Faza 1 woła `supabase db push`/`gen types`/`migration list`, ale CLI nie jest na PATH. Firewall blokuje pobranie binarki (github releases). Ryzyko: Faza 1 nie startuje.
- **Fix**: `npx supabase …` wszędzie + bramka `npx supabase --version` w Critical Implementation Details przed Fazą 1.
- **Decision**: FIXED (Fix in plan) — komendy zmienione na `npx supabase`, dodana bramka wstępna.

### F2 — Świadoma dewiacja od CLAUDE.md (service-role) bez aktualizacji konwencji

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 + CLAUDE.md > Konwencje > Supabase
- **Detail**: Plan odrzuca service-role na rzecz RLS-respecting, ale CLAUDE.md nadal mówi „service role". Rozjazd kod/dok — klasa z lessons.md (load-bearing convention detail).
- **Fix**: Dodać do Fazy 2 krok aktualizujący linię Supabase w CLAUDE.md.
- **Decision**: FIXED (Fix in plan) — dodany Phase 2 change #3 + kryterium 2.4 + Progress 2.4.

### F3 — Phase 3 sugeruje zbędną edycję vitest.config.ts

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, change #1
- **Detail**: Domyślny config ma `include: ['tests/unit/**']` — integration już poza zakresem, kryterium 3.3 spełnione bez edycji.
- **Fix**: Doprecyzować, że vitest.config.ts nie wymaga edycji.
- **Decision**: FIXED (Fix in plan) — Contract Phase 3 #1 doprecyzowany.

### F4 — Drift tytułów: Progress vs bullet-y Success Criteria

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress 2.1, 3.1, 3.2
- **Detail**: Tytuły w Progress przeredagowane vs bullet-y w blokach faz; progress-format mówi „Do not rename step titles".
- **Fix**: Zsynchronizować tytuły Progress z bullet-ami.
- **Decision**: FIXED (Fix in plan) — Progress 2.1/3.1/3.2 zrównane z bullet-ami.

### F5 — Klient browser nieskonsumowany/nietestowany w F-01

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2, change #1 (supabase.browser.ts)
- **Detail**: Brak konsumenta i pokrycia testem w F-01; „substrat na zapas" (uzasadniony roadmap + CLAUDE.md).
- **Fix**: Zostaw jako substrat albo odłóż do S-01.
- **Decision**: ACCEPTED — zostaje w F-01 jako świadomy substrat (roadmap + CLAUDE.md nazywają oba klienty).
