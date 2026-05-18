## BookShelf Scanner — MVP

### Główny problem

Posiadacze prywatnych kolekcji książek (~1000 tytułów na wielu półkach) nie mają katalogów swoich książek, bo ich nigdy nie robią, coś tam pamiętają ale bez szczegółów, co już mają. Konsekwencje: jak szybko znaleźc ksiązkę bo jakiś atrybutach (kolor, kształt, wyraz powiązany z wyrazem, okładka), kupowanie duplikatów w księgarni, brak wiedzy "komu pożyczyłem którą książkę", odkładanie katalogowania w nieskończoność, bo ręczne wpisanie tytułów to godziny pracy. Istniejące katalogi (Goodreads, lubimyczytac) wymagają wpisania każdej książki ręcznie albo skanowania ISBN pojedynczo — w obu przypadkach próg wejścia zabija nawyk.

Sednem problemu jest **koszt onboardingu**, nie braki funkcjonalne istniejących narzędzi. Aplikacja rozwiązuje go przez **vision-LLM**: użytkownik fotografuje półkę, system rozpoznaje grzbiety, dopasowuje je do publicznej bazy książek i tworzy katalog z lokalizacją (na której półce stoi co), w czasie liczonym w minutach, nie godzinach.

### Użytkownik

Dorosły czytelnik z prywatną kolekcją >1000 książek na wielu regałach w domu. Wie, co lubi czytać, ale **nie pamięta, co już ma na półkach** — zwłaszcza pozycji kupionych 5+ lat temu. Chce mieć katalog "do sprawdzenia w księgarni z telefonu", a nie kolejną sieć społecznościową dla czytelników. Ma tych książek w domu baaardzo dużo - nie ma czasu, chęci ani ochoty rbić ręcznej inwentaryzacji posiadanych egzemplaży.
Pojedynczy użytkownik = pojedyncza kolekcja; współdzielenie półek między domownikami **nie jest częścią MVP**.

### Pierwsze wartościowe przepływy (golden paths)

Aplikacja ma **trzy** powiązane przepływy, które odpowiadają rzeczywistym fazom życia kolekcji: **bootstrap** (skatalogowanie tego, co już mam), **bieżące zakupy** (książka właśnie kupiona) i **reorganizacja** (przekładam i chcę aktualizacji bez wpisywania ręcznie).

**Flow A — Bootstrap istniejącej kolekcji (główny):**

1. Załóż konto (email + hasło).
2. Utwórz półkę ("Salon, ściana zachodnia").
3. Zrób zdjęcie półki telefonem i wgraj je do aplikacji.
4. System pokazuje listę propozycji: dla każdego rozpoznanego grzbietu — najlepiej dopasowaną książkę z bazy (tytuł, autor, **wydawnictwo, rok wydania**, okładka) + 2–4 alternatywy. Jeśli rozpoznano element **serii**, propozycja zawiera nazwę cyklu i numer tomu ("Wiedźmin, tom 3/8").
5. Użytkownik **akceptuje / odrzuca / koryguje** każdą propozycję. Domyślnie każda nowo dodana książka ma status **nieprzeczytana**.
6. Po akceptacji widzi katalog półki z okładkami, pozycją "od lewej" i znacznikiem przeczytania.
7. Wraca w księgarni: wpisuje tytuł w wyszukiwarce i widzi "masz tę książkę (przeczytana), tom 3 z serii *Wiedźmin*, stoi na półce *Salon, ściana zachodnia*, pozycja 12".

**Flow B — Nowy zakup (bieżące przybywanie kolekcji):**

1. Wracam z targów książki / księgarni / paczki z Allegro z 5 nowymi książkami.
2. Otwieram katalog → akcja **"Dodaj zakup"** → wybieram metodę: zdjęcie stosu (vision) **lub** wpisanie ręczne **lub** skanowanie ISBN (poza MVP).
3. Po identyfikacji (jak Flow A pkt 4–5) książki trafiają na **wirtualną półkę "Zakupione"** — wbudowaną, nieusuwalną półkę systemową, **jedną na użytkownika**.
4. Przy zakupie zapisuję **datę zakupu** (domyślnie dzisiaj) i opcjonalnie **okoliczność**: nazwa wydarzenia ("Targi Książki Kraków 2026"), nazwa księgarni ("Empik Galeria Krakowska"), źródło online ("Allegro"), prezent ("od mamy, urodziny"). Pole jest swobodnym tekstem z autouzupełnianiem z poprzednich okoliczności.
5. Książka z "Zakupione" żyje normalnie w katalogu — można ją oznaczyć jako przeczytaną, wyszukać w księgarni, zobaczyć "kiedy i gdzie kupiłem". **Brak fizycznej półki nie blokuje funkcjonalności.**
6. Kiedy znajdę miejsce — akcja **"Przenieś na półkę X"** zdejmuje książkę z "Zakupione" i przypisuje do realnej półki. Data zakupu i okoliczność zostają na rekordzie książki (nie znikają po przeniesieniu).

