# Usunięcie blokady AI-resolution per-zdjęcie + licznik prób — Krótki plan

> Pełny plan: `context/changes/ai-resolution-per-photo-reset/plan.md`

## Co i dlaczego

Poprzedni slice (`ai-resolution-budget-per-profile`) wprowadził limit AI-resolution "na zdjęcie"
liczony all-time, bez żadnego okna czasowego ani mechanizmu resetu — odkryte podczas manualnej
weryfikacji jako permanentna, nieodwracalna blokada. Właściciel repo zdecydował: usunąć blokadę
per-zdjęcie całkowicie (zostaje wyłącznie dzienny limit), ale zachować widoczność liczby prób
AI-resolution dla danego zdjęcia — informacyjnie, bez wpływu na dostępność funkcji.

## Punkt wyjścia

Dziś `POST /api/detections/[id]/resolve` blokuje, gdy WYCZERPANY jest dzienny LUB per-zdjęciowy
limit (ten drugi liczony na zawsze, bez resetu). `/account` ma konfigurowalne pole "Limit na
zdjęcie" (`profiles.ai_resolution_max_calls_per_photo`, migracja `0032`). Nic w aplikacji nie
pokazuje liczby prób AI-resolution per zdjęcie.

## Pożądany stan końcowy

AI-resolution blokuje WYŁĄCZNIE na podstawie dziennego limitu. `/account` nie ma już pola "Limit
na zdjęcie". Widok zdjęcia pokazuje informacyjnie "Próby AI-resolution dla tego zdjęcia: N",
obok istniejącego panelu akcji zdjęcia (`vision-run-panel`).

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Blokada per-zdjęcie | Usunięta całkowicie | Nieodwracalna, permanentna blokada bez resetu — decyzja właściciela repo | Plan |
| Konfiguracja "Limit na zdjęcie" | Usunięta całkowicie (DROP COLUMN) | Martwa konfiguracja po usunięciu blokady wprowadzałaby w błąd | Plan |
| Licznik prób | Informacyjny, bez blokady, w widoku zdjęcia | Dokładnie to, o co poprosił właściciel repo | Plan |
| Gdzie licznik | Poziom zdjęcia (`vision-run-panel`), nie per-detekcja | `photoId` tam natywnie dostępny; liczba jest per-zdjęcie, nie per-detekcja | Plan |
| Endpoint dla licznika | Rozszerzenie istniejącego GET /api/photos/[id] | Wzorzec `costs_total_usd` już istnieje — zero nowego endpointu | Plan |

## Zakres

**W zakresie:**
- Migracja `0033` (DROP COLUMN + CHECK z `profiles`)
- Uproszczenie `budgetPolicy.ts`/`resolve.ts` do samego dziennego limitu
- Usunięcie pola "Limit na zdjęcie" z `/account` (schema, endpoint, UI)
- Nowy informacyjny licznik prób w `GET /api/photos/[id]` + `DetectionReview.tsx`

**Poza zakresem:**
- Zmiany dziennego limitu/mechanizmu resetu (bez zmian)
- `maxCallsPerUserAction` (martwy parametr, poza zakresem)
- Jakikolwiek przycisk/akcja przy liczniku prób — czysto informacyjny

## Architektura / Podejście

Cztery fazy odwracające część poprzedniego slice'a (DB → backend → UI → E2E), plus mały,
doklejony kawałek nowej funkcjonalności (licznik prób) korzystający z istniejącego wzorca
best-effort dekoracyjnego pola (`costs_total_usd`).

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. DB + logika budżetu | Migracja 0033, uproszczony `budgetPolicy.ts` | Brak — mechaniczne usunięcie |
| 2. Backend API | `resolve.ts` bez per-photo gate, nowy `resolution_attempts_count` w GET photos | Zgodność testów mockujących stary kształt profilu |
| 3. UI | Usunięte pole /account, licznik prób w widoku zdjęcia | Miejsce licznika musi być czytelne, nie mylące z limitem |
| 4. E2E + weryfikacja | Zaktualizowane testy, pełny smoke | — |

**Wymagania wstępne:** PR #171 zmergowany do main (spełnione).
**Szacowany nakład pracy:** ~1 sesja w 4 fazach — głównie usuwanie kodu + jeden nowy, mały
kawałek UI.

## Otwarte ryzyka i założenia

- `DROP COLUMN` jest nieodwracalny — akceptowalne, bo dane w tej kolumnie nic już nie znaczą po
  usunięciu blokady w tej samej fazie.

## Kryteria sukcesu (podsumowanie)

- AI-resolution nigdy nie blokuje z powodu liczby prób na konkretnym zdjęciu (tylko dzienny limit)
- `/account` nie pokazuje już pola "Limit na zdjęcie"
- Widok zdjęcia pokazuje liczbę dotychczasowych prób AI-resolution dla tego zdjęcia
