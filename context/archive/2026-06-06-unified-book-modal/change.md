---
change_id: unified-book-modal
roadmap_slice: S-36
status: archived
created: 2026-06-06
updated: 2026-06-06
archived_at: 2026-06-06T10:08:23Z
---

# S-36 — Ujednolicone modalne okno książki (add / edit / propose)

Jedno DUŻE, reużywalne okno modalne książki obsługujące 3 konteksty: dodawanie nowej
książki (na wybraną półkę), edycję książki już w bibliotece, oraz podgląd propozycji/kandydata
z detekcji. Wpisywanie danych częściowe lub minimalne (samo ISBN, sam tytuł, dowolny podzbiór).
Aktywne akcje: „Szukaj w sieci" (Google), „Wyszukaj po danych" (identyfikacja GB/OpenLibrary/
Biblioteka Narodowa, w tym po samym ISBN), „Wyszukaj okładki" (auto po ISBN/danych), override
okładki (auto/URL/zdjęcie + flaga). Konsoliduje istniejące BookDetailModal + ManualAddBook.

Prereq: S-33 BYOK Pipeline (na branchu `change/byok-pipeline`, niezmergowany — dostarczył
BookDetailModal z edycją/identyfikacją/okładką, ManualAddBook, endpointy books/identify/
cover-suggestion oraz `findBookCandidates`). S-36 czeka na merge S-33.
