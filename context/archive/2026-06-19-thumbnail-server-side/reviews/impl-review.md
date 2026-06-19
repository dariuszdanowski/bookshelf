<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Miniatura zdjęcia server-side

- **Plan**: context/changes/thumbnail-server-side/plan.md
- **Zakres**: Faza 1+2 z 2 (pełny plan)
- **Data**: 2026-06-19
- **Werdykt**: ZAAKCEPTOWANY
- **Ustalenia**: 0 krytycznych, 1 ostrzeżenie, 3 obserwacje

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność z planem | PASS |
| Dyscyplina zakresu | WARNING |
| Bezpieczeństwo i jakość | PASS |
| Architektura | PASS |
| Spójność wzorców | PASS |
| Kryteria sukcesu | PASS |

## Kryteria sukcesu (automaty)

- Typecheck (`npm run typecheck`): PASS — 0 błędów (warningi to pre-existujące deprecje zod, niezwiązane).
- Lint (`npm run lint`): PASS — czysto.
- Unit (dotknięte obszary: images + api/photos + api/shelves): PASS — 180/180.
- Build (`npm run build`): PASS — server built 17.35s.
- Grep `browserThumb|makeThumbnailBlob|upload-thumbnail` w `src/`: czysto (jedyny match = komentarz historyczny `exif.ts:3`).
- E2E (`media-pack` + regresje): user-verified lokalnie (cad1781) — nieuruchamiane w tym przeglądzie (koszt/local stack).
- Weryfikacja ręczna (desktop + telefon HTTP LAN): user-only, odhaczone w planie (1.5/1.6, 2.5).

## Ustalenia

### F1 — Faza 1 spakowała kod produkcyjny spoza planu (EXIF + proxy serwowania)

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąsko zakrojona
- **Wymiar**: Dyscyplina zakresu
- **Lokalizacja**: commit c9d3f6a — src/lib/images/exif.ts (nowy), src/pages/api/photos/[id]/image.ts, src/pages/api/shelves/[id]/photos.ts
- **Szczegóły**: Plan Fazy 1 obejmował tylko resize.ts + upload-file.ts. Commit dorzucił moduł EXIF (realnie konsumowany przez deriveThumbnail) + zmiany endpointów proxy serwowania (`?thumb=1`, koncepcyjnie należące do vision-schema-photo-proxy). Kod poprawny i bezpieczny; narusza atomic-commit-per-faza (touched-set only), utrudnia traceability plan↔diff.
- **Poprawka**: Dopisać aneks o odkrytym zakresie do plan.md + change.md.
- **Decyzja**: FIXED — aneks dodany do plan.md (§ Aneks — odkryty zakres) i change.md.

### F2 — deriveThumbnail wykracza poza kontrakt planu (orientacja EXIF)

- **Ważność**: 🔭 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Zgodność z planem
- **Lokalizacja**: src/lib/images/resize.ts:59-82
- **Szczegóły**: Plan opisywał deriveThumbnail jako czysty resize→JPEG; implementacja dodatkowo czyta i przepisuje tag EXIF orientation (uzasadnione: photon nie obraca pikseli; rotate psuje obraz). Udokumentowane w kodzie.
- **Poprawka**: brak — pokryte aneksem z F1.
- **Decyzja**: SKIPPED (pokryte przez F1).

### F3 — Niezacommitowane, niepowiązane zmiany w drzewie roboczym

- **Ważność**: 🔭 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Dyscyplina zakresu
- **Lokalizacja**: src/lib/middleware/handler.ts, tests/e2e/screenshots.spec.ts (uncommitted w czasie przeglądu)
- **Szczegóły**: Drzewo robocze miało niezacommitowane zmiany niepowiązane z thumbnailem (per-request access-log /api/* w middleware + zmiana katalogu wyjściowego screenshotów). Ryzyko wjechania do PR thumbnaila.
- **Poprawka**: Zacommitować osobno.
- **Decyzja**: FIXED — dwa osobne atomowe commity: c6868d2 (feat(middleware): access-log /api/*) + 91f148e (test(screenshots): scratch output dir). Lefthook eslint+prettier zielone.

### F4 — exif.ts: odczyt wartości orientacji ignoruje pole typu TIFF

- **Ważność**: 🔭 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: src/lib/images/exif.ts:108
- **Szczegóły**: parseTiffOrientation czyta orientację jako u16 zakładając typ SHORT inline, bez sprawdzenia pola typu wpisu. W praktyce Orientation to zawsze SHORT; błędny odczyt degraduje się łagodnie do 1 (brak rotacji).
- **Poprawka**: brak wymagana; opcjonalnie assert type==3 (SHORT).
- **Decyzja**: SKIPPED (akceptowalne — bezpieczna degradacja).

## Podsumowanie triage

- Naprawiono: F1 (aneks plan.md/change.md), F3 (2 osobne commity c6868d2 + 91f148e)
- Pominięto: F2 (pokryte F1), F4 (bezpieczna degradacja)
