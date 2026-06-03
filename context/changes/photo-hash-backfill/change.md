---
change_id: photo-hash-backfill
title: Backfill SHA-256 dla istniejących zdjęć
status: in_progress
created: 2026-06-03
updated: 2026-06-03
archived_at: null
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
