<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Jeden punkt wejścia do edycji detekcji

- **Plan**: context/changes/unify-detection-edit-entrypoint/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-07-15
- **Werdykt**: SOLIDNY (po poprawkach; DO POPRAWY przed sortowaniem)
- **Ustalenia**: 1 krytyczne, 2 ostrzeżenia, 1 obserwacja — wszystkie naprawione

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY (po F4) |
| Martwe punkty | ZALICZONY (po F1/F2/F3) |
| Kompletność planu | ZALICZONY |

## Ugruntowanie

8/8 ścieżek ✓ (DetectionReview.tsx, BookModal.tsx, candidate.ts, correct.ts, confirm.ts,
0001_initial_schema.sql, 0027_ai_book_resolution_substrate.sql,
context/archive/2026-06-06-unified-book-modal/plan.md), symbole zweryfikowane bezpośrednim
czytaniem (guardy handleSaveCandidate/doConfirmCandidate, wzorzec `ai-resolution:${detectionId}`
resolve.ts:238, wszystkie 3 mount-pointy BookModal), brief↔plan ✓.

## Ustalenia

### F1 — onCandidateSaved nie potrafi dodać świeżego draftu do lokalnej listy

- **Waga**: ❌ KRYTYCZNE
- **Wpływ**: 🔎 ŚREDNI
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 3 (3.1/3.2/3.3)
- **Szczegóły**: We wszystkich 3 mount-pointach `onCandidateSaved` robi czysty `.map()` bez
  gałęzi „dodaj gdy nie istnieje" — świeżo utworzony draft nigdy nie był w `detection.candidates`,
  więc po Zapisz bez natychmiastowego Zatwierdź karta dalej pokazuje „Brak matchu", a kolejny klik
  placeholdera tworzy DRUGI draft (pierwszy staje się niewidocznym śmieciem do przeładowania).
- **Poprawka**: Dopisano explicit append/map branch do Kontraktu Fazy 3.1 (+ referencja w 3.2/3.3)
  + nowy test w kryteriach sukcesu Fazy 3.
- **Decyzja**: NAPRAWIONE.

### F2 — Draft-wiersz chwilowo fałszuje agregaty "matched" w 2 endpointach

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI
- **Wymiar**: Martwe punkty
- **Szczegóły**: `shelves/[id]/photos.ts` i `unreject.ts` liczą „≥1 wiersz book_candidates =
  matched" bez filtra `source` — wąskie okno czasowe podczas otwartego modala.
- **Poprawka A ⭐**: Zaakceptować ryzyko jako nieistotne (wąskie okno, brak dowodu tła-odpytywania).
- **Decyzja**: NAPRAWIONE (Poprawka A) — udokumentowano w „Czego NIE robimy".

### F3 — Konkurencyjny rematch/refine może usunąć otwarty, niezapisany draft

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Martwe punkty
- **Szczegóły**: Nieskopowany `DELETE FROM book_candidates WHERE detection_id=X` w 5 endpointach
  może usunąć otwarty draft spod usera — kolejny PATCH dostanie 404 (jawny błąd, nie ciche
  uszkodzenie danych), ale plan tego nie wspominał.
- **Poprawka**: Dopisano notatkę do „Krytyczne szczegóły implementacji".
- **Decyzja**: NAPRAWIONE.

### F4 — Plan sugeruje istniejący precedens dla wzorca "draft-wiersz", którego nie ma

- **Waga**: 📝 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Dopasowanie architektoniczne
- **Szczegóły**: „wzorzec identyczny do ai-resolution:..." mylące — precedens dotyczy tylko
  konwencji nazewnictwa external_id, nie całego lifecycle'u draft-wiersza (nowy wzorzec w repo).
- **Poprawka**: Doprecyzowano zdanie w „Krytyczne szczegóły implementacji".
- **Decyzja**: NAPRAWIONE.

## Podsumowanie sortowania

Naprawiono: F1, F2 (Poprawka A), F3, F4 (4)

► Werdykt po poprawkach: **SOLIDNY** — plan gotowy do `/10x-implement`.
