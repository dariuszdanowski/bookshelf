# Refine UX — spójny label + info o koszcie (S-35) — Plan Brief

> Full plan: `context/changes/refine-ux-cost-info/plan.md`

## What & Why

Trzy przyciski refine w `DetectionReview.tsx` mają różne labele dla **tej samej** akcji („Spróbuj OCR"/„Doprecyzuj odczyt"/„Refine"), sugerując różne funkcje, ukrywają ostrzeżenie o słabym cropie w kolorze i nie informują, że refine to **dodatkowe płatne wywołanie AI**. Ujednolicamy do jednego komponentu z jednym labelem, czytelnym sygnałem weak-crop i widoczną informacją o koszcie.

## Starting Point

3 inline instancje `data-testid="refine-button"` z rozjeżdżającymi się labelami i 2× zduplikowaną logiką `classifyCropQuality`. Trzecia instancja (`:1230`) zawsze „Refine" bez sygnału weak-crop. Refine jest płatny (`REFINE_BUDGET_LIMITS`), koszt widoczny dopiero po fakcie w `CostPanel`.

## Desired End State

Wszystkie przyciski refine: jeden label „Doprecyzuj odczyt"; słaby crop → ⚠+amber+tooltip; obok każdego widoczny hint „dodatkowa analiza AI — płatne". Zero zmian API/zachowania.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Label | „Doprecyzuj odczyt" wszędzie | jedna akcja = jeden label |
| Weak crop | zostaje ⚠+amber+tooltip | sygnał wizualny OK, mylił tylko tekst |
| Info o koszcie | statyczny hint „płatne" | brak czystego per-refine estymatu → bez fałszywej precyzji |
| Dialog potwierdzenia | pomijamy | ⚠+tooltip+hint = świadoma zgoda; modal = friction |
| Struktura | ekstrakcja `RefineButton` | likwiduje 3 rozjeżdżające się kopie u źródła |

## Scope

**In scope:** `RefineButton` komponent, podmiana 3 instancji, hint kosztu, update testów.
**Out of scope:** API/zachowanie refine, dialog potwierdzenia, realny estymat kosztu, progi `classifyCropQuality`.

## Architecture / Approach

Jeden współdzielony `RefineButton({ bbox, busy, onClick, size })` w `DetectionReview.tsx` zastępuje 3 inline bloki. `data-testid` zachowany → selektory testów przeżyją.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Ujednolicenie | `RefineButton` + 3 podmiany + hint kosztu + testy | parytet wizualny per widok (size prop) |

**Prerequisites:** brak (frontend-only; hook M3L3 aktywny).
**Estimated effort:** ~1 sesja, 1 faza.

## Open Risks & Assumptions

- Parytet stylów per widok (różne paddingi) — `size` prop odwzorowuje istniejące klasy.
- `force-refine.spec.ts` może asertować stary tekst → update.

## Success Criteria (Summary)

- Spójny label „Doprecyzuj odczyt" we wszystkich 3 trybach review
- Widoczny hint kosztu przy każdym przycisku
- Słaby crop nadal sygnalizowany (⚠+amber+tooltip); cała suita zielona
