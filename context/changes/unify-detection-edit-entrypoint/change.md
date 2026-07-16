---
change_id: unify-detection-edit-entrypoint
title: Jeden punkt wejścia do edycji detekcji (Popraw / okładka-lub-placeholder) zamiast rozproszonych "Szukaj po tytule" / "Wyszukaj po danych" / "Wpisz ręcznie"
status: implemented
created: 2026-07-15
updated: 2026-07-16
---

## Notes

Powstało z `/10x-frame` (patrz `frame.md` w tym folderze) po obserwacji usera podczas
manualnego smoke testu `ai-resolution-search-tool`: przycisk "Szukaj po tytule"
(RematchForm, widok karty detekcji) wygląda jak duplikat "Wyszukaj po danych"
(BookModal, mode="propose", okno podglądu propozycji). Frame poszedł głębiej niż
literalny duplikat i znalazł, że to trzy rozjechane ścieżki edycji (RematchForm,
CorrectForm, BookModal.propose) na dwóch niespójnych stanach karty (match/no-match),
będące driftem od pierwotnej wizji `unified-book-modal` (2026-06-06).
