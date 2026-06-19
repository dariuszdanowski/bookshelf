---
change_id: mobile-header-overflow
title: "Fix: header rozpycha viewport na 375px (poziomy scroll)"
status: archived
created: 2026-06-19
updated: 2026-06-19
archived_at: 2026-06-19T12:02:49Z
---

## Notes

Bug pre-existujący na main, ujawniony po uwolnieniu e2e w CI (PR #107, 2026-06-19):
prawa strona headera (`src/layouts/Layout.astro:147`) przekracza viewport 375px →
poziomy scroll (`scrollWidth ~427 > 375`). 6 testów `mobile-responsive.spec.ts`
zakwarantannowane `.fixme` (commit 6dbe90f), by odblokować bramkę CI.

Diagnoza (zweryfikowana w kodzie 2026-06-19): oba pille „Pomoc"/„Zgłoś błąd"
JUŻ chowają tekst `<sm` (`hidden sm:inline`). Realny winowajca: `EnvBadge`
(diagnostyczny label, nieukrywany na mobile) + szeroki `gap-4` w kontenerze headera.

## Outcome

Header renderuje się na 375px BEZ poziomego scrolla na wszystkich ścieżkach
(`/library`, `/shelves`, `/upload`, `/account`, `/help`, review `/photos/[id]`);
6× `.fixme` zdjęte i zielone; desktop niezmieniony.
