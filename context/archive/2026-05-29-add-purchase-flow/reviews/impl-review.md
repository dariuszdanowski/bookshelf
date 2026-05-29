<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Add Purchase Flow (S-06)

- **Plan**: context/changes/add-purchase-flow/plan.md
- **Scope**: Pełny plan (Fazy 1–4)
- **Date**: 2026-05-29
- **Mode**: Fast track (self-review, Opus; auto-apply recommended)
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria
Automated: typecheck 0, lint clean, build complete, vitest 402/402, E2E 24/24 (2 skipped integration-gated). Manual (Studio purchase_date, dev ≤90s smoke) deferred post-merge.

## Plan Adherence
Wszystkie planowane pliki dostarczone zgodnie z kontraktem: migracja 0010, AddPurchaseSchema, getPurchasedShelfId helper, POST /api/books (rollback proaktywnie z S-05 F1), AddPurchaseIsland + /purchase + header CTA + upload ?shelf= preset, E2E. Zero drift.

## Safety & Quality
- shelf_id derywowany server-side (`getPurchasedShelfId`, RLS-scoped) — nie z body. Plus 0009 RLS pokrywa shelf_id ownership (defense-in-depth). ✓
- Rollback orphan-book przy porażce shelf_entries (lekcja S-05 F1 zaaplikowana od razu). ✓
- Pattern compliance: apiResponse/apiError, Zod+flattenError, console.error{name,message,code}, prerender=false, 401 guard, 23505→409, .strict() schema. ✓

## Findings (observations — nie blokujące, zgodne z planem)

### F1 — purchase_date w UTC (edge przy północy)
- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW
- **Location**: src/pages/api/books/index.ts (`new Date().toISOString().slice(0,10)`) + AddPurchaseIsland todayISO
- **Detail**: Default „dziś" liczony w UTC; user PL blisko północy może dostać datę o dzień wcześniejszą. Akceptowalne — data zakupu jest przybliżona, a form pre-fill pozwala poprawić. Cloudflare Worker runtime = UTC, brak czystego local-tz server-side.
- **Decision**: ACCEPTED (MVP — przybliżona data)

### F2 — manual entry bez ISBN może tworzyć duplikaty
- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW
- **Location**: src/pages/api/books/index.ts
- **Detail**: Dup-guard działa po isbn_13; ręczny zakup zwykle bez ISBN → brak unique → powtórne dodanie tego samego tytułu tworzy duplikat. Tak samo jak S-05 (świadome — user explicite dodaje zakup).
- **Decision**: ACCEPTED (spójne z S-05)

### F3 — nested select shelfHint połyka error
- **Severity**: ℹ️ OBSERVATION · **Impact**: 🏃 LOW
- **Location**: src/pages/api/books/index.ts (dup pre-check `.select('id, shelf_entries(shelves(name))')`)
- **Detail**: Nie destrukturyzuje error (jak S-05 F6) — fail-safe: 23505 backstop łapie duplikat, traci tylko shelfHint. Nie blokujące.
- **Decision**: ACCEPTED (spójne z S-05 F6)

## Podsumowanie
APPROVED. Slice reużywa zahartowanych wzorców S-05; 3 obserwacje to świadome MVP-edge zgodne z planem (purchase_date display, photo-path date, Flow B telemetria — w „What we're NOT doing"). Brak findings wymagających zmiany kodu.
