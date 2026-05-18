---
project: "BookShelf Scanner"
context_type: greenfield
created: 2026-05-19
updated: 2026-05-19
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "load-bearing moments"
      decision: "dwa momenty równo ważone: in-bookstore lookup + in-home find-by-attribute"
    - topic: "insight (dlaczego nikt tego nie zbudował)"
      decision: "cztery axes: (1) atrybuty wizualne grzbietu nie istnieją w żadnej publicznej bazie — musi być ekstrahowane z foto własnej półki; (2) okno technologiczne vision-LLM otwarło się dopiero 2024–26; (3) Goodreads/lubimyczytac optymalizują dla social graphu, nie nawigacji po prywatnej kolekcji; (4) target 1000+ książek to nisza niewidoczna dla mainstream PMs"
    - topic: "pain category"
      decision: "trzy kategorie naraz: workflow friction (1000+ książek manualnie = godziny), data trapped (wiem, ale nie ma jak zapisać), missing capability (nikt nie ma search po atrybutach pośrednich) — coordination/sharing świadomie wycięte z MVP"
    - topic: "auth shape"
      decision: "email + hasło jako podstawa; Google OAuth jako opcjonalny dodatek w MVP gdy starczy czasu"
    - topic: "model ról"
      decision: "płaski — każdy użytkownik = jedna kolekcja, brak admina/guesta/share, najprostszy możliwy model"
    - topic: "MVP slice"
      decision: "Slice B — Flow A (bootstrap) + Flow B (nowy zakup z wirtualną półką 'Zakupione' i opcjonalną datą zakupu) + przekładanie książek między półkami + wyszukiwarka (pełnotekst + filtr koloru grzbietu + filtr po półce + filtr po read) + status read jako binarka. Wycięte: Flow C (reconciliation), identyfikacja serii + widok serii, filtr po oprawie, filtr po dekadzie, strukturalna okoliczność zakupu, auto-tomy."
    - topic: "timeline acknowledgment"
      decision: "Slice B = ~5–6 tygodni intensywnej pracy po godzinach, mieści się w oknie 18.05 → 5.07.2026 (deadline 1. terminu 10xDevs). User świadomie akceptuje koszt sustained-effort powyżej domyślnego progu 3 tyg."
    - topic: "KPI grouping"
      decision: "Primary 4 (Recall vision, Acceptance rate, Time-to-first-shelf, Find-in-house success); Secondary 3 (Time-to-add-purchase, Duplicate-prevention jakościowe, Time-to-full-catalog); Guardrails 3 (RLS-privacy, no-data-loss, p95 < 1s na widokach nawigacji). Catalog-stays-current wycięte (wymaga Flow C, którego nie ma w Slice B)."
    - topic: "domain rule (one sentence)"
      decision: "BookShelf przekształca pojedyncze zdjęcie półki w listę propozycji z mierzalną pewnością + flagą duplikatu; user akceptuje/koryguje/odrzuca; system rejestruje każdą decyzję jako sygnał uczący. Pięć decyzji domenowych: rozpoznawanie, scoring, dedupe, ranking, telemetria."
    - topic: "responsiveness"
      decision: "Mobile responsive tylko dla widoków read-path (wyszukiwarka, widok książki, widok półki) — pozostałe (CRUD półek, upload, propozycje) desktop-first"
    - topic: "język UI"
      decision: "polski only w MVP; brak przełącznika; i18n post-MVP jeśli potwierdzi się PMF poza polskim rynkiem"
    - topic: "accessibility"
      decision: "podstawy (semantyczny HTML, kontrast ≥ 4.5:1, focus visible, alt-texty); pełny WCAG-AA poza scope MVP"
  frs_drafted: 38
  quality_check_status: accepted
---

# BookShelf Scanner — Shape Notes

Discovery notes z sesji `/10x-shape`. Anticipates 10-sekcjowy schemat PRD (greenfield). Każda sekcja `##` poniżej mapuje 1:1 na sekcję w `prd.md`, którą wygeneruje `/10x-prd`.

Seed: `context/foundation/bookshelf_idea.md`.

## Vision & Problem Statement

Dorośli czytelnicy z prywatnymi kolekcjami książek liczącymi ~1000+ tytułów nie mają katalogu swoich półek — bo ręczne wpisanie każdej pozycji w Goodreads / lubimyczytac to wiele godzin, a skanowanie ISBN czytnikiem działa pojedynczo i wymaga, by każdy egzemplarz miał czytelny kod (klasyczne wydania sprzed lat 80., samizdat — nie mają). Konsekwencje są mierzalne i powtarzalne: kupowanie duplikatów w księgarni, niemożność szybkiego zlokalizowania konkretnej książki w domu, kiedy pamiętane są tylko atrybuty pośrednie ("ta z czerwonym grzbietem, coś o smokach, wydawnictwo Iskry, lata 80."), oraz perpetuum mobile odkładania katalogowania, bo próg wejścia zabija nawyk.

Sednem problemu jest **koszt onboardingu**, nie braki funkcjonalne istniejących narzędzi — i otworzyło się okno technologiczne (cheap, accurate vision-LLM 2024–26), w którym foto-półki → skatalogowane półki w minutach jest po raz pierwszy wykonalne. Dodatkowo: **atrybuty wizualne grzbietu** (dominujący kolor, typ oprawy) **nie istnieją jako structured data w żadnej publicznej bazie** — muszą być ekstrahowane ze zdjęcia własnej półki, czego żaden istniejący produkt nie robi. To, w połączeniu z faktem, że Goodreads optymalizuje dla social graphu (nie dla in-home nawigacji), oraz że target 1000+ książek to nisza poniżej radaru mainstream PMs, wyjaśnia, dlaczego przez 15+ lat nikt tego nie zbudował.

## User & Persona

**Persona główna:** dorosły kolekcjoner z prywatną biblioteką **>1000 książek** na wielu regałach w domu. Pamięta swoje preferencje czytelnicze, ale **nie pamięta szczegółowo, co już ma** — zwłaszcza pozycji kupionych 5+ lat temu. Dwie sytuacje wyzwalają potrzebę katalogu (oba momenty równo ważone, oba musi adresować MVP):

