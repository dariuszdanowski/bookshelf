## Ogólna koncepcja

- Uruchomienie przepływu pracy GHA dla każdego nowego pull requestu do mastera
- Akcja kompozytowa dla samej recenzji, aby główny przepływ pracy był łatwy do zrozumienia

## Parametry wejściowe

- tytuł pull requestu
- opis pull requestu (?? kompromis kosztowy)
- git diff

## Kryteria przeglądu kodu

Każde kryterium jest oceniane w skali 1–10, gdzie 1 to najgorszy wynik, a 10 to najlepszy.

1) **poprawność implementacji** — czy kod faktycznie robi to, co twierdzi, obsługując przypadki brzegowe i ścieżki błędów bez wprowadzania regresji?
   - _1_: logika jest zepsuta, pomija oczywiste przypadki brzegowe/błędów lub po cichu pogarsza istniejące zachowanie.
   - _10_: zachowuje się poprawnie w przypadku ścieżki szczęśliwej, przypadków brzegowych i trybów awarii bez regresji.

2) **idiomatyczność** — czy kod jest zgodny z konwencjami języka, frameworka i projektu, których oczekiwałby biegły czytelnik?
   - _1_: walczy z idiomami stosu i ustalonymi wzorcami repozytorium, czyta się jako obcy.
   - _10_: nie do odróżnienia od dobrze napisanego otaczającego kodu, używa właściwych idiomów w naturalny sposób.

3) **złożoność** — czy rozwiązanie jest tak proste, jak pozwala na to problem, bez zbędnej abstrakcji lub zawiłości?
   - _1_: nadmiernie zaprojektowane lub splątane — trudne do śledzenia, z przypadkową złożonością, która zaciemnia intencje.
   - _10_: minimalne i jasne, najprostszy projekt, który całkowicie rozwiązuje problem.

4) **pokrycie testami / ryzykiem** — czy istotne zachowania i ryzykowne ścieżki są testowane proporcjonalnie do ich ryzyka?
   - _1_: ryzykowna logika jest dostarczana bez testów; testy są nieobecne, trywialne lub niczego użytecznego nie potwierdzają.
   - _10_: pokrycie ważone ryzykiem — części najbardziej narażone na awarię są testowane celowo i dobrze.

5) **dokumentacja** — czy nieoczywiste decyzje, publiczne interfejsy i trudny kod są wyjaśnione tam, gdzie czytelnik by tego potrzebował?
   - _1_: nieprzejrzyste — brak komentarzy lub dokumentacji tam, gdzie są potrzebne, intencje muszą być odtworzone.
   - _10_: wystarczająca dokumentacja/komentarze, aby wyjaśnić "dlaczego" bez powtarzania oczywistości.

6) **bezpieczeństwo** — czy zmiana pozwala uniknąć wprowadzania luk, wycieku sekretów lub niebezpiecznego przetwarzania niezaufanych danych wejściowych?
   - _1_: wprowadza możliwą do wykorzystania lukę, wycieka sekrety lub niebezpiecznie ufa niezaufanym danym wejściowym.
   - _10_: dane wejściowe są walidowane, sekrety są obsługiwane prawidłowo i nie otwiera się nowa powierzchnia ataku.

## Odłożone na później

- zgodność biznesowa (wymaga szerszego kontekstu)
- dopasowanie architektoniczne (wymaga szerszego kontekstu)

## Oczekiwane efekty uboczne

- Komentarz PR z podsumowaniem
- etykiety: `ai-cr:failed` (czerwony) LUB `ai-cr:passed` (zielony)

## Oczekiwane zachowanie

- ponowna próba na żądanie po dodaniu etykiety `ai-cr:review`