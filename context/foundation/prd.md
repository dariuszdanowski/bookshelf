---
project: "BookShelf Scanner"
version: 1
status: draft
created: 2026-05-19
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 6
  hard_deadline: 2026-07-05
  after_hours_only: true
---

# BookShelf Scanner — Product Requirements Document

## Vision & Problem Statement

Dorośli czytelnicy z prywatnymi kolekcjami książek liczącymi ~1000+ tytułów nie mają katalogu swoich półek, bo ręczne wpisanie każdej pozycji w istniejących serwisach katalogowych zajmuje wiele godzin, a skanowanie kodów kreskowych ISBN działa pojedynczo i wymaga, by każdy egzemplarz miał czytelny kod (klasyczne wydania sprzed lat 80. i samizdat go nie mają). Konsekwencje są mierzalne i powtarzalne: kupowanie duplikatów w księgarni, niemożność szybkiego zlokalizowania konkretnej książki w domu, gdy pamiętane są tylko atrybuty pośrednie ("ta z czerwonym grzbietem, coś o smokach, wydawnictwo Iskry, lata 80."), oraz perpetuum mobile odkładania katalogowania, bo próg wejścia zabija nawyk.

Sednem problemu jest **koszt onboardingu**, nie braki funkcjonalne istniejących narzędzi — a okno technologiczne automatycznego rozpoznawania obrazów otworzyło się w latach 2024–2026 i po raz pierwszy umożliwia przekształcenie zdjęcia półki w skatalogowane wpisy w minutach, nie godzinach. Dodatkowo: **atrybuty wizualne grzbietu** (dominujący kolor, typ oprawy) **nie istnieją jako structured data w żadnej publicznej bazie książek** — muszą być ekstrahowane ze zdjęcia własnej półki, czego żaden istniejący produkt nie robi. To, w połączeniu z faktem, że dominujące serwisy czytelnicze optymalizują dla społecznościowego grafu (recenzje, znajomi), a nie dla nawigacji po prywatnej kolekcji, oraz że target 1000+ książek to nisza poniżej radaru mainstream product managerów, wyjaśnia, dlaczego przez kilkanaście lat nikt tego nie zbudował.

## User & Persona

**Persona główna:** dorosły kolekcjoner z prywatną biblioteką **>1000 książek** rozłożonych na wielu regałach w domu. Pamięta swoje preferencje czytelnicze, ale **nie pamięta szczegółowo, co już ma** — zwłaszcza pozycji kupionych pięć lat temu lub wcześniej. Dwie sytuacje wyzwalają potrzebę katalogu (oba momenty równo ważone, oba musi adresować MVP):

- **W księgarni / na targach / przy paczce ze sklepu internetowego:** "Czy już to mam? Czy mam tom 4 *Wiedźmina*, czy tylko 1–3?". Otwiera telefon, szybkim sprawdzeniem w katalogu uniknie duplikatu.
- **W domu, przy regale:** "Gdzie była ta czerwona o smokach z lat 80., wydawnictwo Iskry?". Przewijanie listy 1000 pozycji jest bezużyteczne — katalog musi być przeszukiwalny po **atrybutach pośrednich** (kolor grzbietu, fragment tytułu / autora / wydawnictwa / opisu, dekada wydania, typ oprawy). Bez tego katalog 1000+ książek nie służy do nawigacji, tylko do pasywnego "wiem, że mam".

Persona **nie szuka** kolejnej sieci społecznościowej dla czytelników, recenzji znajomych ani rekomendacji "co przeczytać dalej". Szuka narzędzia osobistego, które wytworzy katalog bez kilkudziesięciu godzin wpisywania i pozwoli go używać do nawigacji po fizycznej kolekcji.

Pojedynczy użytkownik = pojedyncza kolekcja. Współdzielenie półek między domownikami / rodziną / przyjaciółmi **nie jest częścią MVP** (świadomy non-goal — patrz `## Non-Goals`).

## Success Criteria

### Primary

Cztery KPI, których niespełnienie oznacza, że produkt nie dostarcza wartości (nawet jeśli technicznie działa):

- **Recall rozpoznawania ≥ 70%**: na uśrednionym zdjęciu półki system rozpoznaje co najmniej 7 z 10 widocznych grzbietów. Pomiar: zestaw 5–10 zdjęć kontrolnych pochodzących z realnych regałów (zróżnicowane wydania, polskie + angielskie tytuły) etykietowanych ręcznie; recall liczony jako stosunek rozpoznanych grzbietów do faktycznie widocznych.
- **Acceptance rate ≥ 75%** (Flow A): co najmniej 3 na 4 propozycje pokazane użytkownikowi są akceptowane bez korekty pól *tytuł* / *autor*. Korekty pól pomocniczych (wydawnictwo, rok wydania) liczone osobno z luźniejszym progiem. Pomiar: log korekt vs łączna liczba propozycji w danym oknie czasowym.
- **Time-to-first-shelf ≤ 5 minut** (Flow A): od momentu zakończenia rejestracji nowego użytkownika do pierwszej zaakceptowanej półki (~15–20 książek) upływa nie więcej niż 5 minut. Pomiar: znacznik czasu utworzenia konta vs znacznik czasu zatwierdzenia pierwszej półki.
- **Find-in-house success ≥ 80%** (in-home moment): użytkownik szukający książki po wskazówkach pośrednich (kolor grzbietu + fragment tytułu / autora / wydawnictwa) znajduje ją w ≤ 3 zwracanych wynikach w co najmniej 8 na 10 prób testowych. Pomiar: ręczny test scenariuszowy na realnej kolekcji testowej (~50–100 książek).

