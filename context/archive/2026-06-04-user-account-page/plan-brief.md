# S-31 — Strona /account (profil użytkownika) — Plan Brief

> Full plan: `context/changes/user-account-page/plan.md`

## What & Why

Dać użytkownikowi jeden ekran `/account` do zarządzania kontem: edycja `display_name`,
zmiana emaila i hasła, podgląd zagregowanych kosztów vision (z S-30) i — jako placeholder —
sekcja kluczy API (którą wypełni S-32 BYOK). Profil to brakujące centrum: dane z S-30
(`/api/account/stats`) i przyszłe BYOK potrzebują shellu, w którym żyją.

## Starting Point

Plumbing w większości istnieje: `GET /api/account/stats` (S-30) działa i jest przetestowany,
ale **nie ma konsumenta UI**; `profiles.display_name` + RLS `profiles_update_own` gotowe;
wzorce strona+wyspa+middleware (default-protected) ustalone. Brakuje: strony `/account`,
endpointu `PATCH /api/account/profile` i wyspy spinającej całość.

## Desired End State

Zalogowany user wchodzi na `/account` z nawigacji i widzi pięć sekcji: edytowalny
display_name (optymistyczny zapis), zmianę emaila (z banerem re-confirmation), zmianę hasła
(nowe + powtórz), blok kosztów vision (grand total + rozbicie + liczby analiz) i placeholder
kluczy API z CTA „Dodaj klucz".

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Source |
| --- | --- | --- | --- |
| Kanał display_name | PATCH `/api/account/profile` (RLS update, F-02) | typowany envelope + mockowalny w testach | Roadmap / Plan |
| Kanał email/hasło | Browser `supabase.auth.updateUser()` | Supabase robi re-confirmation + sesję; wrapper nic nie wnosi | Roadmap / Plan |
| Sekcja kluczy API | Placeholder z CTA | S-31 = shell, S-32 = BYOK | Roadmap |
| display_name UX | Optymistyczny + rollback | niskie ryzyko, lepszy feel | Roadmap |
| Zmiana hasła | nowe + powtórz, min 6, bez current-password | session-based updateUser nie wymaga re-auth | Plan |
| Statystyki | konsumują istniejący `/api/account/stats` 1:1 | brak nowych agregatów | Plan |

## Scope

**In scope:** strona `/account`, `AccountIsland`, `PATCH /api/account/profile` + Zod schema,
zmiana email/hasła (browser auth), blok kosztów (z istniejącego stats), placeholder kluczy,
link nav, testy unit + e2e.

**Out of scope:** faktyczne klucze BYOK (S-32), toggle `ai_enabled` (S-26), usunięcie konta,
avatar, re-auth current-password, historia/miesięczne koszty.

## Architecture / Approach

`account.astro` (defense-in-depth redirect + SSR initial props) → `AccountIsland` (`client:load`)
z sekcjami. display_name przez własny PATCH endpoint (RLS-scoped `.update()`); email/hasło przez
`createBrowserSupabaseClient().auth.updateUser()`; koszty przez `fetch('/api/account/stats')`.
`/account` chronione automatycznie przez middleware (default-protected).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | `UpdateProfileSchema` + `PATCH /api/account/profile` + unit testy | mapping SQLSTATE → envelope (wzorzec shelves) |
| 2. Strona + stats + display_name | `account.astro`, `AccountIsland`, blok kosztów, placeholder kluczy, nav + testy | hydratacja/migotanie initial props; format małych kwot USD |
| 3. Credentials | zmiana email (baner re-confirm) + hasła (powtórz) + testy | e2e nie może mutować współdzielonego konta → mock `**/auth/v1/**` |

**Prerequisites:** S-01 (auth), S-30 (stats endpoint — done). Brak migracji DB.
**Estimated effort:** ~1 sesja, 3 fazy (3 atomic commity).

## Open Risks & Assumptions

- Email re-confirmation Supabase: zmiana nie jest natychmiastowa — UX musi to zakomunikować
  banerem, inaczej user myśli że nie zadziałało.
- E2E credentiali muszą mockować Supabase auth (`page.route`), by nie zepsuć współdzielonego
  konta testowego z `auth.setup.ts`.
- Manualna weryfikacja realnej zmiany hasła/emaila pozostaje user-only (Phase 2 i 3).

## Success Criteria (Summary)

- Użytkownik edytuje display_name i zmiana trzyma się po reloadzie.
- Widzi realne koszty vision na jednym ekranie (bez DevTools/DB).
- Zmienia hasło i loguje się nowym; zmiana emaila pokazuje baner potwierdzenia.
