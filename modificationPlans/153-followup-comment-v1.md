Ponownie otwieram — manualny test ujawnił, że pierwsza naprawa nie była kompletna.

**Co jeszcze nie działało:**
1. Wyszukiwanie po samym ISBN wewnętrznie znajdowało poprawną książkę, ale ocena pewności (`matchScore`) była liczona tak, jakby ISBN nic nie znaczył (flat +0.05 bonus za samo posiadanie ISBN, bez sprawdzenia czy to ten sam numer). Efekt: ~20% pewności zamiast bliskiej 100%.
2. Gdy detekcja miała już wcześniej zapisanego (błędnego) kandydata o wyższym, ale fałszywym wyniku, mechanizm „nie zastępuj lepszego gorszym" blokował podmianę na poprawny wynik z ISBN.

**Naprawione w PR:** https://github.com/dariuszdanowski/bookshelf/pull/156

Dodatkowo zauważyłem osobny, pokrewny problem: gdy OCR odczyta tytuł w niewłaściwej formie gramatycznej (np. liczba pojedyncza zamiast mnogiej), wyszukiwanie po tytule może nie znaleźć książki wcale — to inny mechanizm (zewnętrzne wyszukiwarki, nie nasz kod) i osobny temat, dopisany do roadmapy jako pomysł do rozważenia później.
