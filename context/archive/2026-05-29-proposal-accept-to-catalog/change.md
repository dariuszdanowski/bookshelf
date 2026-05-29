---
change_id: proposal-accept-to-catalog
status: archived
created: 2026-05-29
updated: 2026-05-29
implemented_at: 2026-05-29
archived_at: 2026-05-29T10:30:01Z

roadmap_ref: S-05
---

# proposal-accept-to-catalog (S-05) ★ north star

Domknięcie Flow A end-to-end: użytkownik akceptuje (hurtowo pre-zaznaczone lub po kolei), odrzuca lub koryguje propozycje rozpoznane ze zdjęcia (oraz wpisuje książkę ręcznie, gdy brak matchu); zaakceptowana książka trafia do katalogu ze statusem przeczytania = nie przeczytana i pozycją na półce ("od lewej"); użytkownik widzi półkę z okładkami i przełącza status przeczytania jednym kliknięciem; każda decyzja zapisana jako sygnał telemetryczny.

Outcome (roadmap): akceptować/odrzucać/korygować → katalog + widok półki. PRD refs: FR-019–024, FR-037; US-01 (domknięcie Flow A). Prereq: S-04 (zarchiwizowany 2026-05-29).

**Kluczowe decyzje planu** (zob. `plan-brief.md` → Key Decisions): read status jako `books.is_read boolean`; telemetria przez rozszerzony enum `corrections.correction_type` (loguj każdą decyzję); osobne endpointy confirm/reject/correct + współdzielony helper + batch; exact-duplicate blokowany 409; widok półki rozszerza `/shelves/[id]`; correct bez re-search (typed pola).
