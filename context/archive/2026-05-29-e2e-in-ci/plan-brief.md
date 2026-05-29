# Wpięcie testów E2E (Playwright) w CI — Plan Brief

> Full plan: `context/changes/e2e-in-ci/plan.md`

## What & Why

Domknięcie wymogu certyfikacji 10xDevs #5 (test E2E) i #6 (CI: lint + typecheck + vitest + **playwright** + deploy). 10 speców Playwright już istnieje, ale `ci.yml` ich nie uruchamia — wymóg #6 wprost wymienia playwright w pipeline.

## Starting Point

`ci.yml` ma jeden job `verify` (lint/typecheck/vitest/build) bez kroku E2E. `tests/e2e/` ma 10 gotowych speców + setup/teardown; `playwright.config.ts` startuje `npm run dev` jako webServer. Vision/match/storage są mockowane na poziomie API w przeglądarce (zero kosztu LLM).

## Desired End State

`ci.yml` ma drugi job `e2e`, który na każdym PR/push do main stawia efemeryczną lokalną Supabose, wpina env przez `.dev.vars`, instaluje chromium i odpala `playwright test` na zielono. Wymogi #5 i #6 zamknięte do ✅.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Źródło bazy w CI | Lokalna efemeryczna Supabase (`supabase start`) | Izolacja, zero zaśmiecania prod, waliduje migracje (gate 42P17) | Plan |
| Struktura joba | Osobny job `e2e` obok `verify` | Inny setup, nie blokuje feedbacku unit/lint | Plan |
| Wiring env | CI pisze `.dev.vars` z `supabase status` | Udokumentowany kanał env (Astro czyta tylko `.dev.vars`) | Plan |
| `ANTHROPIC_API_KEY` | Dummy placeholder | Vision mockowany browser-side → realny klucz zbędny, zero kosztu | Plan |
| Browsers | `playwright install --with-deps chromium` | Config używa tylko projektu chromium | Plan |

## Scope

**In scope:** nowy job `e2e` w `ci.yml` (Supabase-in-CI + env + chromium + run + artefakt); aktualizacja README/health-check.

**Out of scope:** realny vision w CI; zmiana speców/config; `deploy.yml`; lokalna instalacja browserów u usera; realny ANTHROPIC key w Secrets.

## Architecture / Approach

Job `e2e` (ubuntu-latest): checkout → setup-node → `npm ci` → `wrangler types` → `supabase/setup-cli` → `supabase start` (migracje+seed) → wygeneruj `.dev.vars` (127.0.0.1:54321 + klucze z `supabase status -o env` + dummy ANTHROPIC) → `playwright install --with-deps chromium` → `playwright test` (webServer sam startuje `npm run dev`) → upload `playwright-report/` (always).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Job e2e w CI | Zielony job E2E na PR | Env/networking dev↔Supabase w runnerze; czas `supabase start` |
| 2. Dokumentacja | README/health-check/AGENTS odzwierciedlają E2E-w-CI | trywialne |

**Prerequisites:** branch `change/e2e-in-ci` z main (zawiera fix 0011 IMMUTABLE).
**Estimated effort:** ~1 sesja; Phase 1 iterowana realnymi przebiegami CI (push→watch).

## Open Risks & Assumptions

- **Weryfikacja Phase 1 wymaga realnego CI runu** (GitHub Actions) — nie da się w pełni odtworzyć lokalnie; iteracja push→`gh run watch`.
- `supabase status -o env` daje stabilne nazwy kluczy — jeśli flaga/format się różni w wersji CLI, fallback: `-o json` + parse.
- Dev server boot nie waliduje `ANTHROPIC_API_KEY` (lazy-read przy endpoincie) — dummy wystarcza; gdyby walidował przy boot, dummy i tak go zaspokaja.
- `supabase start` w CI dodaje ~1-2 min (pull obrazów; cache CLI łagodzi).

## Success Criteria (Summary)

- Job `e2e` zielony na PR, job `verify` bez regresji.
- `supabase start` aplikuje migracje 0001–0011 bez błędu (bonus: gate walidacji migracji).
- Wymóg certyfikacji #5 (E2E) i #6 (CI z playwright) spełnione.
