---
change_id: ai-resolution-per-photo-reset
title: Usunięcie blokady AI-resolution per-zdjęcie + informacyjny licznik prób
status: implementing
created: 2026-07-17
updated: 2026-07-17
archived_at: null
---

## Notes

Odkryte podczas ręcznej weryfikacji `ai-resolution-budget-per-profile` (PR #171, zmergowany
2026-07-17). `POST /api/detections/[id]/resolve` liczy per-photo budget jako **all-time**
count na `resolution_calls.photo_id` (`src/pages/api/detections/[id]/resolve.ts:130-133`) —
bez żadnego okna czasowego, w przeciwieństwie do dziennego licznika, który używa
`effectiveDailyWindowStart`. „Wyzeruj dzisiejszy licznik" na `/account` resetuje wyłącznie
dzienne okno (`ai_resolution_daily_reset_at`) — per-photo counter nie ma dziś ŻADNEGO
mechanizmu resetu, nigdzie w aplikacji (ani na `/account`, ani w widoku
zdjęcia/detekcji). Jedyny dostępny workaround: podniesienie profilowego
`ai_resolution_max_calls_per_photo` (max 10, CHECK constraint) powyżej historycznego
count dla danego zdjęcia — ale to permanentnie podnosi limit dla WSZYSTKICH zdjęć usera,
nie resetuje konkretnego zdjęcia.

`ai-resolution-budget-per-profile` świadomie wykluczył wskaźnik/reset "na zdjęcie" z
`/account` ("ma sens tylko w kontekście konkretnego zdjęcia... nie na stronie ustawień
profilu") — ale odpowiadający mechanizm w widoku zdjęcia/detekcji nigdy nie powstał.
To realna luka do zaadresowania, nie regresja tamtego planu (plan zrobił dokładnie to, co
zaplanował — zob. `context/changes/ai-resolution-budget-per-profile/reviews/impl-review.md`).

Do rozstrzygnięcia podczas `/10x-plan`: (a) dodać dedykowany reset per-zdjęcie (gdzie? w
widoku detekcji/zdjęcia — analogicznie do resetu dziennego, ale scoped do `photo_id`), (b)
związać per-photo count z oknem czasowym (np. też dziennym lub własnym), albo (c) jakaś
kombinacja. Referencje: `src/lib/resolution/budgetPolicy.ts` (`effectiveDailyWindowStart`),
`src/pages/api/account/reset-resolution-usage.ts` (precedens akcji resetu), `resolution_calls`
zostaje append-only (twardy invariant z poprzedniego planu — nie kasować wierszy).
