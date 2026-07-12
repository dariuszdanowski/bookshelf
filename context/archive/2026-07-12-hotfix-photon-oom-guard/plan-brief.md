# Hotfix: Photon OOM guard w pipeline zdjęć — Krótki plan

> Pełny plan: `context/changes/hotfix-photon-oom-guard/plan.md`

## Co i dlaczego

Produkcja zwraca sporadycznie `Error 1102` (Worker exceeded resource limits). Potwierdzona przyczyna: `deriveWorkingCopy` (`process.ts`) i `deriveDetectionCrop` (`refine.ts`) dekodują pełny bufor zdjęcia przez Photon WASM bez guarda rozmiaru wejścia — duże zdjęcie przekracza limit pamięci Workera (128MB) i crashuje izolat zamiast rzucić catchable exception, omijając istniejący `try/catch`. Analogiczny guard już istnieje dla ścieżki miniatury (`upload-file.ts`, `THUMB_MAX_INPUT_BYTES=8MB`), ale nie na hot path.

## Punkt wyjścia

Trzy funkcje Photon (`deriveWorkingCopy`, `deriveThumbnail`, `deriveDetectionCrop`) w `src/lib/images/{resize,crop}.ts` — tylko jedna ma guard, i to na zewnątrz (w wywołującym), nie w środku. Limit uploadu 15MB (zduplikowany w 3 miejscach) jest niespójny z bezpiecznym progiem 8MB, który sam kod już udowodnił.

## Pożądany stan końcowy

Zdjęcie >8MB nigdy nie trafia do Photon WASM w żadnym z trzech miejsc — rzucany jest czytelny, catchable błąd PL obsługiwany przez już istniejące ścieżki error-handlingu. Upload odrzuca pliki >8MB od razu (klient + serwer) — brak „martwych uploadów".

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Próg bezpieczeństwa | 8MB | Już zwalidowany w kodzie (`THUMB_MAX_INPUT_BYTES`) | Plan |
| Miejsce guardu | Wewnątrz derive-funkcji, nie w call site'ach | Nie da się ominąć przez przyszłe wywołania | Plan |
| Shared constant | Nowy `src/lib/images/limits.ts`, bez importu photon | `resize.ts`/`crop.ts` ciągną workerd-only `@cf-wasm/photon`; klient (`PhotoUploader.tsx`) potrzebuje czystego modułu | Plan |
| Limit uploadu | 15MB → 8MB end-to-end | Eliminuje „upload OK, processing zawsze fail" | Plan (user-approved) |
| `CoverEditor.tsx` (okładki) | Poza zakresem | Upload browser→Supabase Storage bezpośrednio, nigdy nie dotyka Photon | Plan |

## Zakres

**W zakresie:**
- Guard rozmiaru w `deriveWorkingCopy`, `deriveThumbnail`, `deriveDetectionCrop`
- Nowy `src/lib/images/limits.ts` (shared constant)
- Obniżenie `MAX_FILE_SIZE_BYTES` 15MB→8MB w `upload-file.ts` + `PhotoUploader.tsx`
- Testy jednostkowe guardu (resize.test.ts rozszerzony + nowy crop.test.ts)

**Poza zakresem:**
- `CoverEditor.tsx` / okładki książek (osobna ścieżka, nie dotyka Photon)
- Włączenie Workers Paid plan (decyzja billingowa, osobny temat)
- Dokładniejsza heurystyka (parsowanie wymiarów z nagłówka JPEG bez pełnego dekodu)

## Architektura / Podejście

Guard żyje na granicy niskopoziomowej funkcji (wewnątrz `resize.ts`/`crop.ts`, przed `PhotonImage.new_from_byteslice`), nie w wywołujących endpointach — więc żaden przyszły call site nie może go ominąć. Jeden nowy plik stałych (`limits.ts`, bez importu photon) współdzielony przez serwer i klient.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Guard w derive-funkcjach | Zamyka realny crash — 3 miejsca chronione + testy | Guard musi rzucić PRZED WASM decode, inaczej nie chroni |
| 2. Wyrównanie limitu uploadu | Spójny limit 8MB end-to-end, zero duplikatów | `limits.ts` musi być bundlowalny do client bez ciągnięcia photon |

**Wymagania wstępne:** brak (samodzielny hotfix, nie zależy od innych zmian)
**Szacowany nakład pracy:** ~1 sesja, 2 małe fazy

## Otwarte ryzyka i założenia

- Zakładamy, że 8MB pozostaje bezpieczne dla wszystkich realnych zdjęć telefonów (już zwalidowane w produkcji dla ścieżki miniatury).
- Osobny, niepotwierdzony jeszcze burst `exceededResources` z cpuTime dokładnie 10ms wskazuje na Workers Free plan (brak aktywnej subskrypcji Paid) — adresowane osobno przez użytkownika via dashboard, nie częścią tego planu.

## Kryteria sukcesu (podsumowanie)

- Upload zdjęcia >8MB kończy się czytelnym komunikatem, nie crashem.
- Pełny flow (upload → miniatura → vision → detekcje) działa bez regresji dla zdjęć w granicach nowego limitu.
- Cały automated test suite (unit + typecheck + lint + build + e2e) zielony.