### Secondary

Mierniki "wartość ponad MVP" — niezbędne nie są, ale ich brak osłabia narrację:

- **Time-to-add-purchase ≤ 90 s** (Flow B): od kliknięcia "Dodaj zakup" do zatwierdzonej pozycji na półce "Zakupione" (jedna książka, ręczne wpisanie, bez zdjęcia). Próg krytyczny dla **utrzymania nawyku** — Flow B będzie używany dziesiątki razy w roku, podczas gdy Flow A raz przy onboardingu.
- **Duplicate-purchase prevention** (jakościowe): użytkownik raportuje co najmniej jeden moment "sprawdziłem w księgarni i nie kupiłem duplikatu" w ciągu pierwszych 4 tygodni używania. Mierzone wywiadem / krótkim formularzem, nie automatycznie.
- **Time-to-full-catalog ≤ 4 h** dla kolekcji 1000 książek na ~30 półkach (≈ 8 minut na półkę przy akceptacji bez większych korekt). Pomiar: jednorazowy test manualny na realnym regale testowym; dowodzi skalowalności automatycznego rozpoznawania.

### Guardrails

Cechy, których naruszenie traktujemy jako regresję, nawet jeśli Primary KPI nadal są zielone:

- **Prywatność**: użytkownik A pod żadnym warunkiem nie widzi danych użytkownika B. Zapytanie z prawidłowymi danymi uwierzytelnienia A o identyfikator zasobu należącego do B zwraca jednoznaczny brak ("nie ma takiego zasobu"), bez ujawniania, że taki zasób istnieje dla innego użytkownika.
- **Brak utraty danych po awarii**: zdjęcie wgrane do systemu, ale jeszcze nieprzetworzone, nie znika po awarii, restarcie ani błędzie sieci. Ponowne uruchomienie przetwarzania nie tworzy duplikatów detekcji ani książek.
- **p95 < 1 s na widokach nawigacji** (lista półek, widok półki, wyniki wyszukiwarki dla zapytania zwracającego do ~1000 wyników): bo katalog ma służyć do szybkiego sprawdzania w księgarni i w domu. Wyjątek: widok przetwarzania zdjęcia — tam akceptujemy widoczne wskaźniki postępu do 30 s, pod warunkiem że użytkownik widzi ciągłą informację o postępie.

## User Stories

### US-01: Bootstrap pierwszej półki (Flow A — primary path)

- **Given** świeżo zarejestrowany użytkownik bez żadnych półek w katalogu
- **When** utworzy półkę "Salon, ściana zachodnia", wgra zdjęcie tej półki, poczeka aż przetwarzanie zdjęcia zakończy się, a następnie zaakceptuje wszystkie propozycje z pewnością dopasowania ≥ 0.75
- **Then** widzi katalog tej półki z okładkami książek w kolejności "od lewej", każda z domyślnym statusem przeczytania = nie przeczytana, a czas od kliknięcia "Utwórz konto" do zaakceptowanej półki nie przekracza 5 minut (15–20 książek)

#### Acceptance Criteria
- Automatyczne rozpoznawanie wykrywa ≥ 70% widocznych grzbietów na zdjęciu testowym
- ≥ 75% propozycji ma pewność dopasowania ≥ 0.75 i jest pre-zaznaczonych do akceptacji
- Po akceptacji widok półki ładuje się w < 1 s (p95)
- Status przeczytania każdej nowej książki domyślnie = "nie przeczytana"
- Jeśli przetwarzanie zdjęcia padnie, użytkownik może uruchomić je ponownie bez tracenia istniejących detekcji ani tworzenia duplikatów

### US-02: Dodanie zakupu z księgarni (Flow B)

- **Given** zalogowany użytkownik z istniejącym katalogiem
- **When** otworzy akcję "Dodaj zakup", wybierze "wpisanie ręczne", wpisze tytuł i autora jednej książki, ustawi datę zakupu (domyślnie = dziś) i zatwierdzi
- **Then** książka pojawia się na wirtualnej półce "Zakupione" z zapisaną datą zakupu, status przeczytania = "nie przeczytana", cały przepływ trwa ≤ 90 sekund

