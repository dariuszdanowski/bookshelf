---
change_id: detection-unconfirm
title: "Cofnięcie akceptacji książki (unconfirm) z poziomu review"
status: implementing
created: 2026-06-11
updated: 2026-06-12
---

## Kontekst

Manualna weryfikacja S-43 (`vision-identity-first`) ujawniła twardą dziurę UX: po kliknięciu
„Akceptuj" detekcja staje się **nieodwracalna z poziomu review**. Reject ma symetryczne
„Cofnij" (`unreject.ts` + `RejectedDecidedView`), accept — nie. User który zaakceptował
złego kandydata musi ręcznie kasować książkę z półki/katalogu, żeby zmienić decyzję.

`Akceptuj` (`confirm.ts` → `confirmDetectionToCatalog`) tworzy książkę + `shelf_entry` +
telemetrię (`corrections.correction_type='accept'`) i ustawia `detection.status='confirmed'`.
Cofnięcie to realna operacja kasująca te zapisy — symetryczna do `unreject`, ale głębsza
(unreject tylko flipuje status; unconfirm musi usunąć katalog wpis).

## Decyzje kontraktowe

- **Reset statusu**: `matched` gdy detekcja ma kandydatów, inaczej `pending` (wzorzec `unreject`).
- **Telemetria**: skasuj korekty `accept/field_edit/manual_entry` tej detekcji (precedens
  `unreject` — „cofnięte ≠ realne", nie zatruwa statystyk).
- **Orphan-safety**: książkę kasujemy tylko gdy po usunięciu `shelf_entry` tej detekcji nie
  ma już żadnych `shelf_entries` na nią wskazujących.
- **Guard**: tylko `status='confirmed'` można cofnąć → inaczej `409 CONFLICT`.

## Outcome

User może cofnąć błędną akceptację jednym kliknięciem „Cofnij" w widoku potwierdzonym
(Karty/Lista/Kafelki) — książka znika z katalogu i półki, detekcja wraca do edycji
(`matched`/`pending`), telemetria akceptacji jest czyszczona. Re-akceptacja działa
normalną ścieżką. Plan: [plan.md](plan.md), brief: [plan-brief.md](plan-brief.md).
