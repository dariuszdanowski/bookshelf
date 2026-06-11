---
change_id: vision-identity-first
title: "S-43: Pivot pipeline vision na identity-first (rozpoznanie > lokalizacja)"
status: impl_reviewed
created: 2026-06-09
updated: 2026-06-12
---

## Kontekst

Bezpośrednia kontynuacja decyzji zamykającej S-40 (`bbox-quality-validation`,
2026-06-09): zmierzono twardo (realny API Sonnet, N=3), że współrzędne bbox z promptu
są **wrodzenie zawodne** — klastrowanie `y2`, afiniczna deformacja X zależna od AR,
wysoka wariancja run-to-run; prompt+thinking nie ruszają biasu. Test `bbox-identity-test.mjs`
pokazał, że prompt **bez** bbox czyta ≥ równie dobrze (recall 04: 83→89%, 02: 90→95%)
i jest 30–46% tańszy.

Wartość produktu = **JAKIE książki są na zdjęciu**, nie gdzie dokładnie. Match (Google
Books) i dedup nie używają pikseli — operują wyłącznie na `raw_title`/`raw_author`.

## Decyzje kontraktowe (forki rozstrzygnięte przez usera, 2026-06-09)

- **Zakres `kind`**: tylko książki w tym slice; wsparcie gier odłożone do osobnego
  przyszłego slice'u. → brak pola `kind`, brak migracji.
- **Lokalizacja**: czysta identyfikacja — główny prompt NIE zwraca współrzędnych;
  kolejność = `position_index`; karty „potwierdź" to UI; bbox tylko gdy user ręcznie
  narysuje (tryb naprawczy).

## Outcome

Główny pipeline vision zwraca listę `{position, title, author, confidence, spine_color}`
bez współrzędnych; review-UX oparty o karty „potwierdź" z kandydatami match; bbox-editor
zdegradowany do opcjonalnego narzędzia naprawczego (rysowanie/lokalizacja na żądanie),
a „dodaj pominiętą książkę" działa przez wpis tytułu bez rysowania boxa. KPI: title-recall
+ precyzja + czas review (nie IoU). Plan: [plan.md](plan.md), brief: [plan-brief.md](plan-brief.md).