#### Acceptance Criteria
- "Dodaj zakup" jest dostępne z każdego głównego widoku katalogu
- Półka "Zakupione" jest tworzona automatycznie przy rejestracji i nie wymaga ręcznej konfiguracji
- Książka z półki "Zakupione" jest indeksowana w wyszukiwarce identycznie jak książki z półek fizycznych
- Użytkownik może w dowolnym momencie przenieść książkę z "Zakupione" na fizyczną półkę bez utraty daty zakupu

### US-03: Sprawdzenie w księgarni (in-bookstore moment)

- **Given** zalogowany użytkownik stojący w księgarni z telefonem
- **When** wpisze w wyszukiwarce katalogu fragment tytułu książki, którą rozważa kupić
- **Then** widzi w wynikach informację, czy już ma tę książkę w katalogu (z nazwą półki i statusem przeczytania), w czasie < 1 s od wpisania zapytania

#### Acceptance Criteria
- Wyszukiwarka pełnotekstowa działa po fragmencie tytułu (nie wymaga pełnego tytułu)
- Wynik pokazuje nazwę półki i status przeczytania dla każdej znalezionej książki
- Brak wyników wyświetla jednoznaczny komunikat "nie masz tej książki" (nie pustą listę)

### US-04: Znalezienie książki w domu po atrybutach pośrednich (in-home moment)

- **Given** zalogowany użytkownik szukający konkretnej książki w domowej kolekcji liczącej kilkaset pozycji
- **When** pamięta tylko fragmenty: "czerwony grzbiet, coś o smokach, wydawnictwo Iskry" i wpisze "smok" w wyszukiwarce, ustawi filtr koloru grzbietu = "czerwony"
- **Then** widzi listę ≤ 3 kandydatów, w której znajduje się szukana książka, z nazwą półki i pozycją na półce

#### Acceptance Criteria
- Wyszukiwanie pełnotekstowe obejmuje pole krótki opis z publicznej bazy książek (nie tylko tytuł)
- Filtr koloru grzbietu jest kombinowalny z polem tekstowym
- Wyniki pokazują dla każdej książki: nazwę półki + pozycję na półce ("od lewej")
- Łączne wyniki dla kolekcji ~50–100 książek testowych mieszczą się w ≤ 3 pozycjach w ≥ 80% prób testowych

## Functional Requirements

### Autentykacja i konto

- FR-001: Niezalogowany użytkownik może utworzyć konto przez email + hasło. Priority: must-have
- FR-002: ~~Niezalogowany użytkownik może utworzyć konto przez zewnętrznego dostawcę tożsamości (single sign-on).~~ **DEFERRED do post-MVP** (zgodnie z rundą Socratesa w `/10x-shape` Phase 4.5).
  > Socrates: Counter-argument considered: "nice-to-have w MVP często = 'nigdy', bo czas się kończy; lepiej szczerze wycofać do post-MVP niż utrzymywać pozór gotowości." Resolution: dropped from MVP; wpisany do Non-Goals jako świadomy post-MVP follow-up. Email + hasło wystarcza do dowiezienia w oknie czasowym.
- FR-003: Zalogowany użytkownik widzi tylko dane przypisane do swojego konta (półki, książki, zdjęcia, sygnały telemetryczne). Priority: must-have
- FR-004: Niezalogowany użytkownik próbujący wejść na chronioną ścieżkę aplikacji jest przekierowywany na ekran logowania. Priority: must-have

### Półki — CRUD i organizacja

- FR-005: Użytkownik może utworzyć półkę, podając nazwę i opcjonalnie lokalizację domową (np. "Salon, ściana zachodnia"). Priority: must-have
- FR-006: Użytkownik może edytować nazwę i lokalizację własnej półki. Priority: must-have
- FR-007: Użytkownik może usunąć własną półkę; książki znajdujące się na niej trafiają na wirtualną półkę "Zakupione" (nigdy nie znikają z katalogu wraz z półką). Priority: must-have
  > Socrates: Counter-argument considered: "nieintuicyjne — user może myśleć, że usuwa też książki." Resolution: kept; obowiązkowy explicit confirm dialog pokazujący liczbę książek do przesunięcia ("Usuwasz półkę X. 47 książek przejdzie na półkę Zakupione. Potwierdź."). Defensywne UX > ukryta semantyka.
- FR-008: Użytkownik ma jedną systemową wirtualną półkę "Zakupione" tworzoną automatycznie przy rejestracji, której nie może usunąć ani zmienić nazwy. Priority: must-have
- FR-009: Użytkownik może przeglądać listę swoich półek z liczbą książek na każdej. Priority: must-have

### Upload zdjęcia i przetwarzanie