**Flow C — Re-scan i reconciliation po reorganizacji:**

1. Przełożyłem ~30 książek między półkami "Salon" i "Gabinet" (sezonowe porządki).
2. Robię nowe zdjęcie półki "Salon" i wgrywam je z flagą **"to jest aktualizacja istniejącej półki"** (nie nowa półka).
3. Vision rozpoznaje grzbiety jak zwykle. **Następnie pipeline reconciliation** porównuje wynik z aktualnym stanem półki w katalogu i klasyfikuje każdą detekcję na jeden z trzech kubełków:
   - **Znana, była tu** (ISBN / fuzzy-match zgadza się z `shelf_entries` tej półki) — auto-accept, ewentualnie aktualizacja `position_index`.
   - **Znana, była gdzie indziej** ("ta książka była dotąd na *Gabinet* — przenosić na *Salon*?") — jedno kliknięcie potwierdza przekładkę, telemetria zapisuje przesunięcie.
   - **Nowa książka** — standardowy flow akceptacji jak we Flow A.
4. Książki, które były w katalogu na tej półce, **ale nie pojawiły się** na nowym zdjęciu, są pokazane jako **"znikły z półki — co się stało?"**: opcje *przeniesiona gdzieś* (do wyboru z listy półek), *na "Zakupione"* (cofnięcie do bufora), *poza katalogiem* (sprzedana / oddana / zgubiona — w MVP: po prostu **detach** z półki, książka znika z biblioteki).
5. Po zatwierdzeniu — katalog odzwierciedla nową rzeczywistość, telemetria ma kompletny log zmian.

**Operacje codzienne** (poza powyższymi flow): oznacz książkę jako przeczytaną jednym kliknięciem; **przełóż książkę między półkami** ręcznie bez ponownego skanowania (drag-and-drop / akcja "przenieś na półkę X").

Wartość pojawia się przy **pierwszym zdjęciu** (Flow A) — nie po wgraniu całej biblioteki. Jedna półka = pierwszy moment "to działa". Flow B i C to **utrzymanie wartości w czasie**: bez nich katalog 1000 książek dezaktualizuje się w 3 miesiące i traci sens.

**Drugi codzienny przepływ (use case w domu, nie w księgarni):** użytkownik chce **znaleźć konkretną książkę** w kolekcji 1000+, ale **nie pamięta tytułu** — pamięta tylko fragmenty: "ta z czerwonym grzbietem", "miała w tytule coś o smokach", "wydawnictwo Iskry, lata 80.", "twarda oprawa z białym napisem". Przewijanie listy 1000 pozycji jest bezużyteczne. Katalog **musi być przeszukiwalny po atrybutach pośrednich** (kolor grzbietu, fragment tytułu/autora/wydawnictwa/opisu, dekada wydania, typ oprawy) — inaczej kolekcjoner z 1000+ książek nie zacznie go używać do nawigacji.

### Reguła biznesowa

Logika domenowa składa się z **dwóch sprzężonych łańcuchów**: (1) **identyfikacja** (vision → match → ranking propozycji) wykonywana raz przy pierwszym wprowadzeniu książki, i (2) **reconciliation** (porównanie nowego zdjęcia z istniejącym stanem katalogu) wykonywana przy każdym kolejnym zdjęciu tej samej półki. Drugi łańcuch jest tym, co odróżnia BookShelf od jednorazowego importera.

**Łańcuch 1 — Identyfikacja (detekcja → matching → ranking propozycji):**

