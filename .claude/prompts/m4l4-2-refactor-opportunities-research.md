---
name: refactor-opportunities
description: Analyze technical debt and structural risks, then propose refactoring opportunities.
---
Przeczytaj analizę:
context/changes/{change-id}/research.md - zapis długu technicznego
i ryzyka strukturalnego tego repozytorium.
Traktuj jej ustalenia jako zebrane dowody: nie wyprowadzaj ich ponownie, buduj na nich. Jeśli odnosi się do innych artefaktów (mapa repozytorium, poprzednie badania), przeczytaj je priorytetowo.

Wymień każdy problem odnotowany w raporcie, niezależnie od jego etykiety (dług, ryzyko, hotspot, znalezisko).
Sklasyfikuj każdy z nich: KANDYDAT to problem, którego naprawa zmieniłaby strukturę kodu; wszystko inne (np. brakujący test, luka w dokumentacji) nie jest kandydatem – zachowaj to jako dane wejściowe do oceny wykonalności i kosztów.
Wymień i sklasyfikuj kandydatów na początku wyniku, abym mógł je zweryfikować. Następnie zbadaj każdego kandydata za pomocą trzech podagentów; wszyscy pracują w trybie eksploracji, bez wprowadzania zmian:

1. Bieżący kształt – potwierdź w kodzie, jaki kształt ma kandydat dzisiaj: gdzie znajduje się logika, jak mieszają się obowiązki, jakie abstrakcje lub zależności już istnieją. Cytuj plik:linia. Oznacz każde stwierdzenie jako dowód / wnioskowanie / nieznane.

2. Historia i intencjonalność – określ, DLACZEGO kod ma taki kształt: ADR i dokumenty projektowe, jeśli istnieją; w przeciwnym razie archeologia git (git log -L, blame, uzasadnienia w commitach i PR). Werdykt dla każdego kandydata: świadome ograniczenie (decyzja fundamentalna) vs przypadkowa złożoność – lub szczerze oznacz jako nieznane, jeśli trudno to określić.
3. Wykonalność migracji – czego wymagałaby przyrostowa, odwracalna ścieżka (istniejąca abstrakcja vs nowa abstrakcja), co wynika z danych o promieniu rażenia z raportu, jakie zabezpieczenia i testy już istnieją wokół niej (sprawdź konfigurację CI) i jaki byłby pierwszy krok wstępny.

Twarde granice:
- Brak zmian w kodzie. Brak refaktoryzacji. Dowody przed interpretacją.
- Nie projektuj architektury docelowej
- poza nazwaniem odpowiedniego kształtu docelowego dla każdego kandydata.
- Jeśli prawdziwą poprawką dla kandydata jest przeprojektowanie koncepcji biznesowych, a nie struktury kodu – stwierdź to i zatrzymaj się – jest to temat do innej, późniejszej analizy.
- Tam, gdzie brakuje danych, napisz nieznane – nie wypełniaj luk prawdopodobnymi domysłami.
Synteza (po raportach wszystkich trzech podagentów): zapisz research.md w folderze tej zmiany. Dla każdego kandydata: bieżący kształt (z dowodami), werdykt intencjonalności, uwagi dotyczące wykonalności.
Zakończ sekcją „Możliwości refaktoryzacji” z 2-3 najsilniejszymi kandydatami w rankingu – dla każdego: bieżący → docelowy kształt, dlaczego zasługuje na to miejsce (koszt długu vs koszt zmiany), promień rażenia, szkic ścieżki przyrostowej, pierwszy krok wstępny. Wymień również rozważanych i odrzuconych kandydatów, z krótkim podsumowaniem, dlaczego. Oceniaj na podstawie dowodów. NIE proś mnie o wybór, potwierdzenie ani zatwierdzenie – zakończ, zapisując kompletny raport.
Ranking jest propozycją na osobną sesję planowania, która odbędzie się po mojej recenzji.