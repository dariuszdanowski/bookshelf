## Naprawione ✅

Przycisk „Szukaj" na widoku zdjęcia działa teraz też wtedy, gdy podasz **tylko ISBN** — bez
konieczności wpisywania tytułu. Wcześniej pole tytułu było obowiązkowe, mimo że pole ISBN i tak
było dostępne obok niego.

**Co się zmieniło:**
- Przycisk „Szukaj" odblokowuje się, gdy wypełniony jest tytuł **lub** ISBN (wystarczy jedno z nich).
- Wyszukiwanie po samym ISBN korzysta z tego samego, sprawdzonego mechanizmu, który już działał
  w innym miejscu aplikacji (formularz dodawania książki).

**Zweryfikowane:** pełna suita testów automatycznych (1085 testów jednostkowych + testy E2E w
przeglądarce dla ścieżki „szukaj po ISBN") oraz build produkcyjny — wszystko zielone.

PR: https://github.com/dariuszdanowski/bookshelf/pull/155
