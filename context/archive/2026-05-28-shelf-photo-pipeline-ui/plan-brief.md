# Shelf photo pipeline UI — Plan Brief

> Full plan: `context/changes/shelf-photo-pipeline-ui/plan.md`

## What & Why

Zastępujemy „ślepą rurę" upload→auto-process→auto-match→redirect transparentnym modelem pipeline'u z manualnymi triggerami per stage. Dzisiejsze UI nie pokazuje stanu zdjęcia po reloadzie, nie pozwala wznowić pojedynczego kroku po awarii (np. 429 z Google Books), i traci historię wyników vision przy re-process. Po zmianie użytkownik wchodzi w `/shelves/[id]`, widzi listę swoich zdjęć ze stage badge, miniaturkami i przyciskami do uruchomienia/ponowienia każdego kroku osobno; każdy vision run zostaje w historii (otwiera drogę do porównań modeli i agregacji recallu).

## Starting Point

Dzisiaj `/upload` (PhotoUploader.tsx) auto-uruchamia łańcuch upload→process→match→redirect bez persystencji stanu UI. `/photos/[id]` jest read-only review. **Nie ma** endpointu listy zdjęć per półka ani strony `/shelves/[id]`. `POST /api/photos/[id]/process` robi `DELETE FROM detections WHERE photo_id` przed insertem — re-process kasuje historię. Roadmap S-14 `photo-process-reload-recovery` i S-15 `review-page-nav-entry` (oba `proposed`) są wchłonięte przez tę zmianę.

## Desired End State

Użytkownik wchodzi w `/shelves/[id]` z linka w `ShelfListItem`, widzi listę zdjęć (najnowsze pierwsze) z miniaturkami i jednym z 4 stage badge'y (`uploaded` / `vision_done` / `match_done` / `confirmed`). Per-row akcje zależne od stage'a: „Uruchom vision" / „Ponów vision (nowy run)" z confirm / „Uruchom match" / „Ponów match" / „Otwórz review". Klik akcji wywołuje konkretny endpoint, refetch listy odświeża stan in-place. Concurrent double-click jest blokowany na poziomie DB triggera → 409 CONFLICT. Historic vision_runs zostają w DB; UI default pokazuje detekcje z najnowszego succeeded run. `/upload` zachowuje obecne auto-run zachowanie (zero regression dla golden path).

## Key Decisions Made

| Decyzja                              | Wybór                                                                                  | Why                                                                                            | Source |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| Entry point listy zdjęć              | Nowa strona `/shelves/[id]`                                                            | Naturalny URL pattern, miejsce na przyszłe rozszerzenia, deep-link działa.                     | Plan   |
| Auto-run vs manual                   | Auto-run zostaje default na `/upload`; manual triggers w `/shelves/[id]` jako recovery | Zero regressions golden path; manual to pure-additive surface naprawcza.                        | Plan   |
| Wiersz zdjęcia                       | Thumbnail + badge + liczniki + przyciski akcji                                          | Jeden klik daje pełną sytuację; thumbnail rozpoznaje zdjęcie wzrokowo.                          | Plan   |
| Liczba stage'y                       | 4 (uploaded → vision_done → match_done → confirmed)                                     | Odpowiada faktycznym tabelom DB; przygotowuje grunt pod S-05 (confirm).                         | Plan   |
| Wersjonowanie vision runs            | Nowa tabela `vision_runs` + FK `detections.vision_run_id`                              | Czysta historia, model-agnostic, otwiera bramę dla compare/merge w future, MVP UI = latest only. | Plan   |
| Re-match po nowym vision run         | Per-detection delete-then-insert w obrębie najnowszego succeeded run                    | Spójne z aktualną semantyką match; brak overhead'u match_runs (Google tani).                    | Plan   |
| Concurrency lock                     | DB trigger `prevent_concurrent_vision_run` (5-min window) + 409 CONFLICT w endpoincie  | Triple guard (UI + endpoint + DB); brak race condition nawet przy bug.                          | Plan   |
| Stuck recovery                       | Manual przycisk „Ponów" — reset do uploaded + retry                                     | Transparentnie, user ma kontrolę; superseduje roadmap S-14.                                     | Plan   |

## Scope

**In scope:**
- Migracja DB: `vision_runs` + `detections.vision_run_id` + RLS + trigger + backfill
- Rozszerzenie `ApiErrorCode` o `CONFLICT`
- Refactor `POST /api/photos/[id]/process` na append-only versioning
- Refactor `POST /api/photos/[id]/match` na run-scoped
- Update `GET /api/photos/[id]` na latest-succeeded-run-aware + zwrot vision_run metadata
- Nowy endpoint `GET /api/shelves/[id]/photos` z stage derivation + signed URL thumbnails
- Nowa strona `/shelves/[id].astro` + komponent `PhotoListIsland`
- Augmented `DetectionReview` (badge run metadata + przyciski Ponów vision/match)
- Link „Zobacz zdjęcia →" w `ShelfListItem`
- Po archive: aktualizacja roadmap.md (S-14, S-15 → done with supersession note)

