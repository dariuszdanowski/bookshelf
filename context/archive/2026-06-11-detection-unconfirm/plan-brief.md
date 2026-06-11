# Cofnięcie akceptacji książki (unconfirm) — Plan Brief

> Full plan: `context/changes/detection-unconfirm/plan.md`

## What & Why

Akceptacja książki w review jest dziś nieodwracalna z poziomu UI — user, który zatwierdził
złego kandydata, musi ręcznie kasować książkę z półki. Dodajemy „Cofnij" symetryczne do
istniejącego cofania odrzucenia (`unreject`).

## Starting Point

`Akceptuj` (`confirm.ts`) tworzy książkę + `shelf_entry` + telemetrię i ustawia
`detection.status='confirmed'`. Reject ma pełną symetrię cofania (`unreject.ts` +
`RejectedDecidedView` z „Cofnij"); accept — nie ma żadnej.

## Desired End State

W widoku potwierdzonym (Karty/Lista/Kafelki) jest „Cofnij". Klik usuwa książkę + `shelf_entry`
z katalogu, przywraca detekcję do edycji (`matched`/`pending`), czyści korekty akceptacji,
a karta wraca do stanu „do decyzji". Re-akceptacja działa normalnie.

## Key Decisions Made

| Decision | Choice | Why |
|---|---|---|
| Lokalizacja helpera | `unconfirmDetectionFromCatalog` w `confirm.ts` | symetria z confirm |
| Kolejność cofania | usuń entry → usuń osieroconą książkę → reset status → kasuj korekty | FK cascade + orphan-safety |
| Reset statusu | `matched` gdy ma kandydatów, inaczej `pending` | wzorzec `unreject.ts` |
| Telemetria | skasuj korekty `accept/field_edit/manual_entry` | precedens `unreject` |
| Guard nie-confirmed | 409 CONFLICT | spójne z `confirm.ts` |
| Książka skasowana ręcznie | pomiń delete, i tak resetuj status | retry-safe |

## Scope

**In scope:** endpoint `POST /unconfirm`, helper odwracający confirm, „Cofnij" ×3 tryby,
testy unit/integration/E2E.

**Out of scope:** bulk-undo dla confirm-batch, historia/kosz, nowy `correction_type`.

## Architecture / Approach

Backend-first: czysty helper (testowalny bez DB) + cienki endpoint-wrapper (wzorzec `unreject`),
potem UI przez `useDetectionDecision` (`handleUnconfirm` mirror `handleUndoReject`). Bez migracji.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Backend | helper + endpoint + unit/integration | orphan-check książki przy współdzielonym entry |
| 2. UI | „Cofnij" ×3 + hook + E2E | spójność stanu listy po cofnięciu (decidedIds/confirmedIds) |

**Prerequisites:** brak (istniejące tabele/FK).
**Estimated effort:** ~1 sesja, 2 fazy.

## Open Risks & Assumptions

- Zakładamy 1:1 książka↔entry per akceptacja (confirm zawsze INSERT-uje nową książkę);
  orphan-check chroni przed wyjątkiem współdzielenia.
- Bez transakcji PostgREST — kroki retry-safe, częściowa porażka logowana (jak confirm).

## Success Criteria (Summary)

- User cofa błędną akceptację jednym kliknięciem; książka znika z katalogu i półki.
- Detekcja wraca do edycji; re-akceptacja nie dubluje wpisu.
- Cudza/nie-confirmed detekcja obsłużona bezpiecznie (404/409).