- FR-010: Użytkownik może wgrać jedno zdjęcie półki (drag-and-drop lub wybór z dysku) przypisane do wybranej fizycznej półki. Priority: must-have
  > Socrates: Counter-argument considered: "regal z 4 półkami = 4 oddzielne uploady, może to za dużo tarcia przy kolekcji 30+ półek." Resolution: kept; automatyczne rozpoznawanie lepiej radzi sobie z pojedynczą półką (ramy odniesienia), interfejs jest jednoznaczny, multi-shelf detection to przedwczesna optymalizacja przy MVP. Batch upload sekwencyjny jako post-MVP follow-up, jeśli telemetria pokaże tarcie.
- FR-011: System automatycznie przetwarza wgrane zdjęcie i wydobywa listę detekcji grzbietów (tytuł, autor, pewność dopasowania, dominujący kolor grzbietu z palety ~10 nazwanych kolorów). Priority: must-have
- FR-012: System pokazuje status przetwarzania zdjęcia (pending / processing / done / failed) z widocznym wskaźnikiem postępu dla operacji trwających > 2 s. Priority: must-have
- FR-013: System persistuje wszystkie detekcje przed rozpoczęciem matchingu z publicznymi bazami (idempotencja przy retry). Priority: must-have
- FR-014: Przy nieudanym przetworzeniu (timeout, błąd modelu, niezgodność kontraktu danych) użytkownik może uruchomić przetwarzanie ponownie bez tworzenia duplikatów detekcji. Priority: must-have

### Matching z publiczną bazą i propozycje

- FR-015: Dla każdej detekcji system odpytuje publiczną bazę książek (z fallbackiem do drugiego źródła) i wybiera kandydatów z metadanymi: tytuł, autor(zy), wydawnictwo, rok wydania, ISBN, okładka, krótki opis. Priority: must-have
  > Socrates: Counter-argument considered: "polskie wydania z lat 80. / samizdat mogą nie istnieć w żadnej publicznej bazie." Resolution: kept; jeśli żaden kandydat nie ma pewności dopasowania ≥ 0.55, propozycja brzmi "brak matchu — wpisz ręcznie", a FR-021 obsługuje tę ścieżkę. Detekcja jest persistowana niezależnie od dostępności matchu — żadna informacja z rozpoznawania nie znika.
- FR-016: System liczy pewność dopasowania dla każdego kandydata (podobieństwo tytułu × podobieństwo autora + bonus za zgodność ISBN) i progresji wyniku: ≥ 0.75 = propozycja pre-zaznaczona do akceptacji, 0.55–0.75 = wymaga explicit potwierdzenia użytkownika, < 0.55 = "wpisz ręcznie". Priority: must-have
  > Socrates: Counter-argument considered: "te progi są arbitralne, nie testowane na realnych danych." Resolution: kept jako wartości startowe; Acceptance rate ≥ 75% jest Primary KPI, telemetria korekt pokaże, czy progi wymagają strojenia. Tuning po pierwszym miesiącu używania — wpisany jako follow-up w `## Open Questions`.
- FR-017: Przed pokazaniem propozycji system sprawdza, czy użytkownik już ma daną książkę w katalogu (po zgodności ISBN lub fuzzy-match tytuł + autor) i flaguje ją jako "duplikat z półki X". Priority: must-have
  > Socrates: Counter-argument considered: "co znaczy 'duplikat' przy różnych wydaniach tej samej książki (np. Diuna Iskry '86 vs Rebis '03)?" Resolution: kept; różne ISBN = różne rekordy książek (kolekcjoner widzi, że ma trzy Diuny), ale interfejs pokazuje flagę "masz inną edycję tej książki" przy propozycji — user świadomie decyduje, czy to nowy egzemplarz, czy duplikat. ISBN jest dominującym sygnałem dedupe, fuzzy tytuł + autor to fallback dla książek bez ISBN.
- FR-018: Użytkownik widzi listę propozycji per zdjęcie: dla każdego rozpoznanego grzbietu — najlepiej dopasowana książka + 2–4 alternatywy + akcje **accept / reject / correct**. Priority: must-have
- FR-019: Użytkownik może edytować pola propozycji (tytuł, autor, wydawnictwo, rok) przed jej zaakceptowaniem; korekta jest zapisywana jako sygnał telemetryczny powiązany z detekcją. Priority: must-have
- FR-020: Użytkownik może odrzucić propozycję (np. system wymyślił grzbiet, którego nie ma); odrzucenie jest zapisywane jako sygnał telemetryczny typu "reject". Priority: must-have
- FR-021: Użytkownik może wpisać książkę ręcznie (tytuł + autor + opcjonalnie wydawnictwo, rok, ISBN), gdy żadna propozycja nie pasuje lub gdy chce dodać książkę bez zdjęcia. Priority: must-have
  > Socrates: Counter-argument considered: "równoległa ścieżka manual może zachęcić do unikania automatycznego rozpoznawania i obniżyć jego adoption." Resolution: kept; rozpoznawanie i manual to dwie komplementarne ścieżki, nie konkurencyjne. Manual jest "safety net" dla książek bez ISBN (polskie wydania lat 80., samizdat) i niezbędny dla 90 s Time-to-add-purchase w Flow B. Bez manual user blokuje się przy edge case'ach.

