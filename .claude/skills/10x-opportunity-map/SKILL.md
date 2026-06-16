---
name: 10x-opportunity-map
description: >
  Turn recurring friction or an unmet need into a
  build-vs-buy-vs-complement-vs-wait decision artifact: an opportunity map with
  the existing/default response, a thin complement, a first useful version, and a
  data-risk caveat, plus one recommended candidate to try. Works for any idea —
  product, feature, internal tool, service, or automation — with a worked
  internal-builder lens. Use when someone wants to classify pain or signals,
  decide whether something is worth building before writing code, or sort a "let's
  build a dashboard / agent / app / automation" idea into build, buy, complement,
  or wait.
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Mapa możliwości: Klasyfikuj pomysły przed budowaniem

Ta umiejętność pomaga użytkownikowi zdecydować, czy powtarzające się tarcia lub niezaspokojone potrzeby powinny być obsługiwane przez istniejące narzędzie lub domyślny przepływ pracy, przez cienkie uzupełnienie tego, co już istnieje, przez pełniejszą budowę później, czy też wcale nie budować. Działa dla każdego pomysłu — produktu, funkcji, narzędzia wewnętrznego, usługi lub automatyzacji. Mapowanie możliwości to ogólna technika; przykłady używają **perspektywy wewnętrznego twórcy** (narzędzia zespołowe, usługi, automatyzacje), ponieważ to tam decyzja o budowaniu kontra kupowaniu jest najtrudniejsza i tam ścieżka wewnętrznego twórcy 10xDevs ją podejmuje.

Wynikiem jest artefakt decyzyjny, a nie plan implementacji. Nie pisz kodu SDK, konfiguracji CI, pakowania, uwierzytelniania, wdrażania, planowania ani kroków związanych z backlogiem/produktyzacją. Jeśli kandydat okaże się wartościowy, skieruj tę pracę dalej (patrz Krok 5).

Domyślnie używaj języka angielskiego. Przełącz się na polski (lub inny język), jeśli użytkownik napisze do Ciebie w tym języku.

## Początkowa odpowiedź

Po wywołaniu:

1. Jeśli użytkownik dostarczył sygnały tarcia, notatki, zgłoszenia, notatki ze spotkań lub ścieżkę pliku, przeczytaj/zarejestruj je i kontynuuj.
2. Jeśli nie podano konkretnych danych wejściowych, poproś o **3–5 powtarzających się tarć lub niezaspokojonych potrzeb** oraz **źródła** stojące za nimi (GitHub, Linear/Jira, CI, Slack, dokumentacja, zgłoszenia do wsparcia, analityka, wewnętrzna baza danych, CSV/dane testowe). Pozostaw to otwarte — tarcie jest swobodne; nie zmuszaj go do opcji.
3. Zarejestruj **ograniczenie danych** za pomocą AskUserQuestion, ponieważ zmienia to, jak lekka może być pierwsza wersja:

```
AskUserQuestion:
- question: "What data will the first version run on?"
  header: "Data"
  options:
  - label: "Mock / local / read-only / non-sensitive (Recommended)"
    description: "You can start light — no access control or auditing up front."
  - label: "Real company / customer / production data"
    description: "Access, permissions, and auditability thinking moves before implementation."
  - label: "Not sure yet"
    description: "We'll start from the least-sensitive variant and flag this as to-be-decided."
  multiSelect: false
```

Następnie wyjaśnij, że najpierw sklasyfikujesz sygnały, a dopiero potem zarekomendujesz pierwszego kandydata, jeśli na to zasłuży.

## Bariery ochronne

- Traktuj „zbudujmy pulpit nawigacyjny / agenta / aplikację / automatyzację” jako proponowane rozwiązanie, a nie sygnał tarcia. Zapytaj, jaki powtarzający się ból, opóźnienie, koszt koordynacji lub ręczne sprawdzenie usuwa.
- Domyślne ogólne/użytkowe przepływy pracy do SaaS lub istniejących narzędzi, chyba że użytkownik wykaże lokalne tarcie między systemami.
- Preferuj uzupełnianie systemów źródłowych zamiast ich zastępowania. Pierwsza wersja może zawierać linki do PR-ów, zgłoszeń, zadań, dokumentacji i rekordów; nie może udawać, że stanie się nowym systemem rekordów.
- Zachowaj pierwszą użyteczną wersję wąską, lokalną, tylko do odczytu i łatwą do odrzucenia: skrypt, statyczny raport, podsumowanie CSV, widok podobny do arkusza kalkulacyjnego lub testowy pulpit nawigacyjny.
- Wcześnie eskaluj ryzyko związane z danymi. Dane testowe/lokalne/tylko do odczytu/nieczułe mogą pozostać lekkie. Prawdziwe dane firmowe/klientów wymagają przemyślenia kontroli dostępu i audytowalności przed implementacją.
- Zwróć uwagę na złożoność istotną vs. przypadkową. Niektóre tarcia są przypadkowe, a cienkie uzupełnienie rzeczywiście je skraca; niektóre są istotne i odzwierciedlają rzeczywiste ograniczenie lub decyzję. Zanim nazwiesz tarcie „naprawialnym”, sprawdź, czy nie jest to tarcie, które istnieje z jakiegoś powodu.
- Nie sugeruj wyników (kariera, wzrost, przychody). Dźwignia oznacza zmniejszenie prawdziwego bólu i zdobycie zaufania, a nie gwarantowany wynik.

