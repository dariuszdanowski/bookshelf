# S-47: Admin — flaga is_technical — Plan Brief

> Full plan: `context/changes/admin-technical-account-flag/plan.md`

## What & Why

Zastępujemy heurystykę klasyfikacji kont technicznych (email-prefix + `book_count===0 && !display_name`) niezawodnym sygnałem DB-level: kolumną `profiles.is_technical`. Admin zarządza flagą przez toggle w panelu; `isAutomatic()` zwraca wyłącznie `user.is_technical`.

## Starting Point

`AdminUsersIsland.tsx` zawiera `TECHNICAL_EMAIL_PREFIXES` i dwu-kryteriowy `isAutomatic()`. `UserAdminDTO` nie ma pola `is_technical`. Wzorzec `ai_enabled` toggle (`ai-enabled.ts` + kolumna AI w tabeli) jest gotowym szablonem do skopiowania.

## Desired End State

Panel admina ma nową kolumnę „Tech" z checkboxem (jak AI). Istniejące konta e2e- mają `is_technical=true` po backfill w migracji. Filtr „Ukryj konta automatyczne" działa wyłącznie na podstawie flagi DB.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego |
|---|---|---|
| isAutomatic() po migracji | Tylko `user.is_technical` | Jeden sygnał DB-level, zero heurystyki |
| Fallback book_count===0 | Usunięty | Real user po rejestracji bez książek nie jest kontem automatycznym |
| Zakres togglea | Wszystkie wiersze (jak AI) | Spójność z wzorcem ai_enabled |
| Backfill | Tylko email-prefix, nie book_count | Ostrożność — nie backfillujemy potencjalnie realnych kont |

## Scope

**In scope:**
- Migracja `0025_profiles_is_technical.sql` z backfillem email-prefix
- Rozszerzenie `UserAdminDTO` + GET endpoint
- Nowy `PATCH /api/admin/users/[id]/technical`
- UI toggle + uproszczony `isAutomatic()`
- E2E testy toggle + filtrowanie

**Out of scope:**
- Auto-ustawianie flagi przy rejestracji na podstawie emaila
- RLS na `is_technical`
- Migracja `book_count===0` kont

## Architecture / Approach

Kopia wzorca `ai_enabled`: nowy endpoint `technical.ts` = `ai-enabled.ts` z zamienionym polem. UI: nowy state `togglingTechnicalId`, handler `handleToggleTechnical`, kolumna th/td „Tech" między istniejącymi kolumnami.

## Phases at a Glance

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Migracja + backend | Kolumna DB + backfill + endpoint | Backfill JOIN z auth.users w migracji |
| 2. Frontend + E2E | Toggle UI + uproszczony isAutomatic() + testy | Brak — czysty refactor + wzorzec z AI |

**Prerequisites:** Lokalny stack WSL dla `supabase migration up` (lub bezpośrednio przez `db push` post-merge)
**Estimated effort:** ~1 sesja, 2 fazy

## Open Risks & Assumptions

- Backfill `UPDATE profiles ... FROM auth.users` — Postgres migration ma dostęp do schematu `auth` (założenie: tak, potwierdzony wzorzec w `0003_handle_new_user.sql`)

## Success Criteria (Summary)

- Konta e2e- mają `is_technical=true` po backfill i są domyślnie ukryte w panelu
- Admin może togglować flagę przez UI; zmiana persystuje
- Konto z `book_count=0` i `is_technical=false` NIE jest ukrywane (fallback usunięty)