### Katalog i status przeczytania

- FR-022: Po akceptacji propozycji książka trafia do katalogu z domyślnym statusem przeczytania "nie przeczytana" i przypisaną pozycją na półce ("od lewej"). Priority: must-have
- FR-023: Użytkownik może przełączyć status przeczytania książki (przeczytana ↔ nie przeczytana) jednym kliknięciem w widoku półki lub w widoku książki. Priority: must-have
- FR-024: Użytkownik widzi pojedynczą półkę z książkami w kolejności od lewej, z okładkami i znacznikami statusu przeczytania. Priority: must-have

### Flow B — Nowy zakup

- FR-025: Użytkownik może otworzyć akcję "Dodaj zakup" z dowolnego widoku katalogu. Priority: must-have
- FR-026: W ramach akcji "Dodaj zakup" użytkownik może wybrać metodę: zdjęcie stosu (uruchamia automatyczne rozpoznawanie) LUB wpisanie ręczne. Priority: must-have
- FR-027: Książki dodane przez akcję "Dodaj zakup" trafiają na wirtualną półkę "Zakupione" zamiast na fizyczną. Priority: must-have
- FR-028: Użytkownik może opcjonalnie wpisać datę zakupu (domyślnie = dziś) na każdej zaakceptowanej książce w Flow B. Priority: must-have
  > Socrates: Counter-argument considered: "bez okoliczności zakupu sama data daje mało, to komplikacja UI za nic." Resolution: kept; data sama umożliwia sortowanie "co kupiłem w 2025", pole opcjonalne nie tworzy tarcia (domyślnie = dziś, jedno enter wystarczy). Okoliczność świadomie wycięta do post-MVP — strukturalne pole + autouzupełnianie naruszyłyby KPI 90 s w Flow B.
- FR-029: Każda książka w katalogu istnieje na dokładnie jednej "półce" (fizycznej lub wirtualnej "Zakupione") — nie ma stanu "bez półki". Priority: must-have
  > Socrates: Counter-argument considered: "co jeśli user chce książkę 'odlozoną' — nie na półce, nie w 'Zakupione', tylko 'wyniosłem do biura'?" Resolution: kept; user tworzy fizyczną półkę o nazwie "Biuro" albo "Wypożyczone" — rozszerza model przez samą nazwę, bez nowych pól ani statusów. Brak stanu "limbo" upraszcza statystyki, walidację i widoki.

### Przekładanie książek

- FR-030: Użytkownik może przenieść książkę z dowolnej półki (w tym "Zakupione") na inną półkę przez akcję "Przenieś na półkę X". Priority: must-have
- FR-031: Po przeniesieniu data zakupu i ewentualne ręczne metadane książki pozostają na rekordzie książki (nie znikają wraz z półką źródłową). Priority: must-have

### Wyszukiwarka katalogu

- FR-032: Użytkownik może wyszukać książkę pełnotekstowo po tytule, autorze, wydawnictwie i krótkim opisie z publicznej bazy. Priority: must-have
- FR-033: Użytkownik może filtrować wyniki po **kolorze grzbietu** (paleta ~10 nazwanych kolorów). Priority: must-have
  > Socrates: Counter-argument considered: "czy ~10 kolorów wystarczy, a co jeśli rozpoznawanie raz da 'green', raz 'dark-green' dla tego samego grzbietu?" Resolution: kept; system rozpoznawania otrzymuje w trakcie wywołania zamkniętą listę dozwolonych enum-ów, walidacja wyjścia odrzuca i ponawia odpowiedzi spoza zbioru, przy fallback do "inny" user może ręcznie poprawić. Spójność wymuszona od strony walidacji, nie modelu. Paleta jako część kontraktu rozpoznawania jest jednym z load-bearing artefaktów MVP.
- FR-034: Użytkownik może filtrować wyniki po półce (multi-select). Priority: must-have
- FR-035: Użytkownik może filtrować wyniki po statusie przeczytania (przeczytana / nie przeczytana / wszystko). Priority: must-have
- FR-036: Użytkownik może kombinować wyszukiwanie pełnotekstowe z dowolnym zestawem filtrów (kolor + półka + status przeczytania). Priority: must-have

### Telemetria

- FR-037: System zapisuje każdą korektę (zmiana pola tytuł / autor / wydawnictwo / rok, akceptacja, odrzucenie, ręczne dodanie) jako sygnał telemetryczny powiązany z detekcją i użytkownikiem. Priority: must-have
- FR-038: System zapisuje przeniesienia książek między półkami jako wersjonowaną historię lokalizacji (poprzednia lokalizacja oznaczana jako historyczna, nowa jako aktualna), tak by katalog mógł odpowiedzieć "gdzie ta książka jest dziś i gdzie była wcześniej". Priority: must-have
- FR-039: System zapisuje koszt jednostkowy (USD) i czas trwania każdego wywołania automatycznego rozpoznawania na rekordzie zdjęcia, tak by możliwe było ustalenie kosztu jednostkowego przetworzonej półki bez inspekcji kodu. Priority: must-have

