<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Domyślna półka przy "dodaj zdjęcie"

- **Plan**: context/changes/fix-add-photo-default-shelf/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-07-12
- **Werdykt**: SOLIDNY (po zastosowanych poprawkach)
- **Ustalenia**: 0 krytycznych, 2 ostrzeżenia, 2 obserwacje — wszystkie naprawione inline; dodatkowo user rozszerzył zakres o trzecie miejsce (PhotoListIsland.tsx) w trakcie przeglądu

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY (po poprawce F2) |
| Martwe punkty | ZALICZONY |
| Kompletność planu | ZALICZONY (po poprawkach F1, F3, F4) |

## Ugruntowanie

Grounding: 5/5 paths ✓ (Layout.astro, MobileNav.tsx, PhotoUploader.tsx, shelves/[id].astro, upload.astro), brief↔plan ✓

## Ustalenia

### F1 — Plan nie wymieniał innych `/upload` linków w bazie kodu

- **Waga**: 📝 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Analiza stanu obecnego
- **Szczegóły**: Subagent znalazł 5 dodatkowych miejsc linkujących do `/upload` niewymienionych w planie: `AddPurchaseIsland.tsx:87`, `photos/[id].astro:61` (już poprawne), `CatalogSearchIsland.tsx:419`, `PhotoListIsland.tsx:333`, `ShelvesIsland.tsx:121` (gołe). Plan nie stwierdzał explicite które są out-of-scope i dlaczego.
- **Fix**: Dodano jawną listę z uzasadnieniem per-plik do „Analiza stanu obecnego" + „Czego NIE robimy".
- **Decyzja**: NAPRAWIONE (inline)

### F2 — Duplikacja regexu UUID między Layout.astro i MobileNav.tsx

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — poprawka oczywista i wąska
- **Wymiar**: Dopasowanie architektoniczne
- **Lokalizacja**: Podejście do implementacji
- **Szczegóły**: Oryginalny plan kazał pisać ten sam regex UUID inline w obu plikach. `src/lib/http/response.ts` już eksportuje `UUID_REGEX`/`parseUuidParam` (zero importów, bezpieczny do `.astro` frontmatter, już używany w `upload.astro:5`).
- **Fix**: `Layout.astro` derywuje `currentShelfId` raz server-side (reużywa `parseUuidParam`), przekazuje jako prop do `MobileNav` — `MobileNav.tsx` nie pisze własnego regexu.
- **Decyzja**: NAPRAWIONE (inline)

### F3 — Niejasny kontrakt zmiany w MobileNav.tsx (statyczna tablica LINKS_AFTER)

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Wymagane zmiany #2
- **Szczegóły**: `LINKS_AFTER` to statyczna `as const` tablica mapowana generycznie — plan nie precyzował, jak dać jednemu wpisowi dynamiczny href bez przepisywania całego mapowania.
- **Fix**: Kontrakt doprecyzowany — specjalne potraktowanie wpisu `/upload` wewnątrz `.map()` (`l.href === '/upload' && currentShelfId ? ... : l.href`), reszta tablicy bez zmian.
- **Decyzja**: NAPRAWIONE (inline)

### F4 — Brak precyzji co do lokalizacji nowych testów E2E

- **Waga**: 📝 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Kryteria sukcesu
- **Szczegóły**: Plan mówił ogólnie „nowy/rozszerzony test E2E" bez wskazania pliku. Subagent znalazł: brak istniejącego testu sterującego `nav-upload`/`mobile-nav-upload` (nowe pokrycie), ale `add-purchase-flow.spec.ts:82-90` ma dokładnie pasującą konwencję (`getByTestId(...).toHaveAttribute('href', ...)`, prawdziwe shelf-id z SSR).
- **Fix**: Wskazano konkretne pliki (`mobile-responsive.spec.ts` dla mobile, `upload-flow.spec.ts` dla desktop) + konwencję do naśladowania.
- **Decyzja**: NAPRAWIONE (inline)

### F5 — Rozszerzenie zakresu: PhotoListIsland.tsx (zgłoszone przez usera)

- **Waga**: N/A (nie ustalenie recenzenta — rozszerzenie zakresu od usera w trakcie przeglądu)
- **Szczegóły**: User zgłosił, że link „Wgraj pierwsze →" w widoku zdjęć półki (`PhotoListIsland.tsx:333`) też linkuje do gołego `/upload`, mimo że komponent ma `shelfId` jako prop. Zweryfikowano: to trzeci, prawdziwy przypadek tego samego buga — najprostszy z trzech (czysta interpolacja, zero regexu). Zweryfikowano też, że dwa pozostałe gołe linki (`CatalogSearchIsland.tsx:419`, `ShelvesIsland.tsx:121`) faktycznie nie mają dostępnego kontekstu konkretnej półki i słusznie zostają poza zakresem.
- **Decyzja**: DODANE DO ZAKRESU (Faza 1, Wymagana zmiana #3)
