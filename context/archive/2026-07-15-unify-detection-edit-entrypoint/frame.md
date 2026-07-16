# Frame Brief: Jeden punkt wejścia do edycji detekcji

> Etap ramowania przed /10x-plan. Ten dokument przedstawia, co *faktycznie*
> jest problemem, oddzielone od tego, co początkowo zakładano.

## Zgłoszona obserwacja

W widoku karty detekcji z matchem przycisk „Szukaj po tytule" (obok „Popraw") i sekcja
„Wyszukaj po danych" wewnątrz okna podglądu propozycji (BookModal) wyglądają jak ta sama
funkcjonalność — dubel wprowadzający w błąd.

## Początkowe ramy (zachowane)

- **Podana przyczyna/podejście usera**: zakłada, że w tle wołane są te same funkcje w obu
  miejscach (czysta duplikacja UI nad tym samym silnikiem wyszukiwania).
- **Proponowany kierunek usera**: przenieść „Oryginalny odczyt OCR" do okna podglądu
  propozycji, od razu pokazywać propozycje w sekcji „Wyszukaj po danych", usunąć osobną
  funkcję „Szukaj po tytule".
- **Zawężenie przed wysyłką** (odpowiedzi na pytania Kroku 1.5): user doprecyzował własnymi
  słowami szerszą zasadę, silniejszą niż pierwotne ramy — *„powinien być jeden przycisk
  tylko w podglądzie, aby cokolwiek zrobić poza akceptacją lub odrzuceniem należy wejść
  przez Popraw albo klikając w obrazek okładki (lub placeholder) — tam powinny być
  wszystkie inne opcje"*. Na pytaniu „co bardziej przeszkadza" user odpowiedział „oba
  równo" (bałagan wizualny i niespójny efekt działania są tak samo ważne).

## Mapa wymiarów

Obserwacja może pochodzić z któregokolwiek z tych wymiarów:

1. **Duplikacja czysto wizualna (dwa przyciski, ten sam efekt)** — hipoteza literalna
   usera: dwa UI-wejścia do identycznej operacji.
2. **Duplikacja silnika bez duplikacji semantyki zapisu** — oba wołają
   `findBookCandidates`, ale różnią się skutkiem ubocznym (auto-persist vs. explicit
   apply).
3. **Rozjazd stanów karty (match vs. no-match)** — każdy stan ma WŁASNY, niekompletny zestaw
   akcji edycji, żaden nie pokrywa wszystkiego.
4. **Drift od pierwotnej architektury `BookModal`** — moduł miał od początku (2026-06-06)
   być jedynym miejscem edycji; RematchForm/CorrectForm to równoległe, nigdy niescalone
   ścieżki.  ← tu wylądowało przeformułowanie

## Badanie hipotez

