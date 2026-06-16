---
name: 10x-mom-test
description: >
  Validate any idea — product, feature, internal tool, service, or workflow —
  using The Mom Test principles before building. Use after someone has a draft
  idea or supporting notes (user interviews, tickets, or a shape/PRD/roadmap/
  opportunity-map) and wants to check whether the problem is real. Produces a
  non-leading critique, an interview guide, survey questions, and go/no-go
  decision criteria grounded in past behavior and concrete pain, not opinions
  about the solution.
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Test Matki: Zweryfikuj problem przed budową

Ta umiejętność poddaje pomysł testowi warunków skrajnych przed wdrożeniem. Pomaga użytkownikowi uniknąć uprzejmych fałszywych pozytywów, aspiracyjnych odpowiedzi i ankiet, które proszą ludzi o zatwierdzenie rozwiązania, którego faktycznie nie potrzebowali. Działa dla każdego rodzaju pomysłu — aplikacji konsumenckiej, B2B SaaS, funkcji, narzędzia wewnętrznego lub firmy usługowej.

Domyślnie używaj języka angielskiego. Przełącz się na polski (lub inny język), jeśli użytkownik napisze do Ciebie w tym języku.

## Podstawowa zasada

Nigdy nie pytaj, czy ludzie lubią ten pomysł, czy używaliby produktu, ani czy uważają tę funkcję za użyteczną. Pytaj o to, co już robią, co wydarzyło się ostatnio, co próbowali, jaki koszt ponieśli i jakie obejście istnieje dzisiaj.

Dobre pytania ujawniają zachowanie (w różnych dziedzinach):

- „Opowiedz mi, jak ostatnio próbowałeś zaplanować tydzień posiłków — co faktycznie zrobiłeś?”
- „Co zrobiłeś ostatnio, gdy faktura nie zgadzała się z wykonaną pracą?”
- „Kiedy ostatnio ręcznie sprawdzałeś, które PR-y blokowały wydanie?”
- „Jak sobie z tym radzisz dzisiaj, bez żadnego nowego narzędzia?”

Słabe pytania zachęcają do uprzejmości lub fantazji:

- „Czy używałbyś takiego produktu?”
- „Czy podoba Ci się ten pomysł?”
- „Czy pulpit nawigacyjny z tymi danymi byłby użyteczny?”
- „Ile byś za to zapłacił?”

## Dane wejściowe

Akceptuj dowolne z poniższych:

- pomysł w tekście,
- notatki od użytkowników, klientów, zgłoszeń, incydentów, wątków wsparcia, notatek ze spotkań lub wcześniejszych wywiadów,
- pomocniczy artefakt, jeśli taki istnieje, np. `context/team/opportunity-map.md`, `context/foundation/shape-notes.md`, `context/foundation/prd.md` lub `context/foundation/roadmap.md`.

Jeśli nie ma danych wejściowych, zapytaj o:

1. rozważany pomysł lub rozwiązanie,
2. docelowych użytkowników, klientów lub role,
3. podejrzewany problem lub tarcia,
4. czy użytkownik chce wywiadów, ankiety, czy obu.

## Proces

### Krok 1: Wyodrębnij hipotezy

Przeczytaj dostarczony materiał i wyodrębnij:

- **Użytkownik/rola**: kto ma problem.
- **Podejrzewane tarcia**: jaki powtarzający się ból istnieje.
- **Obecne obejście**: jak użytkownik prawdopodobnie rozwiązuje to dzisiaj.
- **Proponowane rozwiązanie**: co twórca chce stworzyć.
- **Ryzykowne założenia**: twierdzenia, które mogą być błędne.
- **Istniejące dowody**: fakty z logów, zgłoszeń, wywiadów, incydentów lub danych użytkowania.

Oddziel fakty od domysłów. Jeśli PRD jest dopracowane, ale dowody są skąpe, powiedz to jasno.

### Krok 2: Podważ pomysł w rozmowie

Przeprowadź krótką krytykę przed generowaniem pytań:

- Gdzie użytkownik może mylić rozwiązanie z problemem?
- Które założenia zależą od przyszłych intencji, a nie od przeszłych zachowań?
- Co udowodniłoby, że problem nie jest wart budowania?
- Jaki istniejący produkt, narzędzie, proces lub ręczne obejście może być już wystarczająco dobre?
- Co liczyłoby się jako mocny dowód do kontynuowania?

