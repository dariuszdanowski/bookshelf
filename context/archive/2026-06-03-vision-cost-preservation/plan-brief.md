# Zachowanie kosztów vision przy DELETE (S-30) — Plan Brief

> Full plan: `context/changes/vision-cost-preservation/plan.md`

## What & Why

Koszty vision/refine znikają nieodwracalnie przy usunięciu zdjęcia (wszystkie FK `ON DELETE CASCADE`). S-29 (photos-crud DELETE) nie może wejść bez zachowania tej historii. Zmieniamy FK na `SET NULL`, dodajemy `user_id` do `vision_runs` (agregacja niezależna od `photos`) i endpoint `GET /api/account/stats`.

## Starting Point

`vision_runs` (RLS przez join do photos, brak user_id, photo_id CASCADE); `refine_calls` (ma user_id, ale photo_id + detection_id CASCADE). Trzy ścieżki kasowania kosztu przy DELETE photo. `costs.ts` agreguje per-photo i ma precedens `as any` na nową kolumnę.

## Desired End State

DELETE zdjęcia zostawia rekordy kosztów (`photo_id`/`detection_id = NULL`, `cost_usd` + `user_id` zachowane). `GET /api/account/stats` → łączne koszty/liczby per user, RLS-respecting.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| vision_runs cost survival | +user_id denorm + RLS na user_id + photo_id SET NULL | join do photos przestaje działać po photo_id=NULL | Plan |
| refine_calls | photo_id ORAZ detection_id SET NULL | photo→detection cascade też kasuje refine_call | Plan (ext. roadmapy) |
| Typy nowej kolumny | `(locals.supabase as any)` | precedens costs.ts:38, regen po db push | Plan |
| Response shape | total_vision/refine_cost_usd + counts | roadmap S-30 | Roadmap |
| Walidacja migracji | post-merge db push | lokalny stack AV-blocked | Plan (lessons) |

## Scope

**In scope:** migracja 0014 (FK SET NULL ×3, vision_runs.user_id + backfill + RLS), endpoint stats + unit test.
**Out of scope:** DELETE zdjęcia (S-29), UI statystyk (S-31), soft-delete / osobna tabela log.

## Architecture / Approach

Phase 1: migracja `0014`. Phase 2: `GET /api/account/stats` (RLS-respecting, `as any` na vision_runs.user_id) + mock unit test. Migracja realnie walidowana dopiero `db push` po merge.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migracja 0014 | FK SET NULL + user_id + RLS na user_id | nazwy constraintów FK (drop/recreate); migracja niewalidowalna in-branch |
| 2. Endpoint stats | GET /api/account/stats + test | chicken-egg typów (as any) |

**Prerequisites:** brak (branch od main; hook M3L3). Odblokowuje S-29.
**Estimated effort:** ~1 sesja, 2 fazy.

## Open Risks & Assumptions

- Migracja walidowana realnie dopiero post-merge `db push` (lessons.md — generated columns/FK nie złapie Vitest).
- FK drop/recreate wymaga poprawnych nazw constraintów (`<table>_<col>_fkey`).
- `as any` na vision_runs.user_id do czasu regen `database.types.ts` po db push.

## Success Criteria (Summary)

- DELETE photo zostawia rekordy kosztów z NULL photo_id (post-merge weryfikacja)
- `GET /api/account/stats` zwraca poprawne sumy/liczby (unit + post-merge)
- lint/typecheck/test zielone; migracja `db push` bez błędu
