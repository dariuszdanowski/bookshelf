<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Panel administracyjny (S-26)

- **Plan**: context/changes/admin-panel/plan.md
- **Mode**: Quick (re-review po triage deep review z 2026-06-12; tamte 4 findingi F1–F4: wszystkie FIXED)
- **Date**: 2026-06-12
- **Verdict**: REVISE → SOUND (po auto-apply wszystkich fixów; Fast track)
- **Findings**: 2 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL (→ PASS po fixach) |

## Grounding

8/8 ścieżek ✓ | AI_DISABLED w unii ✓, ADMIN_REQUIRED brak (zgodnie z planem) ✓ | guard ai_enabled w process.ts:74 ✓ (markery "ALREADY DONE" poprawne) | deleted_at NIE w database.types.ts ✓ | max migracja origin/main = 0022 → 0023 wolny ✓ | brief↔plan ✗ (F3 — naprawione)

## Findings

### F1 — `gen types --linked` regeneruje typy z PROD, który nie ma migracji 0023

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix oczywisty i wąski
- **Dimension**: Plan Completeness
- **Location**: Phase 2, item 0 — Implementation note
- **Detail**: Nota kazała uruchomić lokalne `db reset`, ale potem `gen types --linked` — flaga linked generuje typy ze zdalnego (prod) projektu, a 0023 trafia na prod dopiero po merge (deploy.yml, lessons § Branch per change). Wynik: `deleted_at` nadal nieobecny w database.types.ts → typecheck Phase 2 pada — dokładnie ten bloker, który fix F1 z deep review miał usunąć.
- **Fix**: `npx supabase gen types typescript --local` (w WSL, na lokalnym stacku po db reset) — NIE `--linked`.
- **Decision**: FIXED — Implementation note Phase 2 item 0 poprawiona na `--local` z ostrzeżeniem przed `--linked`.

### F2 — Progress↔Phase mismatch: 2 bullety Manual bez checkboxów + rozjazd Phase 2 Automated

- **Severity**: ❌ CRITICAL (kontrakt mechaniczny /10x-implement)
- **Impact**: 🏃 LOW — quick decision; fix oczywisty i wąski
- **Dimension**: Plan Completeness
- **Location**: ## Progress vs Phase 2/3 Success Criteria
- **Detail**: (a) Phase 2 Manual: 3 bullety vs Progress 2.4–2.5 (brak checkboxa "soft-deleted z badge"); (b) Phase 3 Manual: 4 bullety vs Progress 3.4–3.6 (brak "soft-deleted nadal widoczny"); (c) Phase 2 Automated: osobne bullety unit/E2E vs zbiorcze 2.3.
- **Fix**: Dodać checkboxy 2.6 i 3.7; scalić bullety unit/E2E w body Phase 2 do kształtu 2.3.
- **Decision**: FIXED — dodano 2.6 i 3.7 w Progress; bullety unit+E2E w Phase 2 Success Criteria scalone.

### F3 — Stale referencje migracji 0023 po przeniesieniu do Phase 2 (niekompletny fix F1 z deep review)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix oczywisty i wąski
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Overview, Migration Notes, What We're NOT Doing, plan-brief.md
- **Detail**: Migracja żyje w Phase 2 item 0, ale Phase 3 Overview nadal otwierał się od "Migracja 0023…"; Migration Notes mówiły "Phase 1+2: zero migracji / Phase 3: 0023"; What We're NOT Doing odsyłało do "(Phase 3)"; plan-brief.md miał migrację w wierszu Phase 3 i guard ai_enabled jako pracę Phase 1 (już istnieje w kodzie).
- **Fix**: Wyrównać wszystkie cztery miejsca do stanu po fixie F1 z deep review.
- **Decision**: FIXED — Phase 3 Overview, Migration Notes, What We're NOT Doing oraz plan-brief.md (tabela faz + Files Touched: 7/5/4 plików) wyrównane.

### F4 — Endpointy delete/impersonate nie sprawdzają is_admin TARGETU (ochrona tylko w UI)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix oczywisty i wąski
- **Dimension**: Blind Spots
- **Location**: Phase 3, items 1–2
- **Detail**: Island ukrywa przyciski dla wierszy is_admin, ale kontrakty endpointów miały tylko self-check — bezpośredni POST pozwalał adminowi soft-delete'ować lub impersonować innego admina. Repo ma filozofię triple-guard; ochrona wyłącznie kliencka jest wbrew wzorcowi.
- **Fix**: W obu endpointach przy fetchu profilu targetu sprawdzić też `is_admin` → 400 VALIDATION_ERROR (defense-in-depth).
- **Decision**: FIXED — kontrakty impersonate i delete rozszerzone o `profiles.select('deleted_at, is_admin')` + target-admin check → 400.

### F5 — E2E admin.spec.ts: brak mechanizmu provisioningu admina i usera-celu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Testing Strategy — Integration Tests (E2E)
- **Detail**: E2E używa jednej współdzielonej sesji (1 signup/run, storageState). admin.spec.ts wymaga (a) usera z is_admin=true — nie do ustawienia przez UI/anon API, (b) drugiego usera-celu dla toggle/delete (testy destrukcyjne nie mogą zjadać shared session usera). Plan milczał jak to zapewnić — kryteria 2.3/3.3 niewykonywalne bez tej decyzji.
- **Fix ⭐ Recommended**: Dedykowany setup step wg wzorca `auth.teardown.ts` (SUPABASE_SERVICE_ROLE_KEY w env test-runnera): service-role client flipuje is_admin=true na userze sesji + tworzy usera-cel przez admin API; testy destrukcyjne operują wyłącznie na userze-celu.
  - Strength: Wzorzec już w repo (auth.teardown.ts); działa lokalnie (WSL .dev.vars) i w CI (efemeryczna Supabase).
  - Tradeoff: admin.spec.ts zależny od service-role key w env.
  - Confidence: HIGH — teardown już dziś używa tego klucza.
  - Blind spot: Kolejność projektów Playwright (setup → admin.spec) do potwierdzenia przy implementacji.
- **Decision**: FIXED — Testing Strategy rozszerzona o sekcję "Provisioning fixture admina".

### F6 — Impersonacja: "nowa karta" vs same-tab redirect; sesja admina ginie tak czy inaczej

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix oczywisty i wąski
- **Dimension**: Blind Spots
- **Location**: Phase 3, item 1 (intent) vs item 3 (kontrakt)
- **Detail**: Intent mówił "zalogowany w nowej karcie", kontrakt island'a robi `window.location.href` (ta sama karta). Niezależnie od karty magic link podmienia sesję w całej przeglądarce (wspólny cookie jar) — admin traci własną sesję; powrót przez ponowny login. Plan tego nie nazywał wprost.
- **Fix**: Ujednolicić wording (same-tab) + nota "powrót do panelu = ponowne logowanie; akceptowane w MVP".
- **Decision**: FIXED — intent item 1 przepisany: same-tab redirect + wyjaśnienie cookie jar + nota o powrocie.
