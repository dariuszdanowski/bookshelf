# Mapa terytorium — gdzie projekt żyje (historia gita)

Seria promptów do Wide Scan opartego o historię gita. Uruchamiaj po kolei w jednej sesji, a wynik zapisz do `context/map/artifact-1-territory.md`.

## Aktywność — gdzie projekt był realnie dotykany

```text
Korzystając z historii gita, w zakresie ostatnich 12 miesięcy, pokaż TOP 10 najczęściej modyfikowanych:

a) folderów lub modułów
b) plików

Odfiltruj szum: lockfile'y, snapshoty, generowane pliki, dotenvy, configi, etc.

Możesz zejść poziom niżej jeśli pierwsza seria wyników da ogólne rezultaty jak "src/frontend" i "src/backend" - chcemy poznać realne obszary aktywności hands-on.
```

```text
Podziel te same dane na kwartały — chcę zobaczyć, jak zmieniał się nacisk pracy w projekcie przez ostatni rok.
```

## Współzmiany — co zmienia się razem

```text
Jakie pary lub trójki katalogów najczęściej pojawiają się w tych samych commitach? Wyszukaj sprzężenia i krótko podsumuj wnioski dla top 3 z naszego rankingu.
```

```text
Jeszcze dwie rzeczy przy okazji tych współzmien:

- Czy jest jakiś pojedynczy plik, który zmienia się razem z wieloma różnymi
  obszarami naraz? Myślę o czymś wspólnym dla całego repo — plik z tłumaczeniami,
  config, coś generowanego. Ciekawi mnie, czy poza podziałem na foldery jest
  jakiś taki "wspólny mianownik".
- I sprawdź, czy pliki, które wyszły jako mocno sprzężone, na pewno nadal są
  w repo. To historia, więc coś mogło dużo się zmieniać, a potem zostać usunięte
  albo przeniesione — nie chcę później opierać analizy na pliku, którego już nie ma.
```

---

```text
Zapisz podsumowanie tej sesji do `context/map/artifact-1-territory.md`
```