1. Vision-LLM zwraca strukturalną listę kandydatów (tytuł, autor, confidence; opcjonalnie: oznaczenie tomu typu "t. 3", "Vol. II", numer na grzbiecie; **dominujący kolor grzbietu** jako jedno z 8–12 nazwanych pól typu `red`, `dark-blue`, `cream`) z jednego zdjęcia. Kolor grzbietu jest zapisywany razem z książką **i służy jako atrybut wyszukiwania**, nie tylko sygnał pomocniczy do dedupe.
2. Dla każdego kandydata system pyta publicznej bazy książek o pasujące rekordy i pobiera pełne metadane: **tytuł, autor(zy), wydawnictwo, rok wydania, ISBN, seria + numer tomu** (jeśli baza zwraca), **typ oprawy** (hardcover / paperback, gdy baza zwraca), **krótki opis** (Google Books `description` — używany jako pole pełnotekstowe w wyszukiwarce), okładka.
3. System liczy **score matchu** (podobieństwo tytułu × podobieństwo autora + bonus za ISBN). Jeśli kandydat z bazy należy do serii, a vision wykrył numer na grzbiecie — zgodność numeru daje dodatkowy bonus do scoru.
4. Przed pokazaniem propozycji system sprawdza, **czy użytkownik już nie ma tej książki** w katalogu (po ISBN lub fuzzy-match tytułu) — jeśli tak, oznacza jako "duplikat z istniejącej półki".
5. Propozycje są **rankowane** (match_score, źródło, historia korekt użytkownika) i progowane: ≥ 0.75 = pre-zaznaczone, 0.55–0.75 = wymaga potwierdzenia, < 0.55 = "wpisz ręcznie".
6. **Każda korekta** użytkownika (zmiana tytułu, zmiana autora, zmiana wydawnictwa/roku, zmiana tomu serii, odrzucenie propozycji) jest zapisywana jako sygnał telemetryczny — stanowi proof, że logika nie jest pustym CRUDem, oraz dane do iteracji promptu i progów.

**Łańcuch 2 — Reconciliation (re-scan istniejącej półki):**

1. Po przetworzeniu nowego zdjęcia półki, dla której **istnieje już snapshot** w katalogu, system porównuje świeży zestaw detekcji ze zbiorem `shelf_entries(shelf_id, is_current=true)` tej półki.
2. Dla każdej detekcji liczony jest **match-do-katalogu** (lokalny ISBN-match, jeśli vision dał ISBN; w przeciwnym razie fuzzy-match tytuł+autor o wyższym progu niż match do publicznej bazy, bo katalog ma mniej rekordów i fałszywe pozytywy są kosztowniejsze).
3. Każda detekcja klasyfikowana jest do jednego z trzech stanów: **`same-shelf`** (już była tu — auto-accept), **`moved-in`** (była gdzie indziej w katalogu użytkownika — wymaga potwierdzenia przekładki), **`new`** (nigdy nie była — wchodzi do Łańcucha 1).
4. Książki obecne w katalogu na tej półce, **których nowe zdjęcie nie znalazło**, trafiają do kubełka **`missing`**. System pyta użytkownika o intencję: *przeniesiona na półkę X*, *cofnięta do "Zakupione"*, *usunięta z katalogu*, *vision pominął — ignoruj* (nie zmieniaj stanu).
5. Wszystkie zmiany ruchu książek (`moved-in`, `missing → przeniesiona`) zapisywane są jako rekordy w historii lokalizacji — nowe `shelf_entry` z `confirmed_at = now`, poprzedni `is_current = false`. Daje to **audytowalny log** "co stoi gdzie i od kiedy" za darmo.
6. Próg auto-accept w reconciliation jest **bardziej liberalny** niż w identyfikacji (~0.85 vs ~0.75) — bo źródło prawdy (katalog użytkownika) jest mniejsze i bardziej zaufane niż Google Books.

To **nie jest "user dodaje fiszki"** ani "user dodaje książki" — to system, który **proponuje** wpisy z mierzalną pewnością i **utrzymuje spójność katalogu w czasie**, a użytkownik je potwierdza.

### Najmniejszy zestaw funkcjonalności

