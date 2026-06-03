# S-29 Photos CRUD — Plan Brief

> Full plan: `context/changes/photos-crud/plan.md`

## What & Why

Pełne zarządzanie zdjęciami w katalogu: usuwanie (z czyszczeniem Storage i kaskadą detekcji),
przenoszenie między półkami i rozdzielenie widoku półki na zakładki „Książki / Zdjęcia". Domyka
backlog (bug sieroty Storage, oznaczenie zdjęć bez hash) i daje użytkownikowi kontrolę nad
zawartością półki po wdrożeniu pipeline'u vision.

## Starting Point

`/shelves/[id].astro` renderuje już `ShelfBooksIsland` + `PhotoListIsland` jako stackowane sekcje;
`GET /api/shelves/[id]/photos` listuje zdjęcia z bogatym DTO. Brakuje endpointów PATCH/DELETE na
`photos/[id]` (jest tylko GET) i akcji zarządzania w UI. S-30 już zmienił FK kosztów na SET NULL,
więc żadna migracja nie jest potrzebna.

## Desired End State

W zakładce „Zdjęcia" każdy wiersz ma akcje Usuń (modal z konsekwencjami) i Przenieś (picker półki).
Usunięcie kasuje plik + detekcje/kandydatów, ale **zachowuje skatalogowane książki, telemetrię
korekt i historię kosztów vision**. Zdjęcia z NULL hash mają badge. Aktywna zakładka pamiętana w
localStorage.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Source |
| --- | --- | --- | --- |
| Lista zdjęć | Reuse `GET /api/shelves/[id]/photos` | Istnieje, bogaty DTO; nowy `?shelf_id=` byłby duplikatem | Plan |
| PATCH zakres | Tylko `shelf_id` (drop „retitle") | `photos` nie ma kolumny title; caption = osobny slice | Plan |
| DELETE kolejność | DB delete → best-effort Storage remove | Błąd Storage = niewidzialna sierota (tańsza) zamiast wiersza z zepsutą miniaturą | Plan |
| Co przeżywa DELETE | Książki + koszty + telemetria zostają | FK SET NULL (S-30 + 0001); guardrail „dane nie giną" | Plan |
| Potwierdzenie | Modal React (nie window.confirm) | Konwencja CLAUDE.md + jasność cascade | Plan |
| Badge NULL hash | derived `legacy_no_hash` boolean | Nie wyciekać surowego hash | Plan |
| Tabs persist | `localStorage` `bookshelf:shelf-tab` | Wzór `useDetectionViewMode` (S-25) | Plan |

## Scope

**In scope:** DELETE + PATCH(`shelf_id`) endpointy; zakładki Książki/Zdjęcia + persist; akcje
Usuń/Przenieś w `PhotoListIsland`; badge NULL hash; flaga `legacy_no_hash` w endpoint liście; unit + E2E.

**Out of scope:** nowy `GET /api/photos?shelf_id=`; kolumna title/caption; migracje DB; delete/move na
review page; backfill hash (osobny change); bulk-delete / multi-select.

## Architecture / Approach

Trzy atomic fazy: (1) API (`photos/[id].ts` + schema, automated-only), (2) `ShelfTabs.tsx` opakowuje
istniejące islands w zakładki na `/shelves/[id].astro`, (3) akcje delete/move + badge w
`PhotoListIsland` + flaga w endpoincie listy. Mirror istniejących wzorców: CRUD z `shelves/[id].ts`,
move z `ShelfBooksIsland`, persist z `useDetectionViewMode`.

## Phases at a Glance

| Phase | Dostarcza | Główne ryzyko |
| --- | --- | --- |
| 1. API DELETE+PATCH | Endpointy + schema + unit | Kolejność DB/Storage przy częściowym błędzie |
| 2. Tabs | Zakładki + persist + E2E | Migotanie przy hydratacji islands |
| 3. Akcje + badge | Usuń/Przenieś modal, badge, DTO flag | Optimistic rollback przy błędzie sieci |

**Prerequisites:** S-03, S-05, S-30 — wszystkie done (FK kosztów SET NULL gotowe).
**Estimated effort:** ~1–2 sesje, 3 fazy, bez migracji.

## Open Risks & Assumptions

- Best-effort Storage remove może zostawić sieroty plików przy błędzie Storage — akceptowalne
  (niewidzialne, tanie, do batch-cleanu); logowane.
- Równoległy change `photo-hash-backfill` docelowo wyzeruje potrzebę badge — badge jest przejściowy.
- Przeniesienie zdjęcia (PATCH shelf_id) nie przenosi skatalogowanych książek (mają własny
  `shelf_entries.shelf_id`) — to świadome zachowanie, nie bug.

## Success Criteria (Summary)

- Usunięcie zdjęcia czyści Storage + detekcje, zachowuje katalog i koszty.
- Zakładki Książki/Zdjęcia działają i pamiętają wybór.
- Zdjęcia bez hash są oznaczone; przeniesienie między półkami działa.