Zadaj maksymalnie trzy pytania wyjaśniające tylko wtedy, gdy jest to konieczne. Preferuj pytania dotyczące użytkowników, ostatnich incydentów, obecnych obejść lub stawek decyzyjnych.

### Krok 3: Przepisz złe pytania

Jeśli użytkownik dostarczy szkic pytań, sklasyfikuj każde z nich:

- `keep`: konkretne i oparte na zachowaniu,
- `rewrite`: użyteczny zamiar, ale tendencyjny/abstrakcyjny,
- `drop`: prosi o komplementy, hipotetyczne sytuacje, fantazje cenowe lub zatwierdzenie rozwiązania.

Dla każdego przepisanego pytania pokaż:

```text
Zamiast:
[złe pytanie]

Zapytaj:
[lepsze pytanie]

Dlaczego:
[jaki sygnał może ujawnić to pytanie]
```

### Krok 4: Utwórz przewodnik po wywiadach

Stwórz przewodnik po wywiadach na 20-30 minut:

1. **Rozgrzewka kontekstowa**: rola, przepływ pracy, częstotliwość.
2. **Ostatnia historia**: zapytaj o ostatnie rzeczywiste wystąpienie tarcia.
3. **Obecne obejście**: narzędzia, ludzie, artefakty, czas, błędy.
4. **Koszt bólu**: opóźnienia, przeróbki, ryzyko, obciążenie koordynacyjne.
5. **Istniejące alternatywy**: produkty, narzędzia, skrypty, pulpity nawigacyjne, ręczne nawyki lub rytuały.
6. **Sygnał decyzyjny**: co sprawiłoby, że warto to zmienić.
7. **Prośba o zamknięcie**: pozwolenie na dalszy kontakt lub sprawdzenie anonimowych artefaktów.

Dołącz 8-12 pytań. Zachowaj ich neutralność. Dodaj opcjonalne pytania uzupełniające dla interesujących odpowiedzi.

### Krok 5: Utwórz ankietę

Stwórz krótką ankietę dla szerszego sygnału:

- Maksymalnie 6-10 pytań.
- Preferuj zakresy wielokrotnego wyboru dla częstotliwości i wysiłku.
- Dołącz 1-2 pytania otwarte dotyczące ostatnich przykładów.
- Unikaj proszenia użytkowników o ocenę rozwiązania, którego nie doświadczyli.
- Dołącz jedno pytanie przesiewowe, które sprawdza, czy respondent faktycznie styka się z przepływem pracy.

Ankieta powinna dostarczyć dowodów do podjęcia decyzji o kontynuowaniu/niekontynuowaniu, a nie aplauzu.

### Krok 6: Zdefiniuj kryteria decyzyjne

Zakończ konkretnymi kryteriami:

- **Kontynuuj**, jeśli: [obserwowalny próg]
- **Zwęż zakres**, jeśli: [mieszany sygnał]
- **Nie buduj jeszcze**, jeśli: [słaby sygnał]
- **Najpierw wypróbuj istniejące narzędzie/proces**, jeśli: [istniejący produkt, narzędzie lub proces jest już wystarczająco dobry]

Użyj progów odpowiednich do kontekstu, na przykład:

- „Co najmniej 3 z 5 ankietowanych opisuje to samo niedawne obejście bez podpowiedzi.”
- „Co najmniej 40% ankietowanych użytkowników docelowych zgłasza, że dzieje się to co tydzień lub częściej.”
- „Ból kosztuje mierzalny czas, pieniądze lub przeróbki — a nie tylko łagodne irytacje.”

## Artefakt wyjściowy

Zaproponuj zapisanie wyniku do `context/team/mom-test-validation.md`, gdy istnieje katalog `context/` lub użytkownik chce trwałego artefaktu. Utwórz katalog `context/team/`, jeśli nie istnieje (`mkdir -p`). Jeśli użytkownik preferuje inną ścieżkę, użyj jej.

Użyj tej struktury:

```markdown
# Plan walidacji testu matki

## Pomysł wejściowy

[krótkie podsumowanie]

## Hipotezy

- **Użytkownik/rola**:
- **Tarcia**:
- **Obecne obejście**:
- **Ryzykowne założenia**:
- **Istniejące dowody**:

## Krytyka

[nie-tendencyjna krytyka]

## Przewodnik po wywiadach

[pytania + pytania uzupełniające]

## Ankieta

[pytania]

## Kryteria decyzyjne

- **Kontynuuj**:
- **Zwęż zakres**:
- **Nie buduj jeszcze**:
- **Najpierw wypróbuj istniejące narzędzie/proces**:
```