- **W księgarni / na targach / przy paczce z Allegro:** "Czy już to mam? Czy mam tom 4 *Wiedźmina*, czy tylko 1–3?". Otwiera telefon, szybkim sprawdzeniem w katalogu uniknie duplikatu.
- **W domu, przy regale:** "Gdzie była ta czerwona o smokach z lat 80., wydawnictwo Iskry?". Przewijanie listy 1000 pozycji jest bezużyteczne — katalog musi być przeszukiwalny po **atrybutach pośrednich** (kolor grzbietu, fragment tytułu / autora / wydawnictwa / opisu, dekada wydania, typ oprawy). Bez tego katalog 1000+ książek nie służy do nawigacji, tylko do pasywnego "wiem, że mam".

Persona **nie szuka** kolejnej sieci społecznościowej dla czytelników, recenzji znajomych, ani rekomendacji "co przeczytać dalej". Szuka narzędzia osobistego, które wytworzy katalog bez kilkudziesięciu godzin wpisywania i pozwoli go używać do nawigacji po fizycznej kolekcji.

Pojedynczy użytkownik = pojedyncza kolekcja. Współdzielenie półek między domownikami / rodziną / przyjaciółmi **nie jest częścią MVP** (świadomy non-goal, nie ograniczenie technologiczne).

## Access Control

Multi-user web app z indywidualnymi kontami. Podstawowa ścieżka logowania: **email + hasło**, z **Google OAuth jako opcjonalnym dodatkiem** w MVP (włączane, jeśli zostanie czas po dostarczeniu rdzenia — w przeciwnym razie post-MVP).

**Model ról: płaski.** Każdy zarejestrowany użytkownik widzi tylko własne dane (półki, książki, zdjęcia, korekty, telemetrię). Brak admina w UI, brak guesta, brak read-only share, brak ról per-collection. Persona "single user = single collection" jest twardo wpisana w model danych — wszystkie tabele scope'owane przez `user_id` z polityką "wiersz widoczny wtedy i tylko wtedy, gdy `user_id = obecny zalogowany użytkownik`".

Niezalogowany użytkownik trafiający na chronioną ścieżkę (`/shelves`, `/photos/upload`, `/library`, etc.) jest przekierowywany na ekran logowania. Strona publiczna ogranicza się do landing page + login + signup.

Konsekwencje dla design'u:
- Każda nowa funkcjonalność musi domyślnie filtrować po użytkowniku — to nie jest opcjonalne.
- Brak współdzielonych zasobów oznacza brak "moich znajomych", "polubionych przez X", "publicznych półek". To upraszcza wszystko: model danych, UI, testy, prywatność.
- Sharing post-MVP będzie wymagał wprowadzenia ról / kolekcji jako osobnego bytu — świadoma przyszła migracja, nie blokada.

## Success Criteria

### Primary

Cztery KPI, których niespełnienie oznacza, że produkt nie dostarcza wartości (nawet jeśli technicznie działa):

- **Recall vision ≥ 70%**: na uśrednionym zdjęciu półki system rozpoznaje co najmniej 7 z 10 widocznych grzbietów. Pomiar: zestaw 5–10 zdjęć kontrolnych pochodzących z realnych regałów (zróżnicowane wydania, polskie + angielskie tytuły) etykietowanych ręcznie; recall liczony jako stosunek rozpoznanych grzbietów do faktycznie widocznych.
- **Acceptance rate ≥ 75%** (Flow A): co najmniej 3 na 4 propozycje pokazane użytkownikowi są akceptowane bez korekty pól *tytuł* / *autor*. Korekty pól pomocniczych (wydawnictwo, rok wydania) liczone osobno z luźniejszym progiem. Pomiar: tabela korekt vs total propozycji w danym oknie czasowym.
- **Time-to-first-shelf ≤ 5 minut** (Flow A): od momentu zakończenia rejestracji nowego użytkownika do pierwszej zaakceptowanej półki (~15–20 książek) upływa nie więcej niż 5 minut. Pomiar: timestamp `auth.users.created_at` vs `shelf.first_confirmed_at`.
- **Find-in-house success ≥ 80%** (in-home moment): użytkownik szukający książki po wskazówkach pośrednich (kolor grzbietu + fragment tytułu / autora / wydawnictwa) znajduje ją w ≤ 3 zwracanych wynikach w co najmniej 8 na 10 prób testowych. Pomiar: ręczny test scenariuszowy na realnej kolekcji testowej (~50–100 książek).

### Secondary

Mierniki "wartość ponad MVP" — niezbędne nie są, ale ich brak osłabia narrację:

- **Time-to-add-purchase ≤ 90 s** (Flow B): od kliknięcia "Dodaj zakup" do zatwierdzonej pozycji na półce "Zakupione" (jedna książka, ręczne wpisanie, bez zdjęcia). Próg krytyczny dla **utrzymania nawyku** — Flow B będzie używany dziesiątki razy w roku, podczas gdy Flow A raz przy onboardingu.
- **Duplicate-purchase prevention** (jakościowe): użytkownik raportuje co najmniej jeden moment "sprawdziłem w księgarni i nie kupiłem duplikatu" w ciągu pierwszych 4 tygodni używania. Mierzone wywiadem / krótkim formularzem, nie telemetrią.
- **Time-to-full-catalog ≤ 4 h** dla kolekcji 1000 książek na ~30 półkach (≈ 8 minut na półkę przy akceptacji bez większych korekt). Pomiar: jednorazowy test manualny na realnym regale testowym; dowodzi skalowalności vision-pipeline.

### Guardrails

Cechy, których naruszenie traktujemy jako regresję, nawet jeśli Primary KPI nadal są zielone:

- **Prywatność**: użytkownik A pod żadnym warunkiem nie widzi danych użytkownika B. Wymuszone przez RLS na poziomie bazy danych dla każdej tabeli z `user_id` (test: zapytanie do API z tokenem A o zasób B zwraca 404, nie 403, nie 200 z pustym body).
- **Brak utraty danych po awarii**: zdjęcie wgrane do storage, ale jeszcze nieprzetworzone przez vision, nie znika po crashu / restarcie / błędzie sieci. Pipeline jest idempotentny — re-trigger przetwarzania nie tworzy duplikatów detekcji ani książek.
- **p95 < 1 s na widokach nawigacji** (lista półek, widok półki, wyszukiwarka po max 1000 wynikach): bo katalog ma służyć do szybkiego sprawdzania w księgarni / w domu. Wyjątek: widok przetwarzania zdjęcia (vision-LLM call) — tam akceptujemy widoczne loadery do 30 s, ale informujemy użytkownika o postępie.

## Timeline acknowledgment

Acknowledged on 2026-05-19: MVP Slice B wymaga ~5–6 tygodni intensywnej pracy po godzinach, co przekracza domyślny próg 3 tygodni z `/10x-shape`. Użytkownik świadomie akceptuje koszt sustained-effort — okno 18.05.2026 → 5.07.2026 (deadline 1. terminu certyfikacji 10xDevs 3.0) jest twardym terminem, do którego scope został dopasowany. Cięcia względem pełnego seed'a (Flow C, identyfikacja serii, filtry oprawa/dekada, strukturalna okoliczność zakupu) są świadome i odzwierciedlone w `## Non-Goals` (będzie wypełnione w Fazie 6).

## MVP slice — Slice B (decyzja Phase 3)

**W Slice B (must-have, MVP):**

- **Flow A — Bootstrap istniejącej kolekcji**: rejestracja → tworzenie półki → upload zdjęcia → vision-pipeline → akceptacja propozycji → katalog z okładkami i statusem read.
- **Flow B — Nowy zakup**: akcja "Dodaj zakup" (zdjęcie stosu LUB ręczne wpisanie) → identyfikacja → wirtualna półka "Zakupione" (systemowa, jedna na użytkownika, nieusuwalna, auto-tworzona przy rejestracji) → opcjonalna data zakupu (domyślnie dziś) → możliwość przeniesienia na realną półkę w dowolnym momencie.
- **Przekładanie książek między półkami** (akcja "Przenieś na półkę X" — działa zarówno z półki "Zakupione" jak i z dowolnej fizycznej).
- **Wyszukiwarka katalogu**: pełnotekstowa po tytule, autorze, wydawnictwie i opisie z bazy zewnętrznej; filtr po **kolorze grzbietu** (paleta ~10 nazwanych kolorów ekstrahowana przez vision); filtr po półce; filtr po statusie read; kombinacje.
- **Status read jako binarka** (`true`/`false`), togglowalny jednym kliknięciem; bez ocen, dat ani postępu.
- **Manualne dodanie książki** (tytuł + autor wpisywane ręcznie) jako fallback, gdy vision nie rozpozna lub gdy user chce dodać bez zdjęcia.

**Wycięte z MVP (przesunięte do `## Non-Goals` w Fazie 6):**

