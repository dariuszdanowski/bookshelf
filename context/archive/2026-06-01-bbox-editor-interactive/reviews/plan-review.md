<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Interaktywny edytor bbox

- **Plan**: `context/changes/bbox-editor-interactive/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-01
- **Verdict**: REVISE
- **Findings**: 1 critical · 1 warning · 1 observation

## Verdicts

| Dimension | Verdict |
|---|---|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

5/5 paths ✓ · symbols ✓ (`classifyCropQuality` exported + already imported in Overlay, `NormalizedBbox` exported, `raw_title` nullable confirmed, `vision_run_id NOT NULL` z RLS SELECT przez photo_id JOIN potwierdzone) · brief↔plan ✓

Weryfikacja sub-agent (kluczowe claims):
- RLS `vision_runs` SELECT: `vision_runs_select_own` policy przez `EXISTS(photos WHERE photo_id AND user_id = auth.uid())` — bezpieczne.
- RLS `detections` INSERT: `WITH CHECK EXISTS(photos WHERE photo_id AND user_id)` — cudzy photo_id daje `42501`, nie cichy fail.
- `raw_title text` — nullable (brak NOT NULL w 0001), pusty string `''` dozwolony.
- `BboxCoords`/`BboxEditSet` additive do `schema.ts` — 8 importerów; żaden nie używa `import *`; zmiana bezpieczna.

## Findings

### F1 — Phase 2 body ma manual item nieobecny w Progress

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Manual Verification + Progress Phase 2
- **Detail**: Bullet „Ramki po Apply pokrywają się z grzbietami (rozsądna tolerancja kliknięć)." istnieje w Phase 2 body ale NIE w Progress Phase 2 (Progress kończy się na 2.7). Naruszenie reguły Progress↔Phase — każdy Success Criteria bullet musi mieć matching `- [ ] N.M`. Dodatkowo item jest logicznie błędnie umieszczony: Apply implementowany w Phase 3, nie Phase 2; Phase 3 items 3.5/3.6 pokrywają ten aspekt.
- **Fix**: Usuń bullet z Phase 2 „Manual Verification" body. (Żadnych nowych itemów nie trzeba dodawać — Phase 3 już to pokrywa.)
- **Decision**: PENDING

---

### F2 — Apply flow: ścieżka wyjścia z edit mode przy błędzie nieokreślona

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 § Edit mode toolbar + Phase 3 § handler w DetectionReview
- **Detail**: Plan mówi „woła `await onApplyEdits(changes)`, wychodzi z edit mode" — sugeruje wyjście TYLKO na sukces. Dwa nieokreślone scenariusze: (A) `onApplyEdits` rzuca — Overlay zostaje w edit mode; (B) `Promise.allSettled` zwraca partial success — accumulator zawiera już wykonane operacje, ponowny Apply zduplikuje sukces lub użytkownik nie wie co się nie udało.
- **Fix A ⭐ Recommended**: Zawsze wychodź z edit mode po `await` przez `finally`, niezależnie od wyniku; resetuj accumulator po Apply (sukces lub błąd). Błędy raportuj jako Review-level `errorMsg`.
  - Strength: Przewidywalne UX — stan zawsze czysty; pasuje do wzorca `bulk-confirm` (linia ~1207 w DetectionReview).
  - Tradeoff: Użytkownik traci wizualny ślad co się nie udało — patrzy na errorMsg.
  - Confidence: HIGH — `Promise.allSettled` + `finally setIsBboxEditing(false)` to standardowy wzorzec.
  - Blind spot: Żaden.
- **Fix B**: Wychodź z edit mode tylko przy pełnym sukcesie; przy błędzie zostań z podświetlonymi nieudanymi operacjami.
  - Strength: Użytkownik widzi co się nie udało.
  - Tradeoff: Wymaga dodatkowego stanu „failed ops" w Overlay; duplikaty przy retry nie są trywialne.
  - Confidence: LOW — żaden precedens w codebase.
  - Blind spot: reject jest trwały — nie da się cofnąć sukcesu.
- **Decision**: PENDING

---

### F3 — Anuluj nie przywraca zoom level sprzed edit mode

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 § Edit mode toolbar + zoom reset
- **Detail**: Plan resetuje `scale` do 1 przy wejściu w edit mode. Anuluj wychodzi ale nie przywraca poprzedniego scale. User przy zoom 3× wchodzi w edit, kliknie Anuluj — wraca do 1×.
- **Fix**: Zapisz `prevScale = scale` przed wejściem w edit mode; przywróć `setScale(prevScale)` przy Anuluj. (Apply nie wymaga przywrócenia — i tak odświeża widok.)
- **Decision**: PENDING
