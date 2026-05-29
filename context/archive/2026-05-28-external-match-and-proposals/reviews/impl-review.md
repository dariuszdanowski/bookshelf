<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-04 external-match-and-proposals

- **Plan**: context/changes/external-match-and-proposals/plan.md
- **Scope**: Phase 1–3 of 3 (full plan) — git range `ef7645e..f21838a`
- **Date**: 2026-05-29
- **Verdict**: NEEDS ATTENTION → triaged (4 fixed, 2 skipped)
- **Findings**: 1 critical · 2 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (18/18 plan items MATCH, zero drift) |
| Scope Discipline | PASS (granica S-04/S-05 zachowana; brak zapisów do books/shelf_entries) |
| Safety & Quality | FAIL (F1 critical secrets w worktree + F2 WASM leak) → oba FIXED |
| Architecture | PASS (framework-agnostic libs honored; F5 minor) |
| Pattern Consistency | WARNING (F5 googleBooks coupling, F6 logging verbosity) |
| Success Criteria | WARNING (S-04 own criteria green @SHA; branch HEAD lint red — F3) → FIXED |

## Re-weryfikacja (HEAD, po fixach)
- typecheck: 0 errors/warnings/hints ✓
- lint: 0 errors ✓ (po F1/F3 fix)
- vitest: 278/278 (30 plików) ✓
- build: nie re-run live; zielony @SHA 5eaacb5 + WASM spike GATE potwierdził bundling photon

## Obserwacje procesowe (nie-findings)
- Faza 1 + Faza 2 zlane w jeden commit `a2026cc` (CLAUDE.md: „atomic commit per faza"). Potwierdza to `f21838a` — `@cf-wasm/photon` zapomniany w package.json podczas p1, dorzucony osobno.
- Niezacommitowana zmiana w PhotoUploader.tsx (match-only retry) — sensowne usprawnienie, ale poza zakresem S-04, untested + uncommitted.
- Manual criteria (1.9–1.11, 2.9–2.11, 3.7–3.9) pozostają `[ ]` — user-only smoke (zgodnie z regułą).

## Findings

### F1 — Realne sekrety prod poza .gitignore

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .gitignore:151 (.dev.vars.remote.bak, .dev.vars.local w working tree)
- **Detail**: `.gitignore` łapał tylko `.dev.vars`, nie warianty `.dev.vars.*`. Pliki .bak/.local zawierają komplet realnych sekretów prod (CLOUDFLARE_API_TOKEN, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, SUPABASE_DB_PASSWORD…). `git add -A` (używany w workflow) by je zacommitował. Stan worktree, niezależny od kodu S-04, ale żywy/pilny. Pliki były untracked i nigdy nie commitowane — rotacja niekonieczna.
- **Fix**: Zmieniono `.dev.vars` → `.dev.vars*` w .gitignore. Zweryfikowano `git check-ignore` (3/3 ignored), nic nie staged.
- **Decision**: FIXED

### F2 — photon .free() tylko na happy-path → leak WASM

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/images/resize.ts:16-30
- **Detail**: `image.free()`/`resized.free()` po `get_bytes_jpeg()`. Throw w `new_from_byteslice`/`resize`/`get_bytes_jpeg` (uszkodzony obraz) → PhotonImage nie zwolniony → leak pamięci WASM (limit Worker 128MB). Failure mode oznaczony w planie jako ryzyko.
- **Fix**: Owinięto `deriveWorkingCopy` w `try { … } finally { image?.free(); resized?.free(); }`. 6/6 testów resize zielone.
- **Decision**: FIXED

### F3 — Lint RED na HEAD brancha (verify-phase3.mjs)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: verify-phase3.mjs (root)
- **Detail**: `npm run lint` na HEAD = 26 errorów (no-undef: fetch/console/process/setTimeout). Źródło: verify-phase3.mjs — skrypt-artefakt sesyjny zacommitowany w PÓŹNIEJSZEJ zmianie shelf-photo-pipeline-ui (46ed831), NIE w S-04. Własne criterion S-04 „Lint zielony" było zielone @SHA 5eaacb5. Blokuje CI na PR brancha.
- **Fix**: Dodano `verify-phase3.mjs` do `ignores` w eslint.config.mjs; lint zielony.
- **Follow-up**: artefakt należy do shelf-photo-pipeline-ui — przy zamykaniu tamtej zmiany zdecydować `git rm` vs zostawić.
- **Decision**: FIXED

### F4 — match.ts: niesprawdzony .error przy update status='matched'

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Reliability
- **Location**: src/pages/api/photos/[id]/match.ts (persist loop)
- **Detail**: Update detections→'matched' nie sprawdzał `.error`, a `matchedCount` inkrementowany niezależnie → odpowiedź mogła raportować sukces mimo nieudanego flipa. (match.ts modyfikowany też w shelf-photo-pipeline-ui — scope częściowo niejednoznaczny.)
- **Fix**: Przechwycono `statusError`; `matchedCount++` tylko przy braku błędu; raportowany status = `det.status` gdy update padł (kandydaci już w DB → zostają w odpowiedzi); log błędu po whitelist. 13/13 testów match zielone.
- **Decision**: FIXED

### F5 — googleBooks.ts łamie framework-agnostic books/

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/lib/books/googleBooks.ts:2
- **Detail**: Importuje `cloudflare:workers` na poziomie modułu — jedyny plik w books/ sprzężony z runtime (plan: framework-agnostic). Fallback `env?.X ?? import.meta.env.X` + stub w vitest utrzymują testowalność, więc działa; siblingi czyste.
- **Fix**: Opcjonalnie przekaż apiKey jako param do searchGoogleBooks().
- **Decision**: SKIPPED (fallback działa; refaktor to kosmetyka, niski priorytet)

### F6 — Pełny raw response LLM logowany do Worker logs

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Security
- **Location**: src/lib/vision/client.ts:73
- **Detail**: `console.log('[vision:raw-response]', text)` loguje pełny tekst odpowiedzi modelu (treść tytułów książek usera). Nie wyciek sekretu (klucze nie logowane, obraz tylko .length), ale verbose w prod.
- **Fix**: Gate za flagą debug albo usuń full-text log przed prod.
- **Decision**: SKIPPED (pomocne w debugu MVP, brak wycieku sekretów)