- Rejestracja i logowanie (email + hasło), każdy użytkownik widzi tylko własne dane.
- **Organizacja biblioteczki**: CRUD półek (nazwa, lokalizacja w domu, opcjonalnie pomieszczenie / regał nadrzędny), zmiana kolejności półek, **przekładanie książki z jednej półki na drugą** (akcja "przenieś na półkę X", bez utraty historii — poprzednia lokalizacja zapisana w telemetrii).
- **Wirtualna półka "Zakupione"** — systemowa, jedna na użytkownika, tworzona automatycznie przy rejestracji, nieusuwalna. Bucket dla książek już kupionych, ale jeszcze nie zaalokowanych na fizyczną półkę. **Każda książka w katalogu istnieje na dokładnie jednej "półce"** (fizycznej albo wirtualnej) — model nie dopuszcza książek "wiszących w próżni".
- **Metadane zakupu** na książce: data zakupu (opcjonalna, domyślnie data dodania), okoliczność zakupu (swobodny tekst z autouzupełnianiem — "Targi Książki Kraków 2026", "Empik Galeria Krakowska", "prezent od X", "Allegro #ID"). Pola wypełniane głównie we Flow B, ale możliwe do edycji w dowolnym momencie. **Zostają na rekordzie po przełożeniu** na fizyczną półkę.
- **Re-scan istniejącej półki**: tryb "to jest aktualizacja, nie nowa półka" przy uploadzie zdjęcia, uruchamia pipeline reconciliation (Łańcuch 2 w regule biznesowej) zamiast traktować każdy grzbiet jako nowy. UI pokazuje trzy listy: *bez zmian*, *przeniesione (skąd → tutaj)*, *nowe*, plus osobno kubełek *zniknęły z półki* z akcjami.
- Upload zdjęcia półki z przeglądarki (drag-and-drop, jedno zdjęcie naraz).
- Przetwarzanie zdjęcia przez vision-LLM: rozpoznanie grzbietów → kandydaci z publicznej bazy książek (Google Books jako podstawowe źródło, OpenLibrary jako fallback).
- **Pełne metadane książki** w propozycji i katalogu: tytuł, autor(zy), **wydawnictwo, rok wydania**, ISBN, okładka.
- **Identyfikacja serii**: jeśli książka należy do cyklu, propozycja zawiera **nazwę serii oraz numer tomu** (np. "Wiedźmin, tom 3 z 8"). Użytkownik może skorygować / uzupełnić tom ręcznie.
- **Status przeczytania**: każda książka ma flagę `read` (domyślnie `false`), przełączaną jednym kliknięciem w katalogu i widoku półki. Bez ocen, recenzji ani daty przeczytania — tylko binarka "przeczytana / nieprzeczytana".
- Widok przeglądu propozycji z confidence i alternatywami, z akcjami **accept / reject / correct** (korekta obejmuje też wydawnictwo, rok, serię, tom).
- Manualne dodanie książki (gdy vision nie rozpozna albo użytkownik chce dodać bez zdjęcia).
- Katalog z **wyszukiwaniem po atrybutach pośrednich** (drugi główny use case — nawigacja po kolekcji w domu, nie tylko sprawdzanie w księgarni):
  - **Wyszukiwarka pełnotekstowa** po tytule, autorze, wydawnictwie i krótkim opisie z bazy (Google Books `description`) — wystarczająca dla większości "pamiętam tylko fragment / słowo kojarzące się" przypadków.
  - **Filtr po kolorze grzbietu** (ekstrahowany przez vision-LLM przy katalogowaniu — patrz Łańcuch 1 pkt 1). Paleta ~10 nazwanych kolorów, nie pełny RGB.
  - **Filtr po typie oprawy** (twarda / miękka), gdy dane dostępne.
  - **Filtr po dekadzie wydania** (np. "lata 80.").
  - **Filtr po półce, po statusie przeczytania, po serii** — jak wcześniej.
  - **Kombinowanie filtrów + tekstu**: "czerwony grzbiet + twarda oprawa + 'smok' w opisie" zwęża 1000 książek do ~5 kandydatów wizualnych w 2–3 sekundy.
- Widok pojedynczej półki: książki w kolejności "od lewej" z okładkami, znacznikami przeczytania i numerami tomów w obrębie serii.
- Widok pojedynczej serii: wszystkie tomy w kolejności + wizualne luki "brakuje tomu 4 i 7".
- Telemetria korekt + zmian lokalizacji + zdarzeń reconciliation (zapis w bazie — nie wymaga panelu w MVP).

### Co NIE wchodzi w zakres MVP