## Non-Functional Requirements

- Użytkownik widzi potwierdzenie wgrania zdjęcia w czasie < 200 ms od kliknięcia, a postęp przetwarzania zdjęcia jest ciągle widoczny dla operacji trwających dłużej niż 2 sekundy.
- Po zalogowaniu widoki nawigacji po katalogu (lista półek, widok pojedynczej półki, wyniki wyszukiwarki dla zapytania zwracającego do ~1000 pozycji) reagują w czasie p95 < 1 s mierzonym od kliknięcia do pełnego renderu.
- Użytkownik A pod żadnym warunkiem nie widzi danych użytkownika B; zapytanie z prawidłowymi danymi uwierzytelnienia A o identyfikator zasobu należącego do B zwraca jednoznaczny brak ("nie ma takiego zasobu"), bez ujawniania, że taki zasób istnieje dla innego użytkownika.
- Zdjęcie wgrane do systemu, ale jeszcze nieprzetworzone, nie znika po awarii, restarcie ani błędzie sieci; ponowne uruchomienie przetwarzania nie tworzy duplikatów detekcji ani książek.
- Aplikacja jest w pełni używalna na dwóch najnowszych wersjach głównych przeglądarek desktop (Chrome, Firefox, Safari, Edge); dla momentu in-bookstore widoki **wyszukiwarki katalogu, widoku książki i widoku półki** są czytelne i funkcjonalne na telefonach z ekranami od 360 px szerokości w portrait orientation.
- Interfejs użytkownika jest **w całości po polsku**; brak przełącznika języka i brak osobnych ścieżek lokalizacyjnych w MVP.
- Treść interfejsu spełnia podstawowe wymogi dostępności: semantyczny HTML, kontrast tekstu względem tła ≥ 4.5:1 dla normalnego tekstu, widoczny focus state na elementach interaktywnych, alt-texty na okładkach książek (tytuł + autor). Pełny audit WCAG-AA świadomie poza scope MVP.
- Każde wywołanie automatycznego rozpoznawania ma zarejestrowany koszt (USD) i czas trwania dostępne operatorowi, tak aby możliwe było ustalenie kosztu jednostkowego przetworzonej półki bez inspekcji kodu.

## Business Logic

BookShelf przekształca pojedyncze zdjęcie półki w listę propozycji wpisów do osobistego katalogu książek, gdzie każda propozycja niesie mierzalną pewność dopasowania do publicznej bazy oraz informację o ewentualnym duplikacie w katalogu użytkownika — użytkownik akceptuje, koryguje lub odrzuca, a system rejestruje każdą decyzję jako sygnał uczący.

Reguła konsumuje **dwa rodzaje wejścia użytkownika**: (1) zdjęcie półki wgrane jednorazowo dla danej fizycznej lokalizacji, (2) ręczny wpis tytułu i autora dla książek, które automatyczne rozpoznawanie pomija lub które nie istnieją w publicznych bazach. Wejście pierwsze uruchamia pełen łańcuch identyfikacji; wejście drugie pomija identyfikację i wchodzi bezpośrednio do katalogu z pewnością "manual = 1.0". Oba kończą się tym samym artefaktem: pozycją w katalogu książek użytkownika z lokalizacją na półce, statusem przeczytania i metadanymi pochodzącymi z publicznej bazy.

Wyjściem reguły dla każdej detekcji jest **uporządkowana propozycja**: najlepszy kandydat (tytuł, autor, wydawnictwo, rok, okładka, ISBN jeśli dostępny) + 2–4 alternatywy + flaga "masz tę książkę już w katalogu na półce X" jeśli dedupe wykrył duplikat. Propozycja jest progowana — kandydaci z pewnością ≥ 0.75 są pre-zaznaczeni do akceptacji, między 0.55 a 0.75 wymagają explicit potwierdzenia, poniżej 0.55 prowokują "wpisz ręcznie". Użytkownik widzi listę propozycji, akceptuje hurtowo wszystkie pre-zaznaczone lub przegląda po kolei.

W produkcie reguła ujawnia się w **trzech punktach kontaktu**: (a) widok przeglądu propozycji bezpośrednio po wgraniu zdjęcia (Flow A i Flow B); (b) wynik wyszukiwarki "masz tę książkę?" pokazujący zarówno trafienia, jak i pozycję na półce (in-bookstore + in-home moment); (c) zapis korekt, do którego wpada każde odchylenie od domyślnej propozycji — fundament telemetrii, na której strojone są progi i kontrakt rozpoznawania.

