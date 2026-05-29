# Add Purchase Flow (S-06) — Plan Brief

> Full plan: `context/changes/add-purchase-flow/plan.md`

## What & Why

Flow B (US-02): „Dodaj zakup" na półkę „Zakupione" — ręcznie (≤90s) lub zdjęciem stosu. Drugi z dwóch równo-ważonych momentów PRD po Flow A (S-05).

## Starting Point

Katalog + widok półki gotowe (S-05). „Zakupione" istnieje od signup. Brak: ścieżki tworzenia książki bez detekcji, kolumny `purchase_date`, entry pointu „Dodaj zakup".

## Desired End State

Header „Dodaj zakup" → `/purchase`: ręczny formularz (title+author+data dziś) → `POST /api/books` → książka na Zakupione → redirect; albo zdjęcie → `/upload?shelf=Zakupione` (istniejący pipeline).

## Key Decisions (zawetuj wyjątki)

| Decyzja | Wybór | Źródło |
| --- | --- | --- |
| Manual entry path | Świeży `POST /api/books` (NIE reuse confirm helper — detection-bound) | Research |
| purchase_date | Migracja 0010, nullable; default dziś app-side dla manual; photo-path = NULL | Plan |
| Zakupione resolution | helper `getPurchasedShelfId` + const `PURCHASED_SHELF_NAME` | Research |
| Entry point | Header nav „Dodaj zakup" (każdy widok = FR-025) | Research |
| UI | `/purchase` page + `AddPurchaseIsland` (toggle ręcznie/zdjęcie) | Plan |
| Photo path | Reuse upload + `?shelf=` preset (Zakupione i tak sortuje first) | Research |
| exact-dup isbn | 409 CONFLICT (mirror S-05) | Plan |
| Telemetria Flow B manual | Brak (corrections jest detection-bound) | Plan |
| purchase_date display | Odroczone (store-only w S-06) | Plan |

## Scope

**In:** migracja 0010, `POST /api/books`, `getPurchasedShelfId`, `/purchase` + `AddPurchaseIsland`, header CTA, upload `?shelf=` preset, E2E.
**Out:** purchase_date na ścieżce zdjęcia, render daty, move z Zakupione (S-07), telemetria Flow B.

## Phases

| Phase | Dostarcza | Ryzyko |
| --- | --- | --- |
| 1 Substrat | migracja 0010 + AddPurchaseSchema + helper | — |
| 2 Endpoint | POST /api/books (Zakupione + purchase_date + dup) | rollback bez transakcji (wzorzec F1) |
| 3 UI | /purchase + island + header CTA + upload preset | KPI ≤90s = minimalizm formularza |
| 4 E2E | golden path add-purchase (mock) | — |

**Prereq:** S-05 (✓), S-02 Zakupione (✓). **Effort:** ~4 fazy, lżejsze niż S-05.

## Success Criteria

- „Dodaj zakup" z każdego widoku; ręczny zakup ≤90s ląduje na Zakupione z datą; zdjęcie → upload z Zakupione preselected; duplikat ISBN blokowany.
