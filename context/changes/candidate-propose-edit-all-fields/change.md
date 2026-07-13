---
change_id: candidate-propose-edit-all-fields
title: Popraw jako pełna edycja propozycji kandydata przed zatwierdzeniem
status: implementing
created: 2026-07-13
updated: 2026-07-14
archived_at: null
---

## Notes

przeprojektowanie flow "Popraw": zamiast osobnego formularza field_edit, kliknięcie "Popraw" otwiera ten sam modal propozycji (BookModal mode="propose") ale w pełni edytowalny — wszystkie pola łącznie z ISBN, zapis PATCH-em do kandydata bez natychmiastowego zatwierdzania; osobny, jawny przycisk "Zatwierdź" konwertuje do książki w katalogu
