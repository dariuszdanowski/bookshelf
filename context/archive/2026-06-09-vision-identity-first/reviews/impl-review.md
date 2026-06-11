<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-43 Vision Identity-First

- **Plan**: context/changes/vision-identity-first/plan.md
- **Scope**: Fazy 1–3 (pełny plan)
- **Date**: 2026-06-12
- **Verdict**: APPROVED (po naprawie F1)
- **Findings**: 0 critical · 1 warning (FIXED) · 1 observation (SKIPPED)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING → FIXED |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — handleAddMissedBook nie rozróżnia błędu rematch od "brak wyników"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realna różnica UX; warto przemyśleć
- **Dimension**: Safety & Quality
- **Location**: src/components/DetectionReview.tsx:2345–2358
- **Detail**: Gdy rematch zwraca błąd (429, NO_API_KEY, network), UI przechodziło do etapu
  review z pustą kartą bez żadnego komunikatu. Kontrast: handleRefine() jawnie sprawdza
  429/403. Design komentarz (l. 2355–2357) opisywał brak wyników, nie błąd sieciowy.
- **Fix**: Dodano explicit error handling przed setAddMissedDetection: 429 → „Rate limit",
  403+NO_API_KEY → „Brak klucza API", !ok → message z API. Wzorzec jak handleRefine().
  Poprawiono też typ `error?: { code?: string; message?: string }` w inline assertion.
- **Decision**: FIXED (chore commit)

### F2 — AddMissedBookForm ma pola publisher/isbn poza zakresem planu

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; oczywisty fix albo accept
- **Dimension**: Scope Discipline
- **Location**: src/components/DetectionReview.tsx:~1858–1943
- **Detail**: Formularz ma publisher i isbn — nie były w planie Phase 2, ale są przekazywane
  do rematch który je przyjmuje. Poprawiają jakość matchingu dla niszowych książek.
- **Decision**: SKIPPED (użyteczne, nieszkodliwe)

## Success Criteria

| Kryterium | Status |
|---|---|
| 990/990 unit testów | ✅ PASS |
| 183/183 E2E testów | ✅ PASS |
| lint / typecheck / build | ✅ PASS |
| PROMPT_VERSION === 'v7', brak bbox w VISION_SYSTEM_PROMPT | ✅ PASS |
| POST /detections: title-only, bbox-only, empty→400, invalid→400 | ✅ PASS |
| Smoke: detekcje bez bboxów, tytuły matchują, koszt < v6 (1.7) | ✅ user-verified |
| Add-missed → karta → Akceptuj → katalog (2.6) | ✅ user-verified |
| UX: karty główne, overlay CTA, brak wymaganego bbox (3.6) | ✅ user-verified |
| Smoke pełnego flow na koncie demo (3.7) | ✅ user-verified |
