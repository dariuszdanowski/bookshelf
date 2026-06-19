<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Miniatura zdjęcia server-side

- **Plan**: context/changes/thumbnail-server-side/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-06-19
- **Werdykt**: DO POPRAWY → SOLIDNY (po auto-aplikacji F1–F5, Fast track)
- **Ustalenia**: 0 krytycznych, 2 ostrzeżenia, 3 obserwacje

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | OSTRZEŻENIE → naprawione (F1, F4, F5) |
| Kompletność planu | OSTRZEŻENIE → naprawione (F2, F3) |

## Ugruntowanie

8/8 ścieżek ✓, symbole (THUMB_MAX_EDGE/THUMB_JPEG_QUALITY/deriveWorkingCopy) ✓, brief↔plan ✓.
Kluczowy fakt z weryfikacji: `tests/e2e/media-pack.spec.ts` w całości mockuje `POST /api/photos/upload-file` (page.route ~L34), więc server-side photon nie wykonuje się w tym E2E.

## Ustalenia

### F1 — E2E mockuje upload-file → server-side miniatura nie pokryta automatami

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 2 #5 + Kryteria 2.3
- **Szczegóły**: `media-pack` fulfilluje upload-file mockiem; serwerowe generowanie miniatury nigdy się nie wykona w automatach. „E2E zielone" daje fałszywą pewność co do rdzenia zmiany.
- **Poprawka**: Doprecyzowano granicę pokrycia w Fazie 2 #5 — rdzeń pokrywają unit `deriveThumbnail` + ręczna weryfikacja Phase 1 (realny obiekt w storage); E2E weryfikuje tylko brak wywołania `upload-thumbnail`.
- **Decyzja**: NAPRAWIONE (auto, Fast track)

### F2 — Niewykonalna asercja „obiekt thumb istnieje" w zamockowanym specu

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 2 #5
- **Szczegóły**: Plan sugerował asercję istnienia `<path>.thumb.jpg`, ale upload-file jest mockowany (brak realnego zapisu).
- **Poprawka**: Przepisano cel #5: usunąć mock+licznik upload-thumbnail, zostawić uploadFileCallCount===1 i istniejące asercje renderu (osobny mock-route); NIE asercjonować istnienia obiektu thumb.
- **Decyzja**: NAPRAWIONE (auto, Fast track)

### F3 — Jednostki jakości JPEG (0.75 float vs 75 int photon)

- **Waga**: 🔵 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 1 #1 (kontrakt deriveThumbnail)
- **Szczegóły**: photon `get_bytes_jpeg` bierze int 1–100; plan pisał „~75 (= 0.75)". 0.75 → 0 = śmieci.
- **Poprawka**: Doprecyzowano kontrakt: int 75, nie 0.75.
- **Decyzja**: NAPRAWIONE (auto, Fast track)

### F4 — Transient double-generation w stanie „tylko Phase 1"

- **Waga**: 🔵 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Podejście / Faza 1
- **Szczegóły**: Serwer i klient oba zapisują `<path>.thumb.jpg` z upsert:false → duplikat → best-effort warn.
- **Poprawka**: Dodano notę: wdrażać obie fazy w jednym slice; warn oczekiwany przy manualnej weryfikacji Phase 1.
- **Decyzja**: NAPRAWIONE (auto, Fast track)

### F5 — Powierzchnia dekodowania photonu ≠ przeglądarka

- **Waga**: 🔵 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 1 #1 (unit test)
- **Szczegóły**: 1×1 grayscale JPEG nie dekoduje się (stąd test-shelf-rgb.jpg w E2E); photon ma inną powierzchnię dekodowania niż canvas. Potwierdza ryzyko HEIC.
- **Poprawka**: Nota: unit `deriveThumbnail` musi użyć fixture dekodowalnego przez photon; HEIC fallback już w planie.
- **Decyzja**: NAPRAWIONE (auto, Fast track)
