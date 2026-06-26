# Jak działa silnik dopasowywania książek

**Przeznaczenie:** dokumentacja dla użytkownika końcowego  
**Ostatnia aktualizacja:** 2026-06-26

---

## Spis treści

1. [Po co w ogóle jest silnik matchingu?](#1-po-co-w-ogóle-jest-silnik-matchingu)
2. [Skąd się biorą błędy OCR?](#2-skąd-się-biorą-błędy-ocr)
3. [Etap 1 — Przygotowanie zapytania](#3-etap-1--przygotowanie-zapytania)
4. [Etap 2 — Wyszukiwanie w bazach zewnętrznych](#4-etap-2--wyszukiwanie-w-bazach-zewnętrznych)
5. [Etap 3 — Ocena dopasowania](#5-etap-3--ocena-dopasowania)
6. [Etap 4 — Słowny fallback OCR (gdy tytuł częściowo zniekształcony)](#6-etap-4--słowny-fallback-ocr-gdy-tytuł-częściowo-zniekształcony)
7. [Etap 5 — Deduplikacja i ranking](#7-etap-5--deduplikacja-i-ranking)
8. [Co widzi użytkownik po całym procesie?](#8-co-widzi-użytkownik-po-całym-procesie)
9. [Podsumowanie — pełny diagram procesu](#9-podsumowanie--pełny-diagram-procesu)

---

## 1. Po co w ogóle jest silnik matchingu?

Model AI odczytuje z zdjęcia to, co widzi na grzbiecie — surowy tekst. Grzbiety bywają:
- **wąskie** — litery małe, zniekształcone przez perspektywę,
- **wyblakłe** — kontrast niski, kolory zlane z tłem,
- **częściowo zasłonięte** — sąsiednią książką, ozdobą, palcem,
- **drukowane niestandardową czcionką** — litery ozdobne lub stylizowane.

Efekt: OCR może odczytać „Słowcy Koszmarów" zamiast „Siewcy Koszmarów", „Filutек" z cyrylickimi literami zamiast „Filutek", albo urwać tytuł w połowie.

Silnik matchingu przekształca ten niedoskonały tekst w precyzyjne zapytanie do Google Books i OpenLibrary, a potem ocenia każdy wynik — tak żebyś ty dostał trafną propozycję zamiast pustej strony lub chybionego tytułu.

---

## 2. Skąd się biorą błędy OCR?

**Homoglify cyryliczne** to najczęstszy problem na polskich półkach. Cyrylica zawiera litery wizualnie identyczne z łacińskimi (np. cyrylickie „а" wygląda tak samo jak łacińskie „a"), ale są to inne znaki Unicode. Gdy OCR wstawi cyryliczne „е" zamiast łacińskiego „e", Google Books zwraca zero wyników dla całego tytułu.

Silnik automatycznie mapuje wszystkie znane cyrylickie homoglify na ich łacińskie odpowiedniki przed wysłaniem zapytania.

**Zakresy lat** to drugi częsty śmieć OCR: „Tolkien 1954–1955" zamiast „Tolkien". Silnik usuwa wzorzec `RRRR–RRRR` z tytułu.

**Ucięte słowa** (np. „OGARNA…" — widoczna tylko pierwsza część napisu) — silnik usuwa fragmenty zakończone wielokropkiem.

---

## 3. Etap 1 — Przygotowanie zapytania

Przed wysłaniem do API silnik:

1. **Czyści tytuł** — usuwa homoglify, zakresy lat, ucięcia.
2. **Wyodrębnia główny człon** — odcina podtytuły po znakach `–`, `—`, `:` (przy zachowaniu najdłuższego segmentu — bo niekiedy to człon po dwukropku jest właściwym tytułem).
3. **Tworzy warianty zapytania** — np. pełny oczyszczony tytuł + sam główny człon.

Przykład: `„Mały Książę — Antoine de Saint-Exupéry, 1943–1945"` → zapytania `[„Mały Książę", „Mały Książę Antoine de Saint-Exupéry"]`.

---

## 4. Etap 2 — Wyszukiwanie w bazach zewnętrznych

Silnik wysyła zapytania **równolegle** do trzech źródeł:

| Źródło | Co szuka |
|--------|----------|
| **Google Books** | Kaskada: ISBN → tytuł + autor → sam tytuł → wydawca + tytuł → warianty tekstu → autor |
| **OpenLibrary** | Wyszukiwanie po tytule + autorze; uzupełnienie metadanych przez ISBN z GB |
| **Biblioteka Narodowa** | Baza polskich wydań — szczególnie przydatna dla tłumaczeń i lokalnych edycji |

Równoległe zapytania do wszystkich trzech źródeł skracają czas analizy całej półki.

---

## 5. Etap 3 — Ocena dopasowania

Każdy kandydat z baz zewnętrznych otrzymuje **wynik dopasowania** od 0 do 100%.

Wzór:

```
wynik = 65% × podobieństwo_tytułu + 30% × podobieństwo_autora + 5% × premia_ISBN
```

- **Podobieństwo tytułu** — odległość Levenshteina między znormalizowanym tytułem z OCR a tytułem kandydata (bez diakrytyków, małe litery). Wynik 100% = identyczne teksty.
- **Podobieństwo autora** — dopasowanie tokenowe (po nazwisku, nie po całym ciągu) z tolerancją na literówki. „Lem" ⊆ „Stanisław Lem" → 100%. Brak autora w OCR → 50% (neutralne, nie obniża).
- **Premia ISBN** — +5% gdy kandydat ma ISBN; nagradza dobrze opisane pozycje w bazie.

### Progi decyzyjne

| Wynik | Co oznacza | Co widzi użytkownik |
|-------|-----------|---------------------|
| **≥ 75%** | Wysokie dopasowanie | Kandydat pre-zaznaczony ✓ — wystarczy kliknąć „Akceptuj" |
| **55–74%** | Średnie dopasowanie | Kandydat wymaga twojego potwierdzenia |
| **< 55%** | Brak pewnego dopasowania | System uruchamia słowny fallback OCR (patrz niżej) |

Dodatkowo — filtr autorski eliminuje kandydatów, którzy mają zupełnie innego autora (porównanie tokenów nazwiska), nawet jeśli tytuł wydaje się podobny.

---

## 6. Etap 4 — Słowny fallback OCR (gdy tytuł częściowo zniekształcony)

To kluczowy mechanizm odzysku po błędzie OCR, dodany w wersji S-48.

### Problem, który rozwiązuje

Gdy AI odczyta „**Słowcy** Koszmarów" zamiast „**Siewcy** Koszmarów", cała kaskada zapytań tytułowych kończy się fiaskiem — Google Books nie zna tytułu z błędnym pierwszym słowem. Kaskada w ostatnim kroku odpada na zapytanie „autor bez tytułu" (`inauthor:`), które zwraca losowe książki z bibliografii autora o wyniku ~30% — za mało, żeby zaproponować cokolwiek sensownego.

### Jak działa fallback

Gdy **wszystkie** kandydaci z wyszukiwania podstawowego mają wynik < 55% **i** OCR rozpoznał imię autora, silnik uruchamia fallback słowny:

1. **Wyodrębnia istotne słowa** z rozpoznanego tytułu — słowa o długości ≥ 5 znaków (krótsze są zwykle spójnikami lub rodzajnikami bez wartości rozróżniającej). Przykład: `„Słowcy Koszmarów"` → `[„Koszmarów" (9 liter), „Słowcy" (6 liter)]`.

2. **Sortuje od najdłuższego** — dłuższe słowo jest bardziej charakterystyczne dla konkretnego tytułu, więc ma większą szansę trafić na właściwą książkę.

3. **Próbuje kolejno — maksymalnie 3 słowa** — dla każdego słowa wysyła zapytanie `intitle:<słowo> + inauthor:<autor>` do Google Books:
   - jeśli zapytanie zwróci kandydata z wynikiem ≥ 55% → **zatrzymuje się** (early stop),
   - jeśli nie ma wyników lub wynik niski → próbuje następne słowo,
   - jeśli Google Books odpowie „za dużo zapytań" (429 rate limit) → kończy fallback i zwraca to, co zdążył zebrać.

4. **Dołącza wyniki do puli** — kandydaci z fallbacku trafiają do tej samej kolejki co kandydaci z wyszukiwania podstawowego, przechodzą przez te same filtry i są oceniani tak samo wzorem wynik = 65% × tytuł + 30% × autor + 5% ISBN.

### Przykład krok po kroku

| Krok | Akcja | Wynik |
|------|-------|-------|
| OCR odczytuje | „Słowcy Koszmarów" + autor „Marowska" | — |
| Wyszukiwanie podstawowe | GB zwraca losowe książki Marowskiej | wynik ~30% < 55% |
| Fallback: słowo 1 | zapytanie `intitle:Koszmarów inauthor:Marowska` | GB zwraca „Siewcy Koszmarów" |
| Ocena | podobieństwo tytułu 60% + autor 100% + ISBN 5% = **~74%** | ≥ 55% → stop |
| Wynik dla użytkownika | kandydat „Siewcy Koszmarów" w propozycjach (wymaga potwierdzenia) | ✓ |

Bez fallbacku użytkownik zobaczyłby pustą listę i musiał wpisać tytuł ręcznie.

### Kiedy fallback nie uruchamia się

- Wynik podstawowy ≥ 55% — jest już dobry kandydat.
- Brak rozpoznanego autora w OCR — zapytanie słowne bez autora jest zbyt ogólne i zwracałoby losowe wyniki.
- Wszystkie słowa tytułu mają < 5 znaków — brak słów wystarczająco charakterystycznych.

---

## 7. Etap 5 — Deduplikacja i ranking

Po zebraniu wszystkich kandydatów (z wyszukiwania podstawowego + ewentualnego fallbacku):

1. **Deduplikacja** — usuwa duplikaty tej samej książki (to samo ISBN lub ten sam tytuł+autor z różnych źródeł). Zostaje najwyżej oceniony egzemplarz.
2. **Ograniczenie listy** — maksymalnie 8 kandydatów na jedną detekcję.
3. **Okładka** — jeśli kandydat ma ISBN, system dodaje URL okładki z OpenLibrary (bez sprawdzania, czy plik istnieje — dla szybkości).

---

## 8. Co widzi użytkownik po całym procesie?

Na ekranie „Przeglądaj detekcje" każda rozpoznana pozycja z półki pokazuje:

- **Listę kandydatów** posortowaną wg wyniku (najlepszy na górze).
- **Wizualny wskaźnik pewności** — zielony (≥ 75%), żółty (55–75%), brak pre-zaznaczenia (poniżej).
- **Okładki** z OpenLibrary (gdy dostępne).
- **Przyciski akcji**: Akceptuj / Odrzuć / Popraw ręcznie / Szukaj ponownie.

Gdy system musiał uruchomić słowny fallback, użytkownik **nie widzi** żadnej dodatkowej informacji — rezultat wygląda tak samo jak normalne dopasowanie. Różnica jest widoczna tylko w wynikach: zamiast pustej listy użytkownik dostaje propozycję do zatwierdzenia.

---

## 9. Podsumowanie — pełny diagram procesu

```
Zdjęcie półki
     │
     ▼
┌─────────────────────────────────────┐
│ OCR (Claude Sonnet 4.6 vision)      │
│  → lista: tytuł + autor per książka │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│ Czyszczenie tytułu                  │
│  ● cyrylica → łacina                │
│  ● usuń zakresy lat                 │
│  ● usuń urwane słowa (…)            │
│  ● wyodrębnij główny człon          │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│ Wyszukiwanie równoległe             │
│  ● Google Books (kaskada wariantów) │
│  ● OpenLibrary (tytuł + autor)      │
│  ● Biblioteka Narodowa              │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│ Ocena dopasowania                   │
│  wynik = 65%×tytuł + 30%×autor     │
│           + 5%×ISBN                 │
└──────────────────┬──────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
    wynik ≥ 55%       wynik < 55%
    (dobry match)     (słaby match)
          │                 │
          │                 ▼
          │    ┌─────────────────────────┐
          │    │ Słowny fallback OCR     │
          │    │ (gdy autor rozpoznany)  │
          │    │                         │
          │    │ 1. wyodrębnij słowa ≥5  │
          │    │ 2. sortuj od najdłuższego│
          │    │ 3. próbuj max 3 słowa   │
          │    │    (early stop ≥ 55%)   │
          │    └──────────┬──────────────┘
          │               │
          └───────┬───────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ Deduplikacja + ranking (max 8)      │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│ UI — propozycje dla użytkownika     │
│  ≥75% → pre-zaznaczone ✓           │
│  55–74% → do potwierdzenia          │
│  brak → ręczne wpisanie             │
└─────────────────────────────────────┘
```

---

*Plik źródłowy algorytmu: `src/lib/matching/findCandidates.ts` + `src/lib/matching/normalizeQuery.ts` + `src/lib/matching/score.ts`.*
