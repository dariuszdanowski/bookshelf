---
change_id: book-purchase-metadata
title: "Metadane zakupu książki: cena/miasto/wydarzenie + propagacja ze zdjęcia + filtry biblioteki"
status: planned
created: 2026-06-14
updated: 2026-06-14
archived_at: null
---

## Notes

Nowy slice. Dane zakupu (kiedy, cena, miasto, wydarzenie) jako opcjonalne atrybuty
każdej książki, edytowalne w BookModal. Panel na photo review page ustawia date/city/event
raz dla całej partii — propagowane do każdej potwierdzonej książki ze zdjęcia. Nowe filtry
wyszukiwania w /library: dropdown wydarzeń, city freetext, zakres dat, zakres ceny.

Prerequisite dla M8 `purchase-add-book-merge` (ten slice dodaje pola purchase_*
do books; M8 potem używa ich w zintegrowanym „Dodaj zakup" przez BookModal).

## Outcome

Użytkownik może zapisać gdzie, kiedy i za ile kupił każdą książkę — zarówno ręcznie
(BookModal edit) jak i hurtowo przy review zdjęcia — oraz filtrować katalog po tych
atrybutach w /library.
