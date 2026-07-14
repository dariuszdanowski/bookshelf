<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: AI book resolution przez BYOK openai_compatible provider

- **Plan**: `context/changes/resolution-openai-compatible-provider/plan.md`
- **Tryb**: Głęboki
- **Data**: 2026-07-14
- **Werdykt**: DO POPRAWY → wszystkie ustalenia naprawione w trakcie sortowania (fast-track auto-apply, LOW/MEDIUM impact)
- **Ustalenia**: 1 krytyczne, 3 ostrzeżenia, 1 obserwacja — wszystkie NAPRAWIONE

## Werdykty (przed poprawkami)

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | OSTRZEŻENIE |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | OSTRZEŻENIE |
| Martwe punkty | NIEZALICZONY |
| Kompletność planu | OSTRZEŻENIE |

## Ugruntowanie

8/8 ścieżek ✓, symbole ✓, brief↔plan ✓. Jedno rozbieżne twierdzenie znalezione podczas ugruntowania (F3, patrz niżej).

## Ustalenia

### F1 — Wymagane pole `provider` w AiResolutionProviderConfig zepsuje 8 istniejących testów

- **Waga**: ❌ KRYTYCZNE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 3.2 — `src/lib/resolution/client.ts`
- **Szczegóły**: Plan proponował `AiResolutionProviderConfig.provider` bez `?` (mirror `VisionProviderConfig`). `tests/unit/lib/resolution/client.test.ts:15` ma `const config = { apiKey: 'sk-test' }` (bez `provider`), użyte w 8 wywołaniach `resolveBookViaAI(query, config)`. Wymagane pole rozjeżdża typecheck na tych 8 testach.
- **Poprawka A ⭐ Zalecana**: `provider?: ...` opcjonalne, domyślnie `'anthropic'` w `resolveBookViaAI`. Zero zmian w 8 istniejących testach, zachowuje dotychczasowe anthropic-only zachowanie jako domyślne.
- **Decyzja**: NAPRAWIONE (Poprawka A) — plan.md § Faza 3.2 zaktualizowany.

### F2 — Statyczny label "AI (web search)" w BookModal/DetectionReview poza zakresem Fazy 4

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 4 — brakujący zakres
- **Szczegóły**: `BookModal.tsx:107` (`SOURCE_LABELS.ai_resolution = 'AI (web search)'`) renderowany trwale dla każdej książki tego source (pole DB, nie stan sesji) — mylące dla wyników z `openai_compatible`. `DetectionReview.tsx:983` busyLabel też miał "(web search)", nieujęte w oryginalnej liście linii Fazy 4.
- **Poprawka**: Provider-neutralny label (`'AI (automatyczne rozwiązanie)'`) + usunięcie "(web search)" z busyLabel.
- **Decyzja**: NAPRAWIONE — plan.md § Faza 4 rozszerzony o nowy punkt 4.3 (`BookModal.tsx`) + zaktualizowany punkt 4.2.

### F3 — Faza 1.2 błędnie zakłada że `resolution_calls` trzeba dopisać do database.types.ts od zera

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 1.2
- **Szczegóły**: `resolution_calls` już istnieje w `database.types.ts:436-495` (kompletny blok). Komentarz w `resolve.ts:95-98` (źródło błędnego założenia planu) jest nieaktualny.
- **Poprawka**: Faza 1.2 przepisana na „dodaj pole `provider` do istniejącego bloku"; Faza 3.3 dodaje usunięcie nieaktualnego komentarza.
- **Decyzja**: NAPRAWIONE — plan.md § Faza 1.2 i § Faza 3.3 zaktualizowane.

### F4 — Kryteria Fazy 4 i strategii testowania zakładają nieistniejące testy

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 4 kryteria sukcesu + § Strategia testowania
- **Szczegóły**: `tests/unit/pages/api/detections/resolve.test.ts` nie istnieje. `tests/unit/components/AccountIsland.test.tsx` istnieje ale nie testuje formularza kluczy. Plan mówił „jeśli istnieje... rozszerz" — nieprawda w obu przypadkach.
- **Poprawka**: Przeformułowano na „stwórz od zera" (resolve.test.ts) i „dodaj nową describe sekcję" (AccountIsland.test.tsx).
- **Decyzja**: NAPRAWIONE — plan.md § Strategia testowania i § Faza 4 kryteria zaktualizowane.

### F5 — AbortController+setTimeout to całkowicie nowy wzorzec w bazie kodu

- **Waga**: 👁️ OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Dopasowanie architektoniczne
- **Lokalizacja**: Faza 2.1, Faza 3.2 „Krytyczne szczegóły implementacji"
- **Szczegóły**: `AbortController` istnieje w repo tylko do cancel-on-unmount (`BookModal.tsx:615`, `PhotoPurchasePanel.tsx:34`); timeout-via-setTimeout-abort nie ma precedensu.
- **Poprawka**: Dopisano zdanie w „Krytycznych szczegółach implementacji" sygnalizujące brak precedensu.
- **Decyzja**: NAPRAWIONE — plan.md § Krytyczne szczegóły implementacji zaktualizowany.