- Aplikacja mobilna ani natywne robienie zdjęć w przeglądarce (camera capture) — desktop upload z telefonu wystarczy.
- Batch upload wielu zdjęć naraz — pętla po jednym zdjęciu.
- Skaner kodów kreskowych ISBN — ciekawy pomysł, ale to drugi sposób inputu, nie MVP.
- Współdzielenie półek między użytkownikami (rodzina, współlokatorzy).
- Wypożyczanie książek / pełny dziennik czytania (data początku/końca, postęp w stronach) / **oceny / recenzje** — w MVP tylko binarna flaga `read`.
- Automatyczne uzupełnianie brakujących tomów serii z bazy (sugestie "kup tom 4") — sama identyfikacja serii TAK, rekomendacja zakupu NIE.
- Rekomendacje "co przeczytać dalej" / "podobne książki" — to byłaby **kolejna** reguła domenowa, poza zakresem.
- **Wyszukiwanie semantyczne** ("książki o smokach", "coś o II wojnie światowej") oparte na embeddingach opisów książek — w MVP tylko wyszukiwanie pełnotekstowe po opisie z Google Books, bez wektorów. Semantyka wpada na listę post-MVP.
- **Wyszukiwanie obraz-po-obrazie** ("znajdź książkę o okładce podobnej do tej") oraz pełnokolorowy match po dominującym kolorze okładki — MVP używa nazwanych kolorów grzbietu (paleta ~10 wartości), bez RGB / embeddingów wizualnych.
- **OCR pojedynczych słów z fotografii półki jako tryb wyszukiwania** ("pokaż mi książki gdzie na grzbiecie jest słowo X") — odrębne narzędzie, poza zakresem.
- Import z Goodreads / lubimyczytac / plików CSV.
- Eksport katalogu (CSV, JSON) — łatwy do dodania po MVP.
- Offline mode / PWA / cache.
- Edycja zdjęcia w przeglądarce (crop, rotate) — vision-LLM radzi sobie z surowym wejściem.
- Wiele profili / wielokrotne kolekcje na jednym koncie.
- Integracje z lubimyczytac jako źródło danych — tylko deep-link do strony książki.

### Kryteria sukcesu

- **Recall vision ≥ 70%**: na uśrednionym zdjęciu półki system rozpoznaje co najmniej 7 z 10 widocznych grzbietów.
- **Acceptance rate ≥ 75%** (Flow A): 3 na 4 propozycje pokazane użytkownikowi są akceptowane bez korekty pola tytuł/autor (mierzone z tabeli korekt; korekty wydawnictwa i tomu serii liczone osobno, mają luźniejszy próg).
- **Reconciliation precision ≥ 90%** (Flow C): gdy system klasyfikuje detekcję jako `same-shelf` albo `moved-in`, w co najmniej 9 na 10 przypadków ma rację (fałszywy `same-shelf` przy nowej książce to gorsze UX niż fałszywy `new` przy znanej).
- **Series identification ≥ 60%**: dla książek faktycznie należących do serii system poprawnie wykrywa nazwę cyklu w co najmniej 60% przypadków (numer tomu — luźniej, bo często niedostępny w bazach).
- **Time-to-first-shelf ≤ 5 minut** (Flow A): od rejestracji do pierwszego ukończonego katalogu półki (~15–20 książek).
- **Time-to-full-catalog ≤ 4h** dla kolekcji 1000 książek na ~30 półkach (≈8 minut przetwarzania na półkę przy akceptacji bez większych korekt).
- **Time-to-add-purchase ≤ 90 sekund** (Flow B): od kliknięcia "Dodaj zakup" do zatwierdzonej pozycji na półce "Zakupione" wraz z metadanymi zakupu — jedna książka, bez zdjęcia (ręczne wpisanie). Próg krytyczny, bo Flow B będzie używany **dziesiątki razy w roku**, podczas gdy Flow A raz.
- **Duplicate-purchase prevention** (jakościowe): użytkownik raportuje co najmniej jeden moment "sprawdziłem w księgarni i nie kupiłem duplikatu" w ciągu pierwszych 4 tygodni używania.
- **Find-in-house success ≥ 80%**: użytkownik szukający książki w domu po wskazówkach pośrednich (kolor + fragment tytułu + dekada) znajduje ją w ≤ 3 zwracanych wynikach w co najmniej 8 na 10 prób. Proof, że wyszukiwarka działa jako *narzędzie nawigacji po kolekcji*, nie tylko jako "potwierdź że mam".
- **Time-to-find ≤ 15 sekund** (jakościowe): od myśli "gdzie była ta czerwona o smoku" do trafienia w półkę / pozycję na półce. Punkt referencyjny: przeszukanie regału ręcznie zajmuje 5–15 minut dla kolekcji 1000+ książek.
- **Catalog-stays-current** (jakościowe): po 3 miesiącach od onboardingu katalog odpowiada **realnemu** stanowi półek w ≥ 90% pozycji — proof, że Flow B i C działają na tyle płynnie, że użytkownik faktycznie ich używa. Mierzone wyrywkową weryfikacją (10 losowych książek z katalogu vs rzeczywista półka).

