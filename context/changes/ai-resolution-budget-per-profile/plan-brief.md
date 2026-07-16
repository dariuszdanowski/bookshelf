# Limity budżetu AI-resolution per-profil — Krótki plan

> Pełny plan: `context/changes/ai-resolution-budget-per-profile/plan.md`

## Co i dlaczego

Dziś trzy limity budżetu AI-resolution (`maxCallsPerPhoto`, `maxCallsPerUserAction`,
`maxCallsPerDay`) to stałe globalne zaszyte w kodzie, identyczne dla każdego użytkownika.
Przenosimy dwa z nich na kolumny per-profil, edytowalne self-service na `/account` —
użytkownik zyskuje kontrolę nad własnym progiem, płacąc za AI-resolution z własnego klucza
(BYOK), więc to jego decyzja, nie ograniczenie aplikacji.

## Punkt wyjścia

`AI_RESOLUTION_BUDGET_LIMITS` (`src/lib/resolution/budgetPolicy.ts:4-8`) — stałe modułowe,
sprawdzane w `isAiResolutionBudgetAvailable` przed każdym wywołaniem AI-resolution
(`src/pages/api/detections/[id]/resolve.ts`). `maxCallsPerUserAction` jest dziś martwym
parametrem — zero call-site poza własną definicją, potwierdzone grepem.

## Pożądany stan końcowy

Sekcja "Limity AI-resolution" na `/account`: dwa pola liczbowe (limit dzienny, limit na
zdjęcie) z zapisem, przycisk "Przywróć domyślne", wskaźnik dzisiejszego zużycia i przycisk
resetu tego licznika (bez naruszania audytowej tabeli `resolution_calls`). Komunikat błędu 429
pokazuje realne liczby zamiast generycznego tekstu.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Które limity wystawić | Tylko `maxCallsPerPhoto` + `maxCallsPerDay` | `maxCallsPerUserAction` jest dziś martwy — wystawienie go myliłoby usera co do realnej kontroli | Plan |
| Endpoint zapisu | Rozszerz istniejący `PATCH /api/account/profile` | Jeden round-trip, spójne z dzisiejszym self-service wzorcem `display_name` | Plan |
| Granice Zod | Konserwatywne: 1-10 / 1-100 | Ochrona przed przypadkowym runaway (literówka/automatyzacja) przy sensownym zapasie | Plan |
| Wskaźnik zużycia | Tak, dodać "X/Y dzisiaj" | User widzi kontekst przed edycją limitu | Plan |
| Reset | Oba mechanizmy: przywróć domyślne (limity) + wyzeruj licznik (zużycie) | User chce pełną kontrolę nad obiema rzeczami | Plan |
| Komunikat 429 | Wzbogacić o realne liczby | To teraz własne ustawienie usera — powinien widzieć dokładnie jaki próg osiągnął | Plan |

## Zakres

**W zakresie:** kolumny `profiles` dla dwóch limitów + znacznika resetu, parametryzacja
`isAiResolutionBudgetAvailable`, rozszerzenie `PATCH /api/account/profile`, nowy `POST
/api/account/reset-resolution-usage`, nowa sekcja UI na `/account`, wzbogacony komunikat 429.

**Poza zakresem:** `maxCallsPerUserAction` (zostaje wewnętrzny), zmiany w `DetectionReview.tsx`
(nie są potrzebne), kasowanie/modyfikacja `resolution_calls`, wskaźnik zużycia "na zdjęcie".

## Architektura / Podejście

Cztery fazy od fundamentu w górę: DB + czysta logika budżetu (testowalna w izolacji) →
backend API → UI → E2E. Reset dziennego licznika to okno czasowe (`max(dzisiejsza północ UTC,
reset_at)`), nie kasowanie danych — samo-czyści się następnego dnia bez joba/TTL.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Fundament DB + logika | Migracja 0032, typy, `isAiResolutionBudgetAvailable` z parametrem, `effectiveDailyWindowStart` | Ręczna edycja `database.types.ts` (commitowany plik, nie regenerowany) |
| 2. Backend API | Partial-update profilu, nowy endpoint resetu, `resolve.ts` z per-profilowymi limitami | Fallback `??` musi chronić dzisiejszy mock w `resolve.test.ts` przed cichym zablokowaniem budżetu |
| 3. UI `/account` | Nowa sekcja z 2 polami, przywróć domyślne, wskaźnik zużycia, reset | Nowe propsy `AccountIsland` muszą być opcjonalne — 16 istniejących testów ich nie przekazuje |
| 4. E2E + weryfikacja | Rozszerzony `account.spec.ts`, pełny przebieg automatów, ręczny smoke | — |

**Wymagania wstępne:** brak (self-contained, niezależne od Propozycji 1/`ai-resolution-search-tool`).
**Szacowany nakład pracy:** ~1 sesja w 4 fazach (małe, dobrze sprecedensowane zmiany w każdej).

## Otwarte ryzyka i założenia

- CHECK constraint (`23514`) w praktyce nie powinien być nigdy trafiony (Zod blokuje wcześniej)
  — to czyste defense-in-depth, niepotwierdzone dodatkowym testem integracyjnym z żywą DB.
- Lokalny stack Supabase bywa niedostępny z Windows (AV-block, zob. memory) — migracja 0032
  będzie realnie zwalidowana dopiero w CI (`supabase start`) lub po `db push` na prod po merge.

## Kryteria sukcesu (podsumowanie)

- User zmienia własny limit dzienny/per-zdjęcie na `/account`, wartość persystuje.
- Po wyczerpaniu obniżonego limitu, błąd 429 pokazuje realne liczby.
- "Przywróć domyślne" i "Wyzeruj licznik" działają zgodnie z opisem, bez naruszania
  `resolution_calls`.
