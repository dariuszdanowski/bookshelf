-- S-06 Flow B: opcjonalna data zakupu na książce (FR-028).
-- Nullable — manual entry ustawia dziś app-side gdy pominięte; książki z
-- ścieżki zdjęcia (pipeline S-03→S-05) zostają NULL (nie niosą intencji zakupu).

alter table books add column purchase_date date;