### Otwarte pytania do sesji /10x-shape

- Czy MVP obsługuje **wiele półek na jednym zdjęciu** (regał z 4 półkami), czy zakładamy "jedna fotka = jedna półka"? Przy kolekcji >1000 książek na wielu regałach to ma duży wpływ na czas onboardingu.
- Co dzieje się, gdy vision-LLM zwróci propozycję, ale Google Books **nie znajduje matchu** (książka rzadka, polskie wydanie z lat 80.)? Fallback do "wpisz ręcznie tytuł + autor", czy zapis surowej detekcji jako tymczasowego rekordu?
- **Seria jako osobny byt w modelu danych, czy stringi na książce?** Pierwsze daje widok "wszystkie tomy *Wiedźmina*" za darmo i wymusza spójność nazwy, drugie jest prostsze ale podatne na literówki. Co wybieramy w MVP?
- **Źródło danych o serii**: Google Books nieregularnie wypełnia pole `seriesInfo`; OpenLibrary ma `works`, ale niespójnie. Czy w MVP polegamy wyłącznie na tym, co zwróci baza, czy dopuszczamy też wykrycie z grzbietu przez vision (numer tomu w prawym dolnym rogu)? A może użytkownik **zawsze** ręcznie potwierdza tom?
- **Książka w wielu wydaniach** (np. *Diuna* — Iskry 1986 vs Rebis 2003 vs Rebis 2020): czy w katalogu to **jeden rekord z notatką "mam wydanie X"**, czy **trzy odrębne rekordy**? Pytanie kluczowe, bo zmienia definicję "duplikatu". Sugeruję w MVP: jedno wydanie = jeden rekord (kolekcjoner widzi, że ma trzy *Diuny*).
- **Co znaczy "przeczytana"** w kontekście serii? Czy flaga jest per-tom (mam 8 tomów *Wiedźmina*, przeczytałem 5), czy per-seria (cała seria przeczytana)? MVP: **per tom**, agregat na widoku serii pokazuje "5/8 przeczytanych".
- **Przekładanie między półkami** — czy zostawiamy ślad w historii (`shelf_entries` z `is_current=false`), czy nadpisujemy lokalizację? Telemetria sugeruje pierwsze (proof, że logika działa, też wskaźnik "książka się przemieszcza = jest używana").
- Czy korekta użytkownika jest **prywatna** (tylko jego telemetria), czy zasila wspólny pool sygnałów jakości? (W MVP najprościej: prywatna.)
- Jak postępować z książkami **bez ISBN** (samizdat, pozycje sprzed 1970)? Czy ISBN jest miękkim wzmocnieniem matchu, czy twardym wymogiem dla zapisu w katalogu?
- **Półka "Zakupione" — wbudowana czy konwencja?** Wbudowana = systemowy `shelf_kind = 'inbox'`, autotworzona, nieusuwalna, jedna na użytkownika — czyściej w modelu i UX. Konwencja = zwykła półka z nazwą "Zakupione" tworzona przez użytkownika, bez specjalnej semantyki — prostsze w implementacji, ale podatna na bałagan (użytkownik usuwa, zmienia nazwę, robi dwie). Sugeruję pierwszą opcję.
- **Pole "okoliczność zakupu"** — swobodny tekst z autouzupełnianiem, czy strukturalne pola (typ: targi / księgarnia / online / prezent + nazwa + miasto)? Strukturalne dają lepsze filtry ("wszystkie z Targów Krakowskich 2025"), ale podnoszą próg wejścia przy każdym zakupie i naruszają KS "time-to-add-purchase ≤ 90s". Sugeruję: swobodny tekst w MVP, strukturyzacja po MVP jako follow-up jeśli sygnał z telemetrii pokaże, że ludzie używają.
- **Reconciliation: ISBN-only czy fuzzy?** Najtwardsza decyzja w Łańcuchu 2. ISBN-only = super-precyzyjne, ale wymaga, żeby vision **wyciągnął ISBN z grzbietu** (rzadko widoczny) albo żeby pierwszy match z bazy ten ISBN zapisał (wtedy działa, ale tylko dla książek z bazy). Fuzzy tytuł+autor = działa zawsze, ale ryzyko fałszywych pozytywów ("dwie różne książki Stanisława Lema o podobnym tytule"). Sugeruję: ISBN gdy jest, fuzzy z wysokim progiem jako fallback, książki bez ISBN i z `match_score < 0.85` w reconciliation **zawsze wymagają potwierdzenia** użytkownika (lepiej spytać niż się pomylić).
- **Co znaczy `missing` w pełni:** czy "zniknęła z półki" w Flow C oznacza tylko "vision jej nie znalazł", czy też "po reorganizacji nie ma jej w żadnym kubełku po przejrzeniu wszystkich kandydatów"? Pytanie kluczowe, bo vision-LLM regularnie pomija pojedyncze grzbiety. Sugeruję: domyślna akcja na `missing` to **"ignoruj — vision pewnie pominął"** (zachowawcze), użytkownik aktywnie wybiera "przeniesiona / sprzedana / zgubiona" tylko gdy faktycznie wie.
- **Czy "Zakupione" liczy się do statystyk półek?** Widok "ile mam książek" = wszystkie (fizyczne + Zakupione)? Widok "moje regały" = tylko fizyczne? Filtr w katalogu "tylko fizyczne / tylko Zakupione / wszystkie" — w MVP czy później?
- **Doprecyzowanie "wyraz powiązany z wyrazem"** (z opisu personą): czy chodzi o (a) **wyszukiwanie pełnotekstowe** po wszystkim co wiemy o książce — tytuł + autor + wydawnictwo + opis ("smok" trafia w *Hobbita* przez opis Google Books)? (b) **synonim / skojarzenie** — "smok" → też "draconis", "smoczy"? (c) **semantykę pojęciową** — "smok" → też "Tolkien", "fantasy"? MVP zakłada (a) — pełnotekst po fragmentach + opisie. (b) i (c) wymagają embeddingów i wpadają do post-MVP. **Pytanie: czy (a) wystarczy, żeby Twoje przykładowe szukania działały?**
- **Paleta kolorów grzbietu**: w MVP proponuję **~10 nazwanych kolorów** (czerwony, niebieski, ciemny niebieski, zielony, czarny, biały / kremowy, żółty, pomarańczowy, brązowy, fioletowy, szary / metaliczny) zwracanych przez vision jako jeden enum. Pełny hex / RGB i dominujący kolor okładki (a nie grzbietu) wpadają do post-MVP. Czy paleta jest wystarczająca, czy potrzebne też wzorzec/efekt (matowy, błyszczący, ze złotymi literami)?
- **Reality check zakresu** (dwa kroki): Flow A + Flow B + Flow C + przekładanie + status read + seria + **wyszukiwarka po atrybutach** — czy to nadal **mieści się w ~3 tygodniach pracy po godzinach**? **NIE — i to bez wątpliwości.** Trzeba twardo wybrać MVP. Sugerowana kolejność cięcia (od najmniej do najbardziej bolesnego):
  1. **Identyfikacja serii** (najmniej dojrzałe dane w bazach, najwięcej pracy na korekty).
  2. **Widok pojedynczej serii** z lukami.
  3. **Manualne dodawanie** (bez zdjęcia) jako oddzielny flow — można dodać jako "wpisz tytuł" tylko w trybie korekty propozycji, nie jako pełny CRUD.
  4. **Flow C uproszczony** — tylko `same-shelf` (auto-accept) i `new` (wpada do Łańcucha 1). Kubełki `moved-in` i `missing` → post-MVP. To "incremental upload", nie pełne reconciliation.
  5. **Filtr po dekadzie wydania** w wyszukiwarce (pełnotekst + kolor + oprawa wystarczają na start).

  Czego **nie wycinać**: Flow A, Flow B (zakupy są codzienne), wyszukiwarka pełnotekstowa + kolor grzbietu (drugi load-bearing use case z opisu problemu).
