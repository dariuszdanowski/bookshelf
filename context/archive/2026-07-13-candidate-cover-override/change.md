---
change_id: candidate-cover-override
title: Candidate cover override
status: archived
created: 2026-07-13
updated: 2026-07-13
archived_at: 2026-07-13T20:42:57Z
---

## Notes

Zgłoszone przez usera na produkcji (zdjęcie `cc4eeff9-288c-40b3-95d7-30f6be67e221`, detekcja #4, 2026-07-13): rematch trafił poprawny tytuł, ale kandydat nie ma okładki (`cover_url` puste — źródło zewnętrzne jej nie miało). User chce móc wskazać link do okładki JUŻ na etapie kandydata (widok `BookModal mode="propose"`), zamiast dopiero po zatwierdzeniu do katalogu (gdzie `BookModal mode="edit"` już to umożliwia przez `user_cover_url`).

Ustalenia z research (fork, 2026-07-13):
- `BookModal` ma tryby `'add' | 'edit' | 'propose'`; `propose` jest dziś w pełni read-only (`canEdit = mode !== 'propose'`, `src/components/BookModal.tsx:631`) — brak `CoverEditor`, brak przycisku zapisu.
- `book_candidates` (migracja `0001_initial_schema.sql`) ma tylko `cover_url` (z zewnętrznego źródła) — brak kolumn override jak w `books` (`user_cover_url`/`cover_photo_url`/`cover_source`, dodane w `0018_book_user_cover.sql`).
- Istnieje już precedens „edytuj przed zatwierdzeniem" bez dotykania `book_candidates`: `field_edit` (korekta tytułu/autora/wydawnictwa/roku) ląduje bezpośrednio w potwierdzonej książce przy `confirm`, bez pośredniego zapisu do kandydata (`CorrectedFieldsShape`, `src/lib/books/schema.ts:138-151`).
- Rekomendacja z researchu: rozszerzyć dokładnie ten sam mechanizm o opcjonalne pole `cover_url` (zamiast nowej migracji na `book_candidates` — kandydaci są tymczasowi, usuwani/zastępowani przy rematch/refine, więc wartość nie musi przetrwać dłużej niż do momentu confirm).

Zobacz `plan.md` po `/10x-plan`.
