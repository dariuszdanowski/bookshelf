<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Limity budżetu AI-resolution per-profil

- **Plan**: context/changes/ai-resolution-budget-per-profile/plan.md
- **Zakres**: Wszystkie 4 fazy
- **Data**: 2026-07-17
- **Werdykt**: WYMAGA UWAGI (0 krytycznych, oba ostrzeżenia naprawione)
- **Ustalenia**: 0 krytycznych, 2 ostrzeżenia, 1 obserwacja

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność z planem | PASS |
| Dyscyplina zakresu | PASS |
| Bezpieczeństwo i jakość | WARNING (naprawione) |
| Architektura | PASS |
| Spójność wzorców | WARNING (naprawione) |
| Kryteria sukcesu | WARNING (2 pozycje ręczne otwarte — świadomie odroczone) |

## Ustalenia

### F1 — Wyścig: "Przywróć domyślne" może zostać cicho nadpisane przez trwający "Zapisz"

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość (Niezawodność)
- **Lokalizacja**: src/components/AccountIsland.tsx:637-643 (przycisk), :190-247 (handlery)
- **Szczegóły**: Przycisk "Przywróć domyślne" nie miał `disabled={limitsSaving}` (w przeciwieństwie do "Zapisz" i "Wyzeruj licznik"). User mógł kliknąć "Zapisz" (PATCH w locie), potem "Przywróć domyślne" — odpowiedź PATCH cicho nadpisywała przywrócone wartości.
- **Poprawka**: Dodano `disabled={limitsSaving}` do przycisku "Przywróć domyślne".
- **Decyzja**: NAPRAWIONE

### F2 — Nowy test E2E trwale mutuje stan współdzielonego konta bez sprzątania

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Spójność wzorców (izolacja testów)
- **Lokalizacja**: tests/e2e/account.spec.ts:166-184
- **Szczegóły**: Test „Wyzeruj dzisiejszy licznik" woła realny POST, ustawiając `ai_resolution_daily_reset_at = now()` na współdzielonym koncie testowym — trwale, bez akcji odwracającej i bez komentarza dokumentującego to (w przeciwieństwie do sąsiedniego testu, który explicite sprząta). Brak endpointu „cofnij reset" — pełne sprzątanie niemożliwe, ale efekt nieszkodliwy (samo-czyści się o północy UTC, żaden inny spec nie zależy od realnego stanu `resolution_calls` tego konta).
- **Poprawka**: Dodano komentarz dokumentujący świadomie zaakceptowany brak sprzątania.
- **Decyzja**: NAPRAWIONE

### F3 — resolve.ts nadal cicho połyka błąd początkowego SELECT profilu (pre-existing)

- **Ważność**: OBSERWACJA
- **Wymiar**: Niezawodność (poza zakresem tego planu)
- **Lokalizacja**: src/pages/api/detections/[id]/resolve.ts:53-66
- **Szczegóły**: `error` z zapytania `profiles.select()` jest odrzucany — transientny błąd DB wygląda jak "AI wyłączone" (403) zamiast 500. Zachowanie sprzed tej zmiany (potwierdzone diffem), teraz trzy dodatkowe pola budżetu też zależą od tego samego nieobserwowanego zapytania.
- **Poprawka**: Brak akcji w tym slice — kandydat do przyszłego hardeningu.
- **Decyzja**: ZAAKCEPTOWANE (pre-existing, poza zakresem)

## Kryteria sukcesu

Wszystkie automaty zielone: lint, typecheck, 1280 testów jednostkowych, 8/8 `account.spec.ts` E2E, build. Pełna suita E2E lokalnie ma 37 pre-existing failures w plikach niezwiązanych z tym slice'em (bbox/purchase/refine) — walidacja pełnej suity odroczona do CI (efemeryczny stack), zgodnie z kontraktem Fazy 4.

Dwie pozycje ręczne pozostają otwarte (4.6 pełny smoke wizualny na /account, 4.7 429 z realnymi liczbami w DetectionReview) — świadomie odroczone przez użytkownika po przerwaniu sesji podczas pełnego przebiegu E2E lokalnie. Nie są release-blocking; do wykonania przy najbliższej okazji.