## Proces

### Krok 1: Normalizuj sygnały

Przekształć surowe pomysły w konkretne sygnały. Dobre sygnały są obserwowalne i powtarzalne:

- „Każdego ranka ręcznie sprawdzamy, które PR-y blokują wydanie.”
- „Zgłoszenia i zmiany w kodzie rozchodzą się, więc trudno ufać statusowi.”
- „Umiejętności i zasady AI są kopiowane między repozytoriami ręcznie.”
- „Komentarze do recenzji powtarzają się, ale nie są kodowane jako brama jakości.”

Słabe sygnały wymagają rozpakowania:

- „Zbuduj pulpit nawigacyjny.”
- „Dodaj agenta.”
- „Zautomatyzuj wszystko.”

Dla każdego słabego sygnału zadaj jedno krótkie pytanie, które oddziela ból od proponowanego rozwiązania.

### Krok 2: Sklasyfikuj każdy sygnał

Przejdź przez sygnały **pojedynczo**, jako blok na sygnał — nie renderuj szerokiej tabeli w trakcie rozmowy. Każdy blok jest łatwiejszy do odczytania i reakcji, i pozwala użytkownikowi poprawić jeden sygnał, zanim przejdziesz dalej:

```text
Sygnał: [powtarzający się obserwowalny ból lub niezaspokojona potrzeba]
  Istniejąca / domyślna odpowiedź: [co już robią istniejące narzędzia lub przepływy pracy]
  Cienkie uzupełnienie: [najmniejsze uzupełnienie wokół istniejących systemów]
  Pierwsza użyteczna wersja: [lokalne/tylko do odczytu/testowe sprawdzenie]
  Ryzyko danych: [testowe / lokalne / tylko do odczytu / nieczułe / prawdziwe dane firmowe-klientów]
  Kierunek, jeśli okaże się wartościowy: [produkt / funkcja / narzędzie wewnętrzne / usługa / czekaj]
```

Wskazówki dla każdego pola — zachowaj zwięzłe komórki tabeli (fraza, a nie akapit); dłuższe uzasadnienie przenieś do Kroku 4 i notatki „Dlaczego ten kandydat”:

- **Sygnał**: powtarzający się obserwowalny ból lub niezaspokojona potrzeba, najlepiej z kosztem koordynacji.
- **Istniejąca / domyślna odpowiedź**: co już robią GitHub, Linear/Jira, Slack, Notion, CI, pulpity nawigacyjne, natywne podsumowania AI, raporty, filtry, gotowe SaaS lub istniejące procesy.
- **Cienkie uzupełnienie**: uzupełnienie wokół istniejących systemów, zwłaszcza gdy wartość pochodzi z połączenia dwóch lub więcej źródeł.
- **Pierwsza użyteczna wersja**: lokalna/tylko do odczytu/testowa wersja, która waliduje wartość bez pełnej odpowiedzialności za produkt.
- **Ryzyko danych**: `testowe`, `lokalne`, `tylko do odczytu`, `nieczułe` lub `prawdziwe dane firmowe/klientów`; dodaj praktyczne zastrzeżenie, gdy dane są wrażliwe.
- **Kierunek, jeśli okaże się wartościowy** — rodzaj rzeczy, w którą się rozwinie, gdy zdobędzie regularnego użytkownika. Najpierw wybierz ogólny kształt: `Produkt`, `Funkcja` w istniejącym produkcie, `Narzędzie wewnętrzne`, `Usługa` lub `Czekaj / nie buduj` (sygnał słaby, już rozwiązany lub nie warty utrzymania). Gdy kształtem jest **narzędzie wewnętrzne**, ścieżki wewnętrznego twórcy 10xDevs go dopracowują:
  - `Agent zespołu`, gdy potrzebuje SDK, narzędzi, wywołań modelu, obsługi kosztów/prywatności lub metryk.
  - `Brama recenzji / CI`, gdy wartość to przegląd kodu, bramy PR, Definicja Ukończenia lub zachowanie CI.
  - `Wspólny rejestr artefaktów`, gdy problemem są wspólne umiejętności, podpowiedzi, zasady, polecenia, pakiety lub dystrybucja artefaktów zespołu.
  - `Praca asynchroniczna / zdalna`, gdy pomocnik powinien działać zdalnie, asynchronicznie lub zgodnie z harmonogramem.

