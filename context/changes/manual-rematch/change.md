---
change_id: manual-rematch
title: Ręczne wyszukiwanie po tytule dla detekcji bez kandydatów
status: implementing
created: 2026-06-01
updated: 2026-06-01
archived_at: null
---

## Notes

Użytkownik może wpisać poprawiony tytuł i autora, uruchomić wyszukiwanie Google Books
i zobaczyć propozycje — zamiast od razu tworzyć wpis w katalogu bez weryfikacji.

Dotyczy detekcji z `candidates.length === 0` (OCR nie zwrócił wyników lub score < 0.55).

Przy okazji: costs.ts odporny na brak tabeli refine_calls (graceful degrade → [] zamiast 500).