**Out of scope:**
- UI do przeglądu historii vision runów / side-by-side compare / merge
- `match_runs` table (full audit match'y)
- Auto-reaper stuck runs (background job)
- `?vision_run_id=` query na GET endpoincie (explicit run selection)
- Drop kolumn `photos.vision_model/cost/latency` (zostają jako cache)
- Auto/manual toggle na `/upload`
- Inline confirm detections do katalogu (S-05)
- Real-time updates (SSE/WebSocket)
- Dedicated confirm modal component (MVP używa `window.confirm`)

## Architecture / Approach

Trzy atomic phases. Po Phase 1 (DB) istniejący kod nadal przechodzi testy z nowym schematem. Po Phase 2 (API) `/upload` golden path działa end-to-end z append-only versioning. Phase 3 dodaje nowy widok bez ruszania `/upload`.

State machine (4 stages, derived z DB):

```
uploaded  →  vision_done  →  match_done  →  confirmed
(brak       (≥1 succeeded    (≥1 detection    (≥1 detection
 succeeded   vision_run,      latest run ma    latest run ze
 run lub     0 candidates)    candidates,      status='confirmed')
 same                          0 confirmed)
 failed)
```

Concurrency: DB trigger blokuje INSERT do `vision_runs` jeśli istnieje `running` run < 5 min dla tego photo. Endpoint catch P0001 → 409 CONFLICT.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DB foundations | `vision_runs` table (migration `0007_vision_runs.sql`) + trigger + backfill istniejących detections | Backfill nieodwracalny; NOT NULL po backfillu — błąd backfill = migration fail w prod |
| 2. API: versioned process + run-scoped match + list-by-shelf | Append-only `/process`, run-scoped `/match`, `GET /api/shelves/[id]/photos` z stage + signed URLs | Regression w `/upload` golden path (auto-run nadal musi działać) |
| 3. UI: shelf detail page + PhotoListIsland + augmented review | `/shelves/[id]`, akcje per-row, link z `/shelves`, badge runa w `/photos/[id]` | UX confirm modal (MVP używa `window.confirm` — może być sub-par) |

**Prerequisites:**
- S-03 (vision detection) — done
- S-04 (external match + proposals) — done
- Branch `change/shelf-photo-pipeline-ui` (oddzielny od bieżącego `change/external-match-and-proposals`)
- Anthropic API budget na manual smoke testy (re-run vision)

**Estimated effort:** ~2-3 sesje implementacyjne; każda faza = atomic commit. Migracja `db push` po merge do main (lessons.md § Branch per change).

## Open Risks & Assumptions

- Backfill istniejących `photos`: synthetic `succeeded` vision_run tworzony **tylko gdy `EXISTS (SELECT 1 FROM detections WHERE photo_id = p.id)`**. Photos z prior failed run (`vision_model IS NOT NULL` ale brak detection) są pomijane — pozostają stage='uploaded', user kliknie „Uruchom vision" → świeży run. (Spójne z plan.md Phase 1 §1; decyzja świadoma — alternatywa OR-condition dawała confusing fake-succeeded run z pustą listą review.)
- Zmiana `photos.status` semantyki (z trackera in-flight na cache końcowego stanu) — może wpłynąć na S-04 UI w DetectionReview. Test path: po Phase 2 odpalić `/upload` golden path end-to-end.
- Trigger 5-min window jest arbitrary; jeśli vision call zacznie regularnie trwać >5min (np. duże fotki, slow LLM), kolejny run może być przedwczesnie odblokowany podczas legit running. CF Workers CPU limit 30s + Anthropic timeout ~60s → 5 min daje 5x margin; OK dla MVP.
- `window.confirm` dla re-run — minimalistyczne, ale brakuje cost preview. Jeśli user zgłosi UX gap → osobny micro-slice.
- Roadmap supersession (S-14, S-15) musi być wykonana podczas `/10x-archive`.

## Success Criteria (Summary)

- Użytkownik wchodzi w `/shelves/[id]`, widzi listę zdjęć ze stage badge i miniaturkami; każde zdjęcie ma czytelny stan i akcje per stage.
- Re-run vision na photo z historią dodaje nowy `vision_runs` row + nowe detections; stare detections zostają w DB (historia zachowana).
- Concurrent click na „Uruchom vision" → tylko jeden run przechodzi; drugi dostaje 409 CONFLICT.
- Po reloadzie strony stan zdjęcia (badge + akcje) odzwierciedla DB — nic nie znika tylko dlatego że stan UI był „in-flight".
- Golden path `/upload` działa bez regresji.