Po sklasyfikowaniu wszystkich sygnałów możesz je odczytać jako zwięzłą tabelę porównawczą (jeden wiersz na sygnał, zwięzłe komórki) — ta skanowalna macierz trafia do zapisanego artefaktu.

### Krok 3: Poleć jednego kandydata

Wybierz maksymalnie jednego kandydata dla pierwszej użytecznej wersji. Oceń według:

1. Powtarza się regularnie.
2. Łączy co najmniej dwa źródła informacji lub dwie role.
3. Ma dziś wyraźny ból ręczny.
4. Może być testowany tylko do odczytu lub na danych testowych/eksportowanych.
5. Nie zastępuje odpowiedzialności istniejącej platformy.
6. Ma jasny późniejszy kierunek, jeśli okaże się wartościowy.

Jeśli żaden sygnał nie przejdzie, zalecaj brak budowy i wyjaśnij, które istniejące narzędzie lub domyślna odpowiedź powinny być wypróbowane jako pierwsze. Zbudowanie dwóch lub trzech przemyślanych kandydatów jest lepsze niż wysłanie dziesięciu prototypów, których nikt nie utrzymuje — rzadkim zasobem jest uwaga, aby je utrzymać przy życiu, a nie czas na ich rozpoczęcie.

### Krok 4: Opracuj pierwszą użyteczną wersję

Dla wybranego kandydata napisz:

```text
Kandydat:
[nazwa robocza]

Odczytuje:
[źródła, np. eksport GitHub, CSV Jira, logi CI, dane testowe]

Zwraca:
[krótki opis raportu/widoku/podsumowania]

Nie robi:
[co jest celowo wykluczone teraz]

Ryzyko danych:
[testowe/lokalne/tylko do odczytu/nieczułe lub prawdziwe dane firmowe/klientów; dla prawdziwych danych, powiedz, jakie ograniczenie dostępu musi nastąpić najpierw]

Kierunek, jeśli okaże się wartościowy:
[produkt / funkcja / narzędzie wewnętrzne / usługa / czekaj]
```

Następnie dodaj krótką notatkę „Dlaczego ten, a nie inne”.

### Krok 5: Zdecyduj o następnym ruchu

Mapa możliwości klasyfikuje problem na papierze. Zanim przekształcisz klasyfikację w kod, zdecyduj, jak postępować:

```
AskUserQuestion:
- question: "You have a map and a candidate. What next?"
  header: "Next"
  options:
  - label: "Validate, then shape — /10x-mom-test → /10x-shape (Recommended)"
    description: "Pressure-test the problem in conversations about past behavior. If it survives, the validated opportunity feeds /10x-shape → /10x-prd → /10x-roadmap."
  - label: "Shape now without validating — /10x-shape → /10x-prd → /10x-roadmap"
    description: "Only when you are already confident the problem is real and the risk is understood. Skips the cheapest evidence step."
  - label: "Go straight to building — /10x-new → /10x-research → /10x-plan → /10x-implement"
    description: "When the signal is narrow, the first version is clear, and the risks are understood."
  - label: "Nothing for now"
    description: "Save the map and come back when more signals accumulate."
  multiSelect: false
```

Niezależnie od wybranej ścieżki, najtańszym pierwszym krokiem jest zazwyczaj krótka rozmowa z osobami, które żyją z tarciem (w przypadku narzędzia wewnętrznego, menedżer i zespół, dla którego jest przeznaczone) — często wiedzą, dlaczego tarcie istnieje i czy Twój obraz jest kompletny. W swojej wiadomości końcowej podaj nazwę wybranej umiejętności; nie uruchamiaj jej samodzielnie, chyba że użytkownik o to poprosi.

## Artefakt

Zaproponuj zapisanie wyniku. Użyj AskUserQuestion:

```
AskUserQuestion:
- question: "Save the opportunity map to a file?"
  header: "Save"
  options:
  - label: "Yes — context/team/opportunity-map.md (Recommended)"
    description: "The standard path. I'll create the directory if it's missing."
  - label: "Different path"
    description: "Give your own file location."
  - label: "Don't save"
    description: "Keep the map in the conversation only."
  multiSelect: false
```

Podczas pisania utwórz katalog docelowy, jeśli to konieczne (`mkdir -p`). Użyj tego kształtu pliku:

```markdown
# Mapa możliwości

## Kontekst

- **Projekt / kontekst**:
- **Ograniczenie danych**:
- **Data**:

## Mapa

Jeden wiersz na sygnał, zwięzłe komórki (po jednej frazie) — dłuższe uzasadnienie należy do poniższych sekcji:

| Sygnał | Istniejąca / domyślna odpowiedź | Cienkie uzupełnienie | Pierwsza użyteczna wersja | Ryzyko danych | Kierunek, jeśli wartościowy |
|---|---|---|---|---|---|

## Zalecany pierwszy kandydat

[blok pierwszej użytecznej wersji]

## Dlaczego ten kandydat

[krótkie uzasadnienie]

## Następny kierunek, jeśli wartościowy

[kierunek i uzasadnienie]
```