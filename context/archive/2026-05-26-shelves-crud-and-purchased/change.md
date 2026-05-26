---
change_id: shelves-crud-and-purchased
title: CRUD półek + niesuwalna systemowa "Zakupione"
status: archived
created: 2026-05-26
updated: 2026-05-26
archived_at: 2026-05-26T20:30:38Z
---

## Notes

S-02 w roadmapie. Most do całego MVP: S-03 (photo upload na półkę), S-04 (matching), S-05 ★ (Flow A end-to-end), S-06 (zakup), S-07 (move), S-08 (search) — wszystko wymaga istnienia półek.

Klucz: półka „Zakupione" już tworzona przez `handle_new_user` trigger (S-01, migration 0003). Tutaj dodajemy: niezmienność „Zakupione" (DB constraint), CRUD endpointy dla user-created półek, UI listy + form.

Tryb realizacji: **mode B** — plan zapisany z auto-decyzjami; po akceptacji user'a reszta cyklu (impl/review/archive) autonomicznie.