- **Flow C — Re-scan i reconciliation** (kubełki same-shelf / moved-in / missing). Bez tego user musi ręcznie przekładać każdą zmianę — akceptowalne w MVP, bolesne długoterminowo.
- **Identyfikacja serii + numer tomu + widok pojedynczej serii z lukami**. Najmniej dojrzałe dane w bazach + najwięcej pracy na korekty (zgodnie z linią cięcia z seed'a).
- **Filtr po typie oprawy** i **filtr po dekadzie wydania** w wyszukiwarce. Pełnotekst + kolor wystarczają na proof, że in-home find działa.
- **Strukturalne pole okoliczność zakupu** (typ + nazwa + miasto). W MVP tylko data zakupu — okoliczność dorzucamy post-MVP jako swobodny tekst, jeśli telemetria pokaże, że ludzie chcą.
- **Auto-uzupełnianie brakujących tomów serii** ("kup tom 4"). Wymaga serii → wymaga punktu wyżej.

Cięcia są **rewersybilne** — model danych nie blokuje dodania serii / Flow C / okoliczności w przyszłości. To jest decyzja czasowa, nie architektoniczna.

## Functional Requirements

### Autentykacja i konto

- FR-001: Niezalogowany użytkownik może utworzyć konto przez email + hasło. Priority: must-have
- FR-002: ~~Niezalogowany użytkownik może utworzyć konto przez Google OAuth.~~ **DEFERRED do post-MVP** (Socrates round Phase 4.5).
  > Socrates: Counter-argument considered: "nice-to-have w MVP często = 'nigdy', bo czas się kończy; lepiej szczerze wycofać do post-MVP niż utrzymywać pozór gotowości." Resolution: dropped from MVP; wpisany do Non-Goals jako świadomy post-MVP follow-up. Email+hasło wystarcza do dowiezienia certyfikacji w oknie czasowym.
- FR-003: Zalogowany użytkownik widzi tylko dane przypisane do swojego konta (półki, książki, zdjęcia, telemetria). Priority: must-have
- FR-004: Niezalogowany użytkownik próbujący wejść na chronioną ścieżkę jest przekierowywany na ekran logowania. Priority: must-have

### Półki — CRUD i organizacja

- FR-005: Użytkownik może utworzyć półkę, podając nazwę i opcjonalnie lokalizację domową (np. "Salon, ściana zachodnia"). Priority: must-have
- FR-006: Użytkownik może edytować nazwę i lokalizację własnej półki. Priority: must-have
- FR-007: Użytkownik może usunąć własną półkę; książki znajdujące się na niej trafiają na wirtualną półkę "Zakupione" (nigdy nie znikają z katalogu wraz z półką). Priority: must-have
  > Socrates: Counter-argument considered: "nieintuicyjne — user może myśleć, że usuwa też książki." Resolution: kept; obowiązkowy explicit confirm dialog pokazujący liczbę książek do przesunięcia ("Usuwasz półkę X. 47 książek przejdzie na półkę Zakupione. Potwierdź."). Defensywne UX > ukryta semantyka.
- FR-008: Użytkownik ma jedną systemową wirtualną półkę "Zakupione" tworzoną automatycznie przy rejestracji, której nie może usunąć ani zmienić nazwy. Priority: must-have
- FR-009: Użytkownik może przeglądać listę swoich półek z liczbą książek na każdej. Priority: must-have

### Upload zdjęcia i vision-pipeline

- FR-010: Użytkownik może wgrać jedno zdjęcie półki (drag-and-drop lub wybór z dysku) przypisane do wybranej fizycznej półki. Priority: must-have
  > Socrates: Counter-argument considered: "regal z 4 półkami = 4 oddzielne uploady, może to za dużo tarcia przy kolekcji 30+ półek." Resolution: kept; vision-LLM lepiej radzi sobie z pojedynczą półką (ramy odniesienia), UI jednoznaczne, multi-shelf detection to przedwczesna optymalizacja przy MVP. Batch upload sekwencyjny jako post-MVP follow-up, jeśli telemetria pokaże tarcie.
- FR-011: System przetwarza wgrane zdjęcie przez vision-LLM i wydobywa listę detekcji grzbietów (tytuł, autor, confidence, dominujący kolor grzbietu z palety ~10 nazwanych kolorów). Priority: must-have
- FR-012: System pokazuje status przetwarzania zdjęcia (pending / processing / done / failed) z widocznym wskaźnikiem postępu dla operacji > 2 s. Priority: must-have
- FR-013: System persistuje wszystkie detekcje w bazie przed rozpoczęciem matchingu (idempotencja przy retry). Priority: must-have
- FR-014: Przy nieudanym przetworzeniu (timeout, błąd modelu, walidacja Zod) użytkownik może uruchomić przetwarzanie ponownie bez tworzenia duplikatów detekcji. Priority: must-have

### Matching z bazą zewnętrzną i propozycje

- FR-015: Dla każdej detekcji system odpytuje publiczną bazę książek (primary + fallback) i wybiera kandydatów z metadanymi: tytuł, autor(zy), wydawnictwo, rok wydania, ISBN, okładka, krótki opis. Priority: must-have
  > Socrates: Counter-argument considered: "polskie wydania z lat 80. / samizdat mogą nie istnieć w żadnej publicznej bazie." Resolution: kept; jeśli żaden kandydat nie ma match_score ≥ 0.55, propozycja brzmi "brak matchu — wpisz ręcznie", a FR-021 obsługuje tę ścieżkę. Detekcja jest persistowana z raw_title/raw_author niezależnie od matchu — żadna informacja z vision nie znika.
- FR-016: System liczy match_score dla każdego kandydata (podobieństwo tytułu × podobieństwo autora + bonus za ISBN) i progresji: ≥ 0.75 = pre-zaznaczone, 0.55–0.75 = wymaga potwierdzenia, < 0.55 = "wpisz ręcznie". Priority: must-have
  > Socrates: Counter-argument considered: "te progi są arbitralne, nie testowane na realnych danych." Resolution: kept jako wartości startowe; Acceptance rate ≥ 75% jest Primary KPI, telemetria korekt pokaże, czy progi wymagają strojenia. Tuning po pierwszym miesiącu używania — wpisany jako follow-up w `## Open Questions`.
- FR-017: Przed pokazaniem propozycji system sprawdza, czy użytkownik już ma daną książkę w katalogu (po ISBN lub fuzzy-match tytuł+autor) i flaguje ją jako "duplikat z półki X". Priority: must-have
  > Socrates: Counter-argument considered: "co znaczy 'duplikat' przy różnych wydaniach tej samej książki (np. Diuna Iskry '86 vs Rebis '03)?" Resolution: kept; różne ISBN = różne rekordy książek (kolekcjoner widzi, że ma trzy Diuny), ale UI pokazuje flagę "masz inną edycję tej książki" przy propozycji — user świadomie decyduje, czy to nowy egzemplarz, czy duplikat. ISBN jest dominującym sygnałem dedupe, fuzzy tytuł+autor to fallback dla książek bez ISBN.
- FR-018: Użytkownik widzi listę propozycji per zdjęcie: dla każdego rozpoznanego grzbietu — najlepiej dopasowana książka + 2–4 alternatywy + akcje **accept / reject / correct**. Priority: must-have
- FR-019: Użytkownik może edytować pola propozycji (tytuł, autor, wydawnictwo, rok) przed jej zaakceptowaniem; korekta jest zapisywana w tabeli `corrections` jako sygnał telemetryczny. Priority: must-have
- FR-020: Użytkownik może odrzucić propozycję (np. vision wymyślił grzbiet, którego nie ma); odrzucenie jest zapisywane jako korekta typu `reject`. Priority: must-have
- FR-021: Użytkownik może wpisać książkę ręcznie (tytuł + autor + opcjonalnie wydawnictwo, rok, ISBN), gdy żadna propozycja nie pasuje lub gdy chce dodać bez zdjęcia. Priority: must-have
  > Socrates: Counter-argument considered: "równoległa ścieżka manual może zachęcić do unikania vision-pipeline'u i obniżyć jego adoption." Resolution: kept; vision-pipeline i manual to dwie komplementarne ścieżki, nie konkurencyjne. Manual jest "safety net" dla książek bez ISBN (polskie wydania lat 80., samizdat) i niezbędny dla 90s Time-to-add-purchase w Flow B. Bez manual user blokuje się przy edge case'ach.

### Katalog i status read

- FR-022: Po akceptacji propozycji książka trafia do katalogu z domyślnym statusem read = false i przypisaną pozycją na półce ("od lewej"). Priority: must-have
- FR-023: Użytkownik może przełączyć status read książki (true ↔ false) jednym kliknięciem w widoku półki lub w widoku książki. Priority: must-have
- FR-024: Użytkownik widzi pojedynczą półkę z książkami w kolejności od lewej, z okładkami i znacznikami przeczytania. Priority: must-have

### Flow B — Nowy zakup

- FR-025: Użytkownik może otworzyć akcję "Dodaj zakup" z dowolnego widoku katalogu. Priority: must-have
- FR-026: W ramach "Dodaj zakup" użytkownik może wybrać metodę: zdjęcie stosu (vision-pipeline) LUB wpisanie ręczne. Priority: must-have
- FR-027: Książki dodane przez "Dodaj zakup" trafiają na wirtualną półkę "Zakupione" zamiast na fizyczną. Priority: must-have
- FR-028: Użytkownik może opcjonalnie wpisać datę zakupu (domyślnie = dziś) na każdej zaakceptowanej książce w Flow B. Priority: must-have
  > Socrates: Counter-argument considered: "bez okoliczności zakupu sama data daje mało, to komplikacja UI za nic." Resolution: kept; data sama umożliwia sortowanie "co kupiłem w 2025", pole opcjonalne nie tworzy tarcia (domyślnie = dziś, jedno enter wystarczy). Okoliczność świadomie wycięta do post-MVP — strukturalne pole + autouzupełnianie naruszyłyby KPI 90s Flow B.
- FR-029: Każda książka w katalogu istnieje na dokładnie jednej "półce" (fizycznej lub wirtualnej "Zakupione") — nie ma stanu "bez półki". Priority: must-have
  > Socrates: Counter-argument considered: "co jeśli user chce książkę 'odlozoną' — nie na półce, nie w 'Zakupione', tylko 'wyniosłem do biura'?" Resolution: kept; user tworzy fizyczną półkę o nazwie "Biuro" albo "Wypożyczone" — to rozszerza model przez samą nazwę, bez nowych pól/statusów w bazie. Brak stanu "limbo" upraszcza statystyki, walidację, RLS i widoki.

### Przekładanie książek

- FR-030: Użytkownik może przenieść książkę z dowolnej półki (w tym "Zakupione") na inną półkę przez akcję "Przenieś na półkę X". Priority: must-have
- FR-031: Po przeniesieniu data zakupu i ewentualne ręczne metadane książki pozostają na rekordzie (nie znikają wraz z półką źródłową). Priority: must-have

### Wyszukiwarka katalogu

- FR-032: Użytkownik może wyszukać książkę pełnotekstowo po tytule, autorze, wydawnictwie i krótkim opisie z bazy zewnętrznej. Priority: must-have
- FR-033: Użytkownik może filtrować wyniki po **kolorze grzbietu** (paleta ~10 nazwanych kolorów). Priority: must-have
  > Socrates: Counter-argument considered: "czy ~10 kolorów wystarczy, a co jeśli vision-LLM dla ciemnozielonego raz da 'green', raz 'dark-green'?" Resolution: kept; vision dostaje w prompcie zamkniętą listę dozwolonych enum-ów, Zod schema waliduje wyjście (odrzucenie → retry), przy fallback do "inny" user może ręcznie poprawić. Spójność wymuszona od strony walidacji, nie modelu. Paleta jako część kontraktu vision-promptu jest jednym z load-bearing artefaktów MVP.
- FR-034: Użytkownik może filtrować wyniki po półce (multi-select). Priority: must-have
- FR-035: Użytkownik może filtrować wyniki po statusie read (read / unread / wszystko). Priority: must-have
- FR-036: Użytkownik może kombinować wyszukiwanie pełnotekstowe z dowolnym zestawem filtrów (kolor + półka + read). Priority: must-have

### Telemetria

- FR-037: System zapisuje każdą korektę (zmiana pola tytuł/autor/wydawnictwo/rok, akceptacja, odrzucenie, ręczne dodanie) jako rekord w tabeli `corrections` powiązany z detekcją i użytkownikiem. Priority: must-have
- FR-038: System zapisuje przeniesienia książek między półkami jako wersjonowane wpisy `shelf_entries` (poprzedni z `is_current = false`, nowy z `is_current = true`). Priority: must-have
- FR-039: System zapisuje koszty (token usage, USD) i latencję każdego wywołania vision-LLM na rekordzie zdjęcia. Priority: must-have

**Socrates round Phase 4.5 — pokrycie:** rozegrano sfokusowaną rundę Socratesa na 10 FR-ach o największym ładunku decyzyjnym (FR-002, FR-007, FR-010, FR-015, FR-016, FR-017, FR-021, FR-028, FR-029, FR-033). Pozostałe FR-y (~29) zostały świadomie pominięte — nie zidentyfikowano dla nich genuinnego counter-argumentu poza domyślnym "could we skip this entirely?", który dla operacji autoryzacji / CRUD półki / persistowania detekcji nie tworzy realnej decyzji. Każdy z pominiętych FR-ów stoi as written; jeśli ktoś w przyszłym review podniesie jeden z nich, należy dodać blockquote `> Socrates:` inline pod tym FR.

## Business Logic

BookShelf przekształca pojedyncze zdjęcie półki w listę propozycji wpisów do osobistego katalogu książek, gdzie każda propozycja niesie mierzalną pewność dopasowania do publicznej bazy oraz informację o ewentualnym duplikacie w katalogu użytkownika — użytkownik akceptuje, koryguje lub odrzuca, a system rejestruje każdą decyzję jako sygnał uczący.

Reguła konsumuje **dwa rodzaje wejścia użytkownika**: (1) zdjęcie półki wgrane jednorazowo dla danej fizycznej lokalizacji, (2) ręczny wpis tytułu i autora dla książek, które vision pomija lub które nie istnieją w publicznych bazach. Wejście pierwsze uruchamia pełen łańcuch identyfikacji; wejście drugie pomija identyfikację i wchodzi bezpośrednio do katalogu z konfidencją "manual = 1.0". Oba kończą się tym samym artefaktem: pozycją w katalogu książek użytkownika z lokalizacją na półce, statusem przeczytania i metadanymi pochodzącymi z bazy zewnętrznej.

Wyjściem reguły dla każdej detekcji jest **uporządkowana propozycja**: najlepszy kandydat (tytuł, autor, wydawnictwo, rok, okładka, ISBN jeśli dostępny) + 2–4 alternatywy + flaga "masz tę książkę już w katalogu na półce X" jeśli dedupe wykrył duplikat. Propozycja jest progowana — kandydaci z pewnością ≥ 0.75 są pre-zaznaczeni do akceptacji, między 0.55 a 0.75 wymagają explicit potwierdzenia, poniżej 0.55 prowokują "wpisz ręcznie". Użytkownik widzi listę propozycji, klika "akceptuj wszystkie pre-zaznaczone" lub przegląda po kolei.

W produkcie reguła ujawnia się w **trzech punktach kontaktu**: (a) widok przeglądu propozycji bezpośrednio po wgraniu zdjęcia (Flow A i Flow B); (b) wynik wyszukiwarki "masz tę książkę?" pokazujący zarówno trafienia, jak i pozycję na półce (in-bookstore + in-home moment); (c) tabela korekt, do której wpada każde odchylenie od domyślnej propozycji — fundament telemetrii, na której strojone są progi i prompt vision.

Reguła **nie jest** pustym CRUD-em: system aktywnie **decyduje** (1) co rozpoznać na zdjęciu, (2) z jaką pewnością dopasować do bazy, (3) czy oznaczyć jako duplikat, (4) jak rankować alternatywy, (5) czy uczyć się z odchyleń. Pięć decyzji domenowych dla każdej książki, których nie da się sprowadzić do "user dodaje rekord".

## Non-Functional Requirements

- Użytkownik widzi potwierdzenie wgrania zdjęcia w czasie < 200 ms od kliknięcia, a postęp przetwarzania vision-pipeline'u jest ciągle widoczny dla operacji trwających dłużej niż 2 sekundy.
- Po zalogowaniu widoki nawigacji po katalogu (lista półek, widok pojedynczej półki, wyniki wyszukiwarki dla zapytania zwracającego do ~1000 pozycji) reagują w czasie p95 < 1 s mierzonym od kliknięcia do pełnego renderu.
- Użytkownik A pod żadnym warunkiem nie widzi danych użytkownika B; zapytanie do API z prawidłowym tokenem A o identyfikator zasobu należącego do B zwraca jednoznaczny brak ("nie ma takiego zasobu"), bez ujawniania, że taki zasób istnieje dla innego użytkownika.
- Zdjęcie wgrane do storage, ale jeszcze nieprzetworzone przez vision-pipeline, nie znika po awarii, restarcie ani błędzie sieci; ponowne uruchomienie przetwarzania nie tworzy duplikatów detekcji ani książek.
- Aplikacja jest w pełni używalna na dwóch najnowszych wersjach głównych przeglądarek desktop (Chrome, Firefox, Safari, Edge); dla momentu in-bookstore widoki **wyszukiwarki katalogu, widoku książki i widoku półki** są czytelne i funkcjonalne na telefonach z ekranami od 360 px szerokości w portrait orientation.
- Interfejs użytkownika jest **w całości po polsku**; brak przełącznika języka i brak osobnych ścieżek lokalizacyjnych w MVP.
- Treść UI spełnia podstawowe wymogi dostępności: semantyczny HTML, kontrast tekstu względem tła ≥ 4.5:1 dla normalnego tekstu, widoczny focus state na elementach interaktywnych, alt-texty na okładkach książek (tytuł + autor). Pełny WCAG-AA audit świadomie poza scope MVP.
- Każde wywołanie vision-LLM ma zarejestrowany koszt (USD) i latencję dostępne operatorowi, tak aby możliwe było ustalenie kosztu jednostkowego przetworzonej półki bez inspekcji kodu.

## Non-Goals

Świadome cuts — rzeczy, których MVP **nie robi**. Każda wpisana tu pozycja ma jednoznaczne uzasadnienie, dlaczego nie jest w scope, żeby nie wracała tylnymi drzwiami w trakcie implementacji.

**Cuts ze Slice B (świadoma redukcja względem pełnego seed'a — żeby zmieścić się w oknie 18.05 → 5.07.2026):**

- **Flow C — Re-scan i reconciliation (kubełki same-shelf / moved-in / missing)** — wymaga skomplikowanej logiki diff'owej dla książek już w katalogu i UI obsługującej trzy stany decyzyjne. Bez tego user musi ręcznie przekładać każdą zmianę; akceptowalne w MVP, post-MVP rozwiązuje "catalog-stays-current".
- **Identyfikacja serii + numer tomu + widok pojedynczej serii z lukami ("brakuje tomu 4 i 7")** — najmniej dojrzałe dane w publicznych bazach, najwięcej pracy na korekty; zgodnie z linią cięcia z seed'a, pkt 1.
- **Filtr po typie oprawy (twarda/miękka) i filtr po dekadzie wydania** w wyszukiwarce — pełnotekst + kolor wystarczają, by potwierdzić, że in-home find działa.
- **Strukturalne pole "okoliczność zakupu"** (typ + nazwa + miasto + autouzupełnianie) — naruszyłoby KPI Time-to-add-purchase ≤ 90 s; w MVP tylko opcjonalna data zakupu.
- **Auto-uzupełnianie brakujących tomów serii ("kup tom 4")** — wymaga identyfikacji serii (pierwszy cut wyżej).
- **Manualne dodawanie jako pełny CRUD bez vision** — manual istnieje wyłącznie jako tryb "correct" w propozycji (FR-021); nie ma osobnego "Dodaj książkę z menu", żeby nie zachęcać do unikania vision.

**Cuts z głównego seed'a (świadomy strategiczny zakres MVP):**

- **Aplikacja mobilna / native iOS/Android** — desktop-first; mobile responsive tylko dla read-path (wyszukiwarka, widok książki, widok półki).
- **Camera capture w przeglądarce** (robienie zdjęcia na żywo) — tylko upload z dysku.
- **Skanowanie kodów kreskowych ISBN** — drugi sposób input'u, nie MVP.
- **Batch upload wielu zdjęć naraz** — w MVP pętla po jednym zdjęciu.
- **Współdzielenie półek między użytkownikami** (rodzina, współlokatorzy, znajomi) — single-user = single-collection, świadomy ograniczenie wymagające ról / kolekcji jako osobnego bytu w przyszłości.
- **Wypożyczanie książek + dziennik czytania (postęp w stronach, data początku/końca)** — w MVP tylko binarna flaga `read`.
- **Oceny + recenzje** — brak. Status `read` jest binarny: przeczytana / nieprzeczytana, koniec.
- **Rekomendacje "co przeczytać dalej" / "podobne książki"** — to byłaby kolejna reguła domenowa, poza zakresem MVP.
- **Wyszukiwanie semantyczne** (embeddings opisów: "książki o smokach", "coś o II wojnie") — w MVP tylko pełnotekst po fragmencie opisu z Google Books.
- **Wyszukiwanie obraz-po-obrazie / pełny kolor RGB okładki / embeddingi wizualne** — w MVP nazwane kolory grzbietu z paletą ~10.
- **OCR pojedynczych słów z fotografii półki jako tryb wyszukiwania** — odrębne narzędzie.
- **Import z Goodreads / lubimyczytac / plików CSV** — brak migration path z konkurencyjnych platform.
- **Eksport katalogu (CSV, JSON)** — łatwy do dodania post-MVP, ale nieobecny w MVP.
- **Offline mode / PWA / cache** — wymaga sieci.
- **Edycja zdjęcia w przeglądarce (crop, rotate)** — vision-LLM radzi sobie z surowym wejściem.
- **Wiele profili / wielokrotne kolekcje na jednym koncie** — jeden user = jedna kolekcja.
- **Integracja z lubimyczytac jako źródło danych** — tylko deep-link do strony książki, jeśli w ogóle.

**Cuts z Socrates Round Phase 4.5:**

- **Google OAuth** (FR-002 deferred) — nice-to-have w MVP rzadko ląduje na produkcji; szczerze do post-MVP follow-up. Email + hasło wystarcza.

**Non-functional non-goals:**

- **Pełen WCAG-AA audit** — w MVP tylko podstawy (semantyczny HTML, kontrast ≥ 4.5:1, focus visible, alt-texty). Pełen audit + screen reader testy + ARIA polish to ~1–2 tygodnie pracy poza budżetem.
- **Internationalizacja (PL+EN toggle ani English-first)** — UI w całości po polsku; brak warstwy i18n.
- **Multi-region SLA / 99.9% uptime / formal compliance (poza baseline GDPR)** — projekt zaliczeniowy, nie produkt komercyjny.

## Forward: PRD frontmatter (do podniesienia przez /10x-prd)

Te wartości mapują się 1:1 na pola frontmatter PRD per schemat:

```yaml
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 6
  hard_deadline: 2026-07-05
  after_hours_only: true
```

**Uzasadnienia (do `## Open Questions` PRD jeśli któryś budzi wątpliwości):**

- `mvp_weeks: 6` — Slice B mieści się w 5–6 tygodniach intensywnej pracy po godzinach. Wartość już acknowledged jako "above default 3-week threshold" w sekcji `## Timeline acknowledgment` powyżej.
- `target_scale.users: small` — projekt zaliczeniowy + kilka beta-testów; nie planowane wyjście na publiczną platformę w MVP.
- `target_scale.qps: low` + `data_volume: small` — jeden user, jedna kolekcja ~1000 książek, ~30 zdjęć przetworzonych przez vision-LLM w ciągu pierwszego miesiąca.
- `hard_deadline: 2026-07-05` — 1. termin certyfikacji 10xDevs 3.0.

## Forward: tech-stack (do downstream tech-stack-selector — NIE część PRD)

Stack już zdecydowany w CLAUDE.md (decyzje wniesione poza /10x-shape), nie podlega `/10x-prd`. Notatka informacyjna dla downstream:

- Astro 6 (SSR) + React 19 islands + TypeScript strict + Tailwind 4
- Backend: Astro endpoints na Cloudflare Pages (Workers runtime, nie Node)
- DB: Supabase Postgres + RLS od dnia 1
- Storage: Supabase Storage (bucket `photos/`)
- Auth: Supabase Auth (email + hasło)
- Vision LLM: Claude Sonnet 4.6 (multimodal) — Anthropic API direct
- Walidacja LLM I/O: Zod schemas
- Book metadata: Google Books API (primary) + OpenLibrary (fallback)
- Testy: Vitest (unit) + Playwright (E2E)
- CI: GitHub Actions

Wybór nie podlega ponownej walidacji w `/10x-prd` — sekcja istnieje wyłącznie po to, by downstream skille (tech-stack-selector) miały o tym wiedzę i nie próbowały re-otworzyć decyzji.

## Forward: technical-roadmap (do downstream technical-planner — NIE część PRD)

Tylko surowy bullet list, do uzupełnienia przez kolejny skill w łańcuchu:

- Implementacja w 5 milestonach: M1 (Supabase init + auth + CRUD półek), M2 (upload zdjęcia + vision-pipeline + persistence), M3 (matching + propozycje + akceptacja), M4 (Flow B + wirtualna półka "Zakupione" + przekładanie), M5 (wyszukiwarka + kolor grzbietu + finalny CI + deploy).
- CI workflow: lint → typecheck → vitest → playwright → deploy CF Pages.
- Sekrety w GitHub Secrets: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_API_TOKEN, GOOGLE_BOOKS_API_KEY.
- Reality check vision już zrobiony (recall 100%, precision ~82% na polskiej półce — z CLAUDE.md).

## Quality cross-check

Cross-check Phase 7 wykonany 2026-05-19. Wszystkie 5 elementów wymaganych przez greenfield gate jest obecnych. Status: **accepted** — brak gap'ów do mirrorowania w `## Open Questions` PRD.

| Element | Status | Notatka |
|---|---|---|
| Access Control | present | Multi-user, email+hasło (Google OAuth defer), flat model, redirect-on-protected-route |
| Business Logic (one-sentence rule) | present | Jedno zdanie + 4 supporting paragraphs, 5 decyzji domenowych jawnie nazwanych |
| Project artifacts | present | shape-notes.md z pełnym frontmatter + checkpoint |
| Timeline-cost ack | present | Explicit `## Timeline acknowledgment` block, mvp_weeks=6 powyżej domyślnego progu 3, użytkownik świadomie zaakceptował koszt sustained-effort |
| Non-Goals | present | 25+ świadomych cuts pogrupowanych: Slice B + seed strategic + Socrates + non-functional |

**Otwarte pytania z seed'a, które nie zostały rozstrzygnięte w sesji `/10x-shape` (do `## Open Questions` PRD):**

Wszystkie poniższe są wprost zaadresowane przez świadome cuts do Slice B (i większość wpadła do `## Non-Goals` w odpowiednim miejscu), ale `/10x-prd` powinien je formalnie wymienić w sekcji `## Open Questions` jako:

1. **Próg auto-accept dla matching (FR-016 progi 0.75 / 0.55)** — startowe wartości, do tuningu po pierwszym miesiącu używania na podstawie telemetrii korekt.
2. **Paleta kolorów grzbietu (FR-011, FR-033)** — finalne ~10 nazwanych enum-ów do zaproponowania w prompcie vision; precyzyjna lista do iteracji przed M3.
3. **Definicja "duplikatu" przy różnych wydaniach (FR-017)** — kept jako "różne ISBN = różne rekordy + flaga edycji"; tuning UX flag w testach.
4. **Eskalacja modelu vision (Sonnet → Opus) przy padających detekcjach** — z seed; w MVP tylko Sonnet, Opus jako post-MVP fallback.
5. **Polityka książek bez ISBN w matchingu (FR-017)** — fuzzy tytuł+autor z wyższym progiem; nieformalna obecność w blockquote FR-017, ale wymaga eksplicytnego threshold'u przed M3.

## User Stories

### US-01: Bootstrap pierwszej półki (Flow A — primary path)

- **Given** świeżo zarejestrowany użytkownik bez żadnych półek w katalogu
- **When** utworzy półkę "Salon, ściana zachodnia", wgra zdjęcie tej półki, poczeka aż vision-pipeline zakończy przetwarzanie, a następnie zaakceptuje wszystkie propozycje z confidence ≥ 0.75
- **Then** widzi katalog tej półki z okładkami książek w kolejności "od lewej", każda z domyślnym statusem read = false, czas od kliknięcia "Utwórz konto" do zaakceptowanej półki nie przekracza 5 minut (15–20 książek)

#### Acceptance Criteria
- Vision-pipeline wykrywa ≥ 70% widocznych grzbietów na zdjęciu testowym
- ≥ 75% propozycji ma confidence ≥ 0.75 i jest pre-zaznaczonych do akceptacji
- Po akceptacji widok półki ładuje się w < 1 s (p95)
- Status read każdej nowej książki = false
- Jeśli vision-pipeline padnie, użytkownik może uruchomić go ponownie bez tracenia detekcji ani tworzenia duplikatów

### US-02: Dodanie zakupu z księgarni (Flow B)

- **Given** zalogowany użytkownik z istniejącym katalogiem
- **When** otworzy akcję "Dodaj zakup", wybierze "wpisanie ręczne", wpisze tytuł i autora jednej książki, ustawi datę zakupu (domyślnie = dziś) i zatwierdzi
- **Then** książka pojawia się na wirtualnej półce "Zakupione" z zapisaną datą zakupu, status read = false, cały flow trwa ≤ 90 sekund

#### Acceptance Criteria
- "Dodaj zakup" jest dostępne z każdego głównego widoku katalogu
- Półka "Zakupione" jest tworzona automatycznie i nie wymaga ręcznej konfiguracji
- Książka z półki "Zakupione" jest indeksowana w wyszukiwarce identycznie jak książki z fizycznych półek
- Użytkownik może w dowolnym momencie przenieść książkę z "Zakupione" na fizyczną półkę bez utraty daty zakupu

### US-03: Sprawdzenie w księgarni (in-bookstore moment)

- **Given** zalogowany użytkownik stojący w księgarni z telefonem
- **When** wpisze w wyszukiwarce katalogu fragment tytułu książki, którą rozważa kupić
- **Then** widzi w wynikach informację, czy już ma tę książkę w katalogu (z nazwą półki i statusem read), w czasie < 1 s od wpisania zapytania

#### Acceptance Criteria
- Wyszukiwarka pełnotekstowa działa po fragmencie tytułu (nie wymaga pełnego tytułu)
- Wynik pokazuje nazwę półki i status read dla każdej znalezionej książki
- Brak wyników wyświetla jednoznaczny komunikat "nie masz tej książki" (nie pustą listę)

### US-04: Znalezienie książki w domu po atrybutach pośrednich (in-home moment)

- **Given** zalogowany użytkownik szukający konkretnej książki w domowej kolekcji liczącej kilkaset pozycji
- **When** pamięta tylko fragmenty: "czerwony grzbiet, coś o smokach, wydawnictwo Iskry" i wpisze "smok" w wyszukiwarce, ustawi filtr koloru grzbietu = "czerwony"
- **Then** widzi listę ≤ 3 kandydatów, w której znajduje się szukana książka, z nazwą półki i pozycją na półce

#### Acceptance Criteria
- Wyszukiwanie pełnotekstowe obejmuje pole krótki opis z bazy zewnętrznej (nie tylko tytuł)
- Filtr koloru grzbietu jest kombinowalny z polem tekstowym
- Wyniki pokazują dla każdej książki: nazwę półki + pozycję na półce ("od lewej")
- Łączne wyniki dla kolekcji ~50–100 książek testowych mieszczą się w ≤ 3 pozycjach w ≥ 80% prób testowych
