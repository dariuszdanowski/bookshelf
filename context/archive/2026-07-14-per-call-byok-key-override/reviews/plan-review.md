<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Per-call BYOK key override

- **Plan**: context/changes/per-call-byok-key-override/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-07-14
- **Werdykt**: DO POPRAWY
- **Ustalenia**: 0 krytycznych, 2 ostrzeżenia, 0 obserwacji

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | OSTRZEŻENIE |
| Martwe punkty | ZALICZONY |
| Kompletność planu | OSTRZEŻENIE |

## Grounding
13/13 ścieżek ✓, 3/3 symboli ✓, brief↔plan ✓

## Ustalenia

### F1 — "Jeden useApiKeys()" nie uwzględnia że refine/resolve i rerun-vision żyją w różnych zasięgach komponentu

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔬 WYSOKI — stawka architektoniczna; pomyśl dokładnie przed podjęciem decyzji
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 3, punkt 1-2
- **Szczegóły**: `activeProviderIsAnthropic` (DetectionReview.tsx:785) żyje wewnątrz `useDetectionDecision` (:750), wołanego z `DetectionCard` (instancjonowanego raz na detekcję). `activeKeyInfo` (:2593) żyje w top-level `DetectionReview` (:2574). Plan zakłada jedno wywołanie `useApiKeys()` bez rozstrzygnięcia tej różnicy zasięgu; `selectedKeyId` (pkt 2) dziedziczy ten sam problem.
- **Poprawka A ⭐ Recommended**: Wywołaj `useApiKeys()` niezależnie w obu zasięgach (raz w `useDetectionDecision`, raz w top-level `DetectionReview`).
  - Siła: Zero prop-drillingu; mirror dzisiejszego, już-działającego splitu (2 niezależne fetche w tych samych 2 miejscach).
  - Kompromis: Redundantny fetch przy wielu otwartych kartach (drobne, dziś akceptowane).
  - Pewność: WYSOKA — dokładnie odzwierciedla dzisiejszy split.
  - Martwy punkt: Brak istotnych.
- **Poprawka B**: Podnieś `useApiKeys()` do top-level, przekaż przez `DetectionCardProps`.
  - Siła: Jedno źródło prawdy, zero redundantnych fetchy.
  - Kompromis: Rozszerza `DetectionCardProps` i wszystkie miejsca instancjonujące `DetectionCard` — większa powierzchnia zmiany.
  - Pewność: ŚREDNIA — koszt prop-drillingu nieoszacowany.
  - Martwy punkt: Ile miejsc instancjonuje `DetectionCard` nieznane.
- **Decyzja**: Naprawiono za pomocą poprawki A

### F2 — `useApiKeys.ts` w `src/lib/keys/` narusza istniejącą konwencję lokalizacji hooków React

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąsko zakrojona
- **Wymiar**: Dopasowanie architektoniczne
- **Lokalizacja**: Faza 2, punkt 2
- **Szczegóły**: Jedyny dziś istniejący custom hook (`useBodyScrollLock`) żyje w `src/components/`, nie `src/lib/`. `src/lib/<domain>/` to konwencja Zod schema + server/shared helpers.
- **Fix**: Przenieś `useApiKeys` do `src/components/useApiKeys.ts`.
- **Decyzja**: Naprawiono