| Hipoteza | Dowody | Werdykt |
| --- | --- | --- |
| 1. Duplikacja czysto wizualna | Oba przyciski faktycznie wołają `findBookCandidates` — `DetectionReview.tsx:1607` (rematch-button) → `POST /api/detections/[id]/rematch` → `rematch.ts:8`; `BookModal.tsx:352-358` (search-candidates-toggle) → `POST /api/books/candidates` → `candidates.ts:6`. Ale to nie cała historia. | SŁABE — prawdziwe, ale niekompletne |
| 2. Ten sam silnik, różna semantyka zapisu | `rematch.ts:20-27`: „Aktualizuje raw_title/raw_author, zastępuje book_candidates" z `CONSERVATIVE_REPLACE_MARGIN` — auto-persist. `BookModal.tsx` search panel (`search()`, linia 300-335) — czyste wyszukiwanie, `setResults()`, zero zapisu do DB; zapis dopiero po jawnym „Zapisz"/apply w dalszej części modala. | SILNE |
| 3. Rozjazd stanów karty match/no-match | **Match** (`DetectionReview.tsx:1574-1618`): 4-6 przycisków w rzędzie — Akceptuj, Odrzuć, **Popraw** (`correct-button:1597` → `setShowCandidateDetail(true)`), **Szukaj po tytule** (`rematch-button:1607` → RematchForm), + WebSearchButton + RefineButton. Klik okładki (`candidate-cover-button:1488`) i „Popraw" **już** prowadzą do TEGO SAMEGO stanu (`showCandidateDetail`) → `BookModal mode="propose"` (`DetectionReview.tsx:1663-1677`) — częściowo zbieżne z celem usera. **No-match** (`DetectionReview.tsx:1385-1416`): BRAK klikalnej okładki/placeholdera — sam tekst „Brak pewnego matchu" + dwa pełnej szerokości przyciski obok siebie: „Szukaj po tytule" (RematchForm) i „Wpisz ręcznie" (`manual-entry-button:1410` → osobny `CorrectForm` → `POST /api/detections/[id]/correct`, **żadnego wyszukiwania**, inny endpoint niż obie pozostałe ścieżki). Trzy różne mechanizmy edycji rozproszone na dwa niespójne stany karty. | SILNE |
| 4. Drift od architektury `BookModal` | `context/archive/2026-06-06-unified-book-modal/plan.md`: cel wprost — „Skonsolidować rozproszone dziś ścieżki pracy z książką w jeden duży, reużywalny komponent modalny... propose (klik kandydata w review) → metadane read-only + okładka + Szukaj w sieci (akcja akceptacji kandydata zostaje w DetectionReview)". Propose mode od tamtej pory realnie się rozrosło (komentarz w `BookModal.tsx:58`: „candidate-propose-edit-all-fields" — pełne `BookFields`), ale RematchForm i CorrectForm nigdy nie zostały w to wciągnięte — zostały jako równoległe, nieco inne ścieżki tylko dla stanu no-match. `context/archive/2026-06-21-confirm-vision-rematch/plan.md` traktuje RematchForm jako już-istniejący, osobny fakt („form jest już potwierdzeniem") — nie ma śladu świadomej decyzji architektonicznej o trwałym rozdzieleniu. | SILNE |

## Sygnały zawężające

- User: „jeden przycisk tylko w podglądzie... wszystkie inne opcje" — wprost formułuje
  zasadę architektoniczną (jeden entry point), nie tylko skargę na dwa konkretne przyciski.
  To eliminuje hipotezę 1 (czysto wizualna) jako pełne wyjaśnienie — user explicite chce
  zmiany strukturalnej, nie tylko usunięcia jednego przycisku.
- User: „(lub placeholder)" — świadomie objął stan no-match (gdzie dziś nie ma żadnej
  okładki/placeholdera do kliknięcia), nie tylko stan match. To potwierdza hipotezę 3
  (rozjazd stanów) jako centralną, nie poboczną.
- User: „oba równo" (UX-bałagan i niespójny zapis tak samo ważne) — potwierdza, że
  hipoteza 2 (różna semantyka zapisu) NIE jest szumem do zignorowania, tylko część
  właściwego problemu do rozwiązania w planie, nie tylko w warstwie wizualnej.

## Konwencja między systemami

Ten projekt ma już precedens tej samej klasy problemu na poziomie silnika: lekcja
„Auto-match i ręczny rematch muszą używać tej samej funkcji wyszukiwania kandydatów"
(`context/foundation/lessons.md`) — `match.ts`/`rematch.ts` rozjechały się kiedyś na dwie
różne kaskady wyszukiwania i zostały scalone na `findBookCandidates`. Obecny przypadek jest
analogiczny, ale o poziom wyżej: nie silnik się rozjechał (już scalony), tylko **punkty
wejścia UI i ścieżki zapisu** wokół tego samego silnika. Ten sam projekt ma też świeży
precedens świadomej konsolidacji na poziomie komponentu — `unified-book-modal`
(2026-06-06) — którego intencja dokładnie pokrywa się z tym, czego chce user teraz;
różnica jest taka, że tamta konsolidacja nie objęła stanu no-match.

