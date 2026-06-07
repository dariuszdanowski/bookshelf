# Frame Brief: „Dodaj zakup" vs „Dodaj książkę" (M8)

**Data:** 2026-06-07 · **Confidence: HIGH**

## Reported Observation

User (testy mobilne 2026-06-07): „funkcja dodaj zakup wydaje się już nadmiarowa,
powinna zastąpić ją funkcja dodaj książkę. Trzeba się zastanowić czy po prostu
wywołać dodaj książkę w funkcji dodaj zakup czy jednak inaczej?"

## Hypothesis Investigation

| Hipoteza | Dowody | Werdykt |
| --- | --- | --- |
| H1: To dwie różne funkcje domenowe | FR-025–028: zakup = wpis na systemową „Zakupione" + opcjonalna data zakupu, KPI ≤90 s. BookModal add (S-36-modal) = wpis na DOWOLNĄ półkę z wyszukiwarką GB | częściowo — różnica zredukowała się do: preselekcja półki + pole daty |
| H2: Redundancja historyczna | `/purchase` + `AddPurchaseIsland` powstały (S-06, 2026-05) ZANIM istniał zunifikowany BookModal z trybem add i SearchPanel (S-36-modal, 2026-06). Dziś `AddPurchaseIsland` dubluje formularz pól książki bez SearchPanelu | **potwierdzona** — to martwa gałąź ewolucji UI |
| H3: Usunięcie łamie wymóg certyfikacyjny | FR-025–028 wymaga *możliwości* szybkiego dodania zakupu, nie osobnej strony; KPI ≤90 s spełnia też modal z preselekcją | odrzucona |

## Narrowing Signals

- Nav ma 5 linków (problem na mobile — hamburger z S-28 łagodzi, ale mniej = lepiej)
- `AddPurchaseIsland` nie ma wyszukiwarki GB → wpisy zakupowe są ręczne/ubogie
  w metadane, gorsze niż przez BookModal („Wyszukaj po danych")
- Data zakupu (`books.purchase_date`, migracja 0010) używana TYLKO przez ścieżkę zakupu

## Reframed Problem Statement

Nie „czy wywołać dodaj-książkę w dodaj-zakup", lecz: **ścieżka zakupu to przestarzały
duplikat formularza książki sprzed unifikacji BookModala; intencję „zakup" należy
zachować jako parametryzację zunifikowanego modala, a nie osobny ekran.**

## Rekomendacja (wariant A — thin unification)

1. `BookModal` mode `add` dostaje opcjonalne pole „Data zakupu" (widoczne, gdy
   docelowa półka = systemowa „Zakupione"; zapis do `books.purchase_date`).
2. Wpis z nav „Dodaj zakup" znika; landing/CTA „dodaj zakup" otwiera BookModal add
   z preselekcją półki „Zakupione" (np. `/shelves/{zakupione}?add=1` lub przycisk
   na widoku półki — decyzja w planie).
3. `/purchase` → redirect 302 na nową ścieżkę (linki/nawyki nie pękają), po okresie
   przejściowym usunięcie strony + `AddPurchaseIsland`.
4. Roadmapa: S-06 Outcome dostaje notę alignment; FR-025–028 spełnione nową drogą
   (KPI ≤90 s: modal + SearchPanel jest szybszy niż ręczny formularz).

Odrzucony wariant B (skrót zakupowy nad modalem): utrzymuje powierzchnię
(`/purchase` + island) bez wartości — preselekcja półki daje to samo taniej.

## Next

`/10x-plan purchase-add-book-merge` (slice S, 1–2 fazy: modal+data zakupu → redirect
+ cleanup + migracja testów E2E `add-purchase`).