Reguła **nie jest** pustym CRUD-em: system aktywnie **decyduje** (1) co rozpoznać na zdjęciu, (2) z jaką pewnością dopasować do publicznej bazy, (3) czy oznaczyć jako duplikat istniejącej książki w katalogu, (4) jak rankować alternatywy, (5) czy uczyć się z odchyleń. Pięć decyzji domenowych dla każdej książki, których nie da się sprowadzić do "user dodaje rekord".

## Access Control

Aplikacja multi-user z indywidualnymi kontami. Podstawowa ścieżka logowania: **email + hasło**. Sign-on przez zewnętrznego dostawcę tożsamości jako opcjonalny dodatek został świadomie odłożony do post-MVP (patrz FR-002 i `## Non-Goals`).

**Model ról: płaski.** Każdy zarejestrowany użytkownik widzi wyłącznie własne dane (półki, książki, zdjęcia, sygnały telemetryczne). Brak roli administratora w interfejsie, brak gościa, brak udostępniania read-only, brak ról per-collection. Persona "single user = single collection" jest twardo wpisana w model — każde żądanie zwraca tylko zasoby należące do zalogowanego użytkownika; zasoby cudze są niewidoczne (zapytanie o identyfikator zasobu cudzego zwraca jednoznaczny brak, nie informację o istnieniu).

Niezalogowany użytkownik trafiający na chronioną ścieżkę aplikacji (ścieżki widoków półek, uploadu zdjęcia, biblioteki itd.) jest przekierowywany na ekran logowania. Strona publiczna ogranicza się do landing page + login + signup.

Konsekwencje dla design'u:

- Każda nowa funkcjonalność musi domyślnie filtrować po zalogowanym użytkowniku — to nie jest opcjonalne.
- Brak współdzielonych zasobów oznacza brak "moich znajomych", "polubionych przez X", "publicznych półek". Upraszcza model danych, interfejs, testy i prywatność.
- Udostępnianie post-MVP będzie wymagało wprowadzenia ról / kolekcji jako osobnego bytu — świadoma przyszła migracja, nie blokada.

## Non-Goals

Świadome cuts — rzeczy, których MVP **nie robi**. Każda wpisana tu pozycja ma jednoznaczne uzasadnienie, dlaczego nie jest w scope, żeby nie wracała tylnymi drzwiami w trakcie implementacji.

**Cuts redukujące zakres do MVP (żeby zmieścić się w oknie czasowym):**

- **Re-scan istniejącej półki i reconciliation** (kubełki "była tu" / "była gdzie indziej" / "zniknęła") — wymaga skomplikowanej logiki różnicowej dla książek już w katalogu i interfejsu obsługującego trzy stany decyzyjne. Bez tego user musi ręcznie przekładać każdą zmianę; akceptowalne w MVP, post-MVP rozwiązuje "katalog odpowiada rzeczywistości po 3 miesiącach".
- **Identyfikacja serii + numer tomu + widok pojedynczej serii z lukami ("brakuje tomu 4 i 7")** — najmniej dojrzałe dane w publicznych bazach, najwięcej pracy na korekty.
- **Filtr po typie oprawy (twarda / miękka) i filtr po dekadzie wydania** w wyszukiwarce — pełnotekst + kolor wystarczają, by potwierdzić, że in-home find działa.
- **Strukturalne pole "okoliczność zakupu"** (typ + nazwa + miasto + autouzupełnianie) — naruszyłoby KPI Time-to-add-purchase ≤ 90 s; w MVP tylko opcjonalna data zakupu.
- **Auto-uzupełnianie brakujących tomów serii ("kup tom 4")** — wymaga identyfikacji serii (pierwszy cut wyżej).
- **Manualne dodawanie jako pełny CRUD bez zdjęcia** — manual istnieje wyłącznie jako tryb "correct" w propozycji (FR-021); nie ma osobnego "Dodaj książkę z menu", żeby nie zachęcać do unikania automatycznego rozpoznawania.
- **Sign-on przez zewnętrznego dostawcę tożsamości** (FR-002 deferred) — nice-to-have w MVP rzadko ląduje na produkcji; szczerze do post-MVP follow-up. Email + hasło wystarcza.

**Strategiczne cuts (świadomy zakres MVP):**

