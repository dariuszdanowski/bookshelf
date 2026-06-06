---
change_id: photo-hash-backfill
title: Backfill SHA-256 dla istniejących zdjęć
status: archived
created: 2026-06-03
updated: 2026-06-06
archived_at: 2026-06-06T21:20:00Z
---

## Notes

Migracja 0013 (photo-dedup) dodała kolumnę `file_hash_sha256` jako nullable — istniejące
zdjęcia mają NULL. Bez backfillu dedup nie wykryje ponownego uploadu zdjęcia wgranego
przed wdrożeniem dedupu.

## Outcome

Jednorazowy skrypt Node.js `scripts/backfill-photo-hashes.mjs`:
- Pobiera z DB wszystkie `photos` WHERE `file_hash_sha256 IS NULL`
- Dla każdego: download z Storage (`shelf-photos`), SHA-256 przez `node:crypto`,
  UPDATE `photos.file_hash_sha256`
- Raportuje postęp, pomija zdjęcia z błędem Storage (loguje), zwraca exit 1 jeśli
  jakikolwiek UPDATE się nie powiódł

Brak nowych migracji SQL — kolumna i index już istnieją (0013).

**Status po impl-review (2026-06-06):** skrypt dostarczony (`9feaa22`, `8a63650`),
review wykrył i naprawił shifting-window bug paginacji (F1) + dodał 8 testów unit (F2)
— zob. `reviews/impl-review.md`. Uruchomienie na prod pozostaje user-only
(`--dry-run` najpierw).