## Przeformułowane sformułowanie problemu

> **Rzeczywisty problem do zaplanowania to**: karta detekcji ma dziś trzy rozjechane,
> częściowo nakładające się ścieżki edycji (RematchForm-search, CorrectForm-manual,
> BookModal.propose-search+edit) rozproszone na dwa niespójne stany (match/no-match),
> zamiast jednego spójnego punktu wejścia do „wszystkiego poza Akceptuj/Odrzuć" —
> zgodnie z pierwotną intencją `unified-book-modal`, która nigdy nie objęła stanu
> no-match.

To coś więcej niż usunięcie jednego zbędnego przycisku. Rozwiązanie tego problemu
oznacza: (a) rozszerzenie `BookModal`/odpowiednika o obsługę stanu no-match (włącznie z
klikalnym placeholderem okładki), (b) decyzję, czy zachowanie zapisu ujednolica się w
stronę „zawsze jawne zatwierdzenie" (jak `/api/books/candidates`) czy zachowuje się
auto-persist rematch.ts gdzieś w nowym przepływie, (c) przeniesienie „Oryginalny odczyt
OCR" do wspólnego miejsca, (d) decyzję co dzieje się z `CorrectForm`/`/api/detections/[id]/correct`
(zostaje jako osobny endpoint pod nowym UI, czy scala się z propose-save).

## Pewność

**WYSOKA** — cztery niezależne dowody z konkretnych plik:linia (button layout, endpoint
side-effects, brak placeholdera no-match, archiwalny plan `unified-book-modal`) zbiegają
się w tym samym punkcie, a user własnymi słowami (bez podpowiedzi z mojej strony)
sformułował zasadę zgodną z tym, co znalazłem w kodzie.

## Co zmienia się dla /10x-plan

Plan nie powinien być „usuń przycisk Szukaj po tytule, dodaj auto-search do Wyszukaj po
danych" (zbyt wąsko — zgubiłoby auto-persist rematch bez świadomej decyzji i nie
rozwiązałoby stanu no-match). Plan powinien objąć: docelowy kształt karty detekcji (tylko
Akceptuj/Odrzuć jako quick actions + jeden entry point edycji dla OBU stanów match/no-match,
włącznie z klikalnym placeholderem okładki dla no-match), świadomą decyzję o semantyce
zapisu (auto-persist vs. explicit apply) w ujednoliconym przepływie, miejsce dla
„Oryginalny odczyt OCR" w nowym UI, oraz los `CorrectForm`/`/api/detections/[id]/correct`
i `WebSearchButton`/`RefineButton` (świadomie odsunięte od zakresu tego frame'a — user
o nich nie wspominał — ale plan powinien jawnie zanotować, że zostają poza zakresem, a nie
przeoczyć je milcząco).

## Referencje

- `src/components/DetectionReview.tsx:1385-1416` (karta no-match), `:1574-1618` (rząd akcji
  match), `:1663-1677` (BookModal propose mount), `:480-555` (RematchForm/handleUseOriginal)
- `src/components/BookModal.tsx:300-364` (search panel „Wyszukaj po danych")
- `src/pages/api/detections/[id]/rematch.ts:20-27` (auto-persist + CONSERVATIVE_REPLACE_MARGIN)
- `src/pages/api/books/candidates.ts` (czyste wyszukiwanie, brak side-effectów)
- `src/pages/api/detections/[id]/correct.ts` (manual entry, brak wyszukiwania)
- `context/archive/2026-06-06-unified-book-modal/plan.md` (pierwotna intencja konsolidacji)
- `context/archive/2026-06-21-confirm-vision-rematch/plan.md` (RematchForm jako fakt bez
  uzasadnienia architektonicznego)
- `context/foundation/lessons.md` → „Auto-match i ręczny rematch muszą używać tej samej
  funkcji wyszukiwania kandydatów" (analogiczny precedens na poziomie silnika)