- **Aplikacja mobilna / native iOS/Android** — desktop-first; mobile responsive tylko dla read-path (wyszukiwarka, widok książki, widok półki).
- **Robienie zdjęcia na żywo w przeglądarce (camera capture)** — tylko upload z dysku.
- **Skanowanie kodów kreskowych ISBN** — drugi sposób input'u, nie MVP.
- **Batch upload wielu zdjęć naraz** — w MVP pętla po jednym zdjęciu.
- **Współdzielenie półek między użytkownikami** (rodzina, współlokatorzy, znajomi) — single-user = single-collection, świadome ograniczenie wymagające ról / kolekcji jako osobnego bytu w przyszłości.
- **Wypożyczanie książek + dziennik czytania (postęp w stronach, daty początku / końca)** — w MVP tylko binarna flaga statusu przeczytania.
- **Oceny + recenzje** — brak. Status przeczytania jest binarny: przeczytana / nie przeczytana, koniec.
- **Rekomendacje "co przeczytać dalej" / "podobne książki"** — to byłaby kolejna reguła domenowa, poza zakresem MVP.
- **Wyszukiwanie semantyczne** ("książki o smokach", "coś o II wojnie") — w MVP tylko pełnotekst po fragmencie opisu z publicznej bazy.
- **Wyszukiwanie obraz-po-obrazie / pełny kolor RGB okładki / dopasowanie po wektorowej reprezentacji wizualnej** — w MVP nazwane kolory grzbietu z paletą ~10.
- **OCR pojedynczych słów z fotografii półki jako tryb wyszukiwania** — odrębne narzędzie.
- **Import z konkurencyjnych serwisów czytelniczych / plików CSV** — brak ścieżki migracji.
- **Eksport katalogu (CSV, JSON)** — łatwy do dodania post-MVP, ale nieobecny w MVP.
- **Tryb offline / instalacja jako Progressive Web App / cache zasobów** — wymagana sieć.
- **Edycja zdjęcia w przeglądarce (crop, rotate)** — automatyczne rozpoznawanie radzi sobie z surowym wejściem.
- **Wiele profili / wielokrotne kolekcje na jednym koncie** — jeden user = jedna kolekcja.
- **Integracja z konkurencyjnymi serwisami czytelniczymi jako źródło danych** — co najwyżej deep-link do strony książki, jeśli w ogóle.

**Cuts non-funkcjonalne:**

- **Pełen audit WCAG-AA** — w MVP tylko podstawy (semantyczny HTML, kontrast ≥ 4.5:1, focus visible, alt-texty). Pełen audit + testy ze screen-readerem + ARIA polish to ~1–2 tygodnie pracy poza budżetem.
- **Internacjonalizacja (PL+EN toggle ani English-first)** — interfejs w całości po polsku; brak warstwy i18n.
- **Multi-region SLA / 99.9% uptime / formal compliance (poza baseline GDPR)** — projekt o ograniczonej skali użytkowników, nie produkt komercyjny.

## Open Questions

Pytania, których sesja `/10x-shape` nie rozstrzygnęła, a które muszą być doprecyzowane przed lub w trakcie implementacji. Każde z poniższych jest świadomie odsunięte do późniejszej decyzji — żadne nie blokuje rozpoczęcia prac, ale każde wymaga rozstrzygnięcia, zanim odpowiadający fragment funkcjonalności trafi na produkcję.

1. **Strojenie progów pewności dopasowania (FR-016: 0.75 / 0.55).** Owner: użytkownik. By: po pierwszym miesiącu używania na realnej kolekcji. Wartości startowe nie są testowane na rzeczywistych danych; telemetria korekt pokaże, czy próg "pre-zaznaczone" jest zbyt liberalny / restrykcyjny.
2. **Finalna paleta nazwanych kolorów grzbietu (FR-011, FR-033).** Owner: użytkownik. By: przed implementacją wyszukiwarki. Sugerowane ~10 wartości (czerwony, niebieski, ciemnoniebieski, zielony, czarny, biały / kremowy, żółty, pomarańczowy, brązowy, fioletowy, szary), ale precyzyjna lista musi zostać uzgodniona — paleta jest częścią kontraktu rozpoznawania i nie powinna się zmieniać w trakcie używania, bo unieważnia zindeksowane wartości.
3. **Reguła dedupe dla różnych wydań tej samej książki (FR-017).** Decyzja kept: różne ISBN = różne rekordy + flaga "masz inną edycję" w interfejsie. Otwarte: jak dokładnie sformułować ten komunikat w UI, żeby kolekcjoner posiadający trzy wydania *Diuny* widział to jako wartość, nie hałas. Wymaga testów UX na realnych kolekcjach.
4. **Polityka matchingu dla książek bez ISBN (FR-017).** Owner: użytkownik. By: przed implementacją matchingu. Decyzja kierunkowa: fuzzy tytuł + autor z progiem wyższym niż przy obecności ISBN; konkretny próg numeryczny do ustalenia z telemetrii pierwszych przetworzonych półek.
5. **Eskalacja modelu rozpoznawania przy padających detekcjach.** Owner: użytkownik. By: post-MVP. W MVP używamy jednego modelu; jeśli telemetria pokaże, że pewne typy zdjęć (np. zdjęcia w słabym świetle, niestandardowe ułożenie książek) konsekwentnie obniżają recall, ścieżka eskalacji do silniejszego modelu jest naturalnym follow-upem — ale projektowana świadomie poza MVP, żeby nie multiplikować zmiennych w pierwszej iteracji.
