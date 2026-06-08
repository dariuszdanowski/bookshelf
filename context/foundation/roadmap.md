---
project: "BookShelf Scanner"
version: 1
status: draft
created: 2026-05-25
updated: 2026-06-09
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: BookShelf Scanner

> Wyprowadzone z `context/foundation/prd.md` (v1) + auto-zsondowanego baseline'u repo (2026-05-25).
> Edytuj-w-miejscu; archiwizuj, gdy zastąpione.
> Wycinki poniżej są w kolejności zależności. Tabela "At a glance" jest indeksem.

## Vision recap

BookShelf Scanner rozwiązuje **koszt onboardingu** katalogu dla kolekcjonerów z 1000+ książek: zamiast godzin ręcznego wpisywania, pojedyncze zdjęcie półki staje się skatalogowanymi wpisami w minuty. Cechą wyróżniającą produktu — tym, co po usunięciu czyni go nieodróżnialnym od zwykłego katalogu — jest ekstrakcja **atrybutów wizualnych grzbietu** (dominujący kolor, pozycja na półce), których nie ma w żadnej publicznej bazie, a które napędzają nawigację po fizycznej kolekcji ("czerwony grzbiet, coś o smokach, wydawnictwo Iskry"). MVP obsługuje równo dwa momenty: katalogowanie ze zdjęcia (Flow A) oraz szybkie dodanie zakupu i sprawdzenie "czy już mam?" w księgarni (Flow B + wyszukiwarka).

## North star

**S-05: użytkownik akceptuje propozycje rozpoznane ze zdjęcia i widzi skatalogowaną półkę** — to moment, w którym pełny Flow A (zdjęcie → detekcja → matching → akceptacja → katalog) działa end-to-end i potwierdza rdzeń hipotezy "minuty, nie godziny", niosąc 3 z 4 Primary KPI: recall rozpoznawania, acceptance rate, time-to-first-shelf.

> Gwiazda przewodnia = najmniejszy kompletny przepływ end-to-end, którego dowiezienie udowadnia rdzeń hipotezy produktu — ustawiony tak wcześnie, jak pozwalają prerekwizyty, bo wszystko inne ma znaczenie tylko wtedy, gdy ten przepływ działa. S-05 wieńczy łańcuch S-01 → S-02 → S-03 → S-04; dopiero jego dostarczenie zamyka US-01.

## At a glance

| ID    | Change ID                    | Outcome (użytkownik może …)                              | Prerequisites | PRD refs              | Status   |
| ----- | ---------------------------- | -------------------------------------------------------- | ------------- | --------------------- | -------- |
| F-01  | data-and-rls-substrate       | (foundation) dane + izolacja per-user gotowe              | —             | FR-003, NFR-privacy   | done     |
| F-02  | api-response-contract        | (foundation) typowany kontrakt odpowiedzi API + guard     | —             | FR-004, NFR-privacy   | done     |
| S-01  | email-password-auth          | zarejestrować się, zalogować, wylogować; ochrona ścieżek  | F-01, F-02    | FR-001, FR-003, FR-004 | done     |
| S-02  | shelves-crud-and-purchased   | tworzyć/edytować/usuwać półki; auto-półka "Zakupione"     | S-01          | FR-005–009            | done     |
| S-03  | shelf-photo-vision-detection | wgrać zdjęcie półki → rozpoznane detekcje grzbietów        | S-02          | FR-010–014, FR-039    | done     |
| S-04  | external-match-and-proposals | zobaczyć propozycje z bazy publicznej + flagi duplikatów  | S-03          | FR-015–018            | done     |
| S-05  | proposal-accept-to-catalog   | akceptować/odrzucać/korygować → katalog + widok półki     | S-04          | FR-019–024, FR-037    | done     |
| S-06  | add-purchase-flow            | dodać zakup (ręcznie/zdjęcie) na półkę "Zakupione"        | S-05, S-02    | FR-025–028            | done     |
| S-07  | move-book-and-history        | przenieść książkę między półkami z historią lokalizacji   | S-05, S-02    | FR-029–031, FR-038    | done     |
| S-08  | catalog-search-and-filters   | wyszukać katalog pełnotekstowo + filtry (kolor/półka/status) | S-05, S-02 | FR-032–036            | done     |
| S-09  | landing-auth-cta             | niezalogowany na `/` widzi CTA do logowania i rejestracji; zalogowany — CTA do biblioteki; logout redirektuje na `/login` zamiast `/` | S-01 | FR-001 (UX adjacent)  | done     |
| S-10  | custom-404-page              | Astro renderuje custom 404 page (Layout + conditional CTA) zamiast default białej strony | — (S-01 adjacent) | UX polish | done     |
| S-11  | health-check-endpoint        | `GET /api/health` zwraca `{data:{status,version,timestamp}}` z F-02 envelope; whitelisted w middleware | F-02 | NFR (monitoring) | done     |
| S-12  | loading-skeleton-component   | Generic React `<Skeleton />` (gray pulsing div) gotowy dla S-03/S-04/S-08 | — | UI substrate | done     |
| S-13  | header-nav-when-auth         | header nav „Moje półki" → /shelves dla auth user'a + landing CTA pivot na /shelves (do czasu /library w S-08) | S-02 | UX polish | done     |
| S-14  | photo-process-reload-recovery | po reloadzie /upload odzyskać stan utkniętego 'processing' (GET /api/photos/[id]) + retry | S-03 | UX recovery | done     |
| S-15  | review-page-nav-entry         | link do strony review (/photos/[id]) z poziomu list półek / katalogu; breadcrumbs; **+** przycisk „Źródłowe zdjęcie" na karcie książki → `/photos/[photo_id]` z aktywnego shelf_entry (is_current=true); graceful ukrycie gdy photo_id=NULL (ręczny wpis) lub zdjęcie usunięte | S-04, S-05 | UX polish | done     |
| S-16  | photo-upload-dedup            | przy wgraniu zdjęcia: wykryj identyczne (hash treści SHA-256), ostrzeż i zaproponuj reuse istniejących detekcji zamiast ponownego (płatnego) vision | S-03 | FR-039 (koszt), NFR (no-dup) | done     |
| S-17  | catalog-description-search    | full-text obejmuje „krótki opis z publicznej bazy" — capture opisu w klientach S-04 + confirm + backfill (re-fetch), rozszerzenie search_text | S-08 | FR-032 (opis, domknięcie) | done     |
| S-18  | photo-detection-overlay       | kliknąć zdjęcie w review → zobaczyć pełny obraz z numerowanymi ramkami (bbox) detekcji + skorelowaną numerowaną listą wykrytych pozycji | S-04, S-05 | FR-010–014 (UX domknięcie) | done     |
| S-19  | manual-cover-match            | w review ręcznie wyszukać Google Books i wybrać trafienie (z okładką + ISBN + metadanymi), gdy auto-match pudłuje lub brak okładki — zastępuje aktywnego kandydata | S-04, S-05 | FR-015–018 (UX domknięcie) | done     |
| S-20  | shelf-statistics              | zobaczyć liczbę zdjęć obok liczby książek na liście półek + blok agregatów (zdjęcia / wykryte / skatalogowane) na widoku półki | S-03, S-05 | FR (UX) | done |
| S-21  | vision-spine-crop-reocr       | poprawić precyzję detekcji na gęsto ustawionych półkach — każdy grzbiet z niską pewnością (`vision_confidence < 0.7`) re-analizowany przez Claude na wyciętym cropie (bbox z S-04) zamiast całego zdjęcia | S-04, S-18 | FR-010–014, FR-039 | proposed |
| S-22  | book-edit-cover-url           | w edycji książki w katalogu: pole „Link do okładki" (URL) z podglądem — wklejenie URL od razu pokazuje miniaturę okładki; pole można wyczyścić | S-05 | FR (UX) | done |
| S-23  | per-detection-rematch         | przycisk „Ponów match" przy pojedynczej detekcji (bez ponownego matchowania całego zdjęcia) — odświeża kandydatów tylko dla tej jednej pozycji | S-04, S-05 | FR-015–018 (UX) | done |
| S-24  | photo-overlay-ux              | w review: a) przycisk toggle show/hide ramek detekcji na zdjęciu; b) kliknięcie zdjęcia → lightbox (modal) z pełnym obrazem i ramkami | S-18 | FR-010–014 (UX) | done     |
| S-25  | detection-list-views          | widok listy detekcji (review) — przełącznik trybu prezentacji: karty rozwinięte (obecne), lista kompaktowana (1 linia/książka), kafelki (okładka + tytuł + badge pewności) | S-04, S-05 | UX polish | done |
| S-26  | admin-panel                   | panel administracyjny: lista użytkowników, flaga AI-enabled (domyślnie false — admin włącza), impersonacja (zaloguj się jako user), usunięcie konta (półki/książki przechodzą do admina), przeniesienie półki między użytkownikami | S-01 | NFR (admin ops) | proposed |
| S-27  | dark-light-mode               | przełącznik trybu ciemnego/jasnego w headerze; preferencja persystowana w localStorage; Tailwind `dark:` variant na całym UI | — | UX (standard) | done |
| S-28  | mobile-responsive             | responsywność mobilna dla ścieżek read (library, shelves, book detail) i write (upload, review karty); Tailwind breakpoints `sm:`/`md:` — desktop-first zachowane, telefon bez poziomego scrollowania | S-05 | NFR (UX) | done     |
| S-29  | photos-crud                   | pełny CRUD dla zdjęć: lista zdjęć per półka (GET /api/photos?shelf_id=), usunięcie zdjęcia z Storage + cascade detections/book_candidates (DELETE /api/photos/[id]), edycja metadanych (PATCH — zmiana shelf_id / retitle); zakładki „Książki / Zdjęcia" na `/shelves/[id]`; badge dla zdjęć z NULL hash (stare duplikaty) | S-03, S-05, **S-30** | FR (zarządzanie zdjęciami) | done |
| S-30  | vision-cost-preservation      | zachowanie historii kosztów vision przy DELETE zdjęć: dodanie `user_id` do `vision_runs` i `refine_calls`, zmiana FK `photo_id` z CASCADE na SET NULL; endpoint `GET /api/account/stats` zwracający łączny koszt i liczbę wywołań per user | S-03 | NFR (integrity kosztów) | done |
| S-31  | user-account-page             | strona `/account`: edycja display_name (PATCH /api/account/profile), zmiana emaila i hasła (Supabase Auth updateUser), sekcja statystyk kosztów vision (z S-30), lista podłączonych kluczy API (z S-32) | S-01 | UX (profil użytkownika) | done |
| S-32  | byok-api-keys                 | własne klucze API do modeli vision (BYOK): tabela `user_api_keys` z szyfrowaniem at rest (pgcrypto/Vault), UI zarządzania kluczami na `/account` (add/delete/test), providerzy: Anthropic / OpenAI / OpenRouter / OpenAI-compatible (base_url+model) | S-31 | FR (multi-provider vision) | done |
| S-33  | byok-pipeline                 | pipeline vision wymaga klucza usera: `/api/photos/[id]/process` sprawdza `user_api_keys`, brak klucza → 403 z linkiem do `/account`; abstrakcja `VisionProvider` w `src/lib/vision/` zastępuje hardkodowany Anthropic SDK; globalny klucz z env wyłączony dla zwykłych userów | S-32 | FR (BYOK enforcement) | done |
| S-34  | shelf-book-view-modes         | tryby widoku książek na `/shelves/[id]`: lista kompaktowa (1 linia), kafelki (okładka+tytuł), szczegółowe panele (obecny); przełącznik z `localStorage` + responsywny default; analogia do S-25 `detection-list-views` | S-29 | UX polish | done |
| S-35  | refine-ux-cost-info           | UX fix przycisków refine: jeden spójny label „Doprecyzuj odczyt" (zamiast mylących dwóch nazw); ⚠ ikona + tooltip przy słabym cropie; widoczna informacja „Dodatkowa analiza AI (płatna)" przy każdym wariancie; opcjonalny dialog potwierdzenia dla `uncertain_localization` | — | UX polish | done |
| S-36  | photo-upload-skip-process     | upload zdjęcia bez uruchamiania vision: checkbox „Analizuj od razu" (domyślnie zaznaczony) w `PhotoUploader`; zdjęcie w stanie `uploaded` widoczne w zakładce Zdjęcia (S-29) z przyciskiem „Analizuj teraz" | S-29 | UX (kontrola kosztu) | done     |
| S-37  | book-to-detection-focus       | „Źródłowe zdjęcie" z karty/modala książki otwiera review spozycjonowany na propozycji TEJ książki: `detection_id` dołożony do GET /api/shelves/[id]/books (+ ścieżka /library), link `/photos/[photo_id]?detection=`, `DetectionReview` czyta param → `setFocusedDetectionId` (overlay pokazuje wtedy tylko 1 ramkę — mechanizm fokusa z S-18) + scroll do karty detekcji; fallback bez `detection_id` (NULL po re-analizie/wpis ręczny) = obecne zachowanie | S-15, S-18 | UX (nawigacja książka→źródło) | done     |
| S-38  | user-onboarding-help          | onboarding warstwowy (M7): instruktażowe empty states z CTA następnego kroku + kontekstowe „?" (`HelpTip`) przy decyzjach kosztowych/nietrywialnych + publiczna strona `/help` (golden path ze screenshotami + FAQ); tour poza zakresem | — | UX (onboarding) | done |
| S-39  | match-rate-limit-resilience   | odporność auto-matchu na 429 GB (M11): retry z backoffem per request w `googleBooks.ts` (2 próby, 500/1500 ms + jitter) + komunikat w review „N pozycji wstrzymał limit" z CTA „Ponów match" — dziś rate-limited detekcje po cichu zostają pending z zerem kandydatów (case usera: 1/14 dopasowane) | S-04 | FR-015–018 (jakość matchingu) | done     |
| S-40  | bbox-quality-validation       | jakość bboxów z vision: **ZAMKNIĘTE jako decision-point** (2026-06-09) — zmierzono, że bbox przez prompt jest nie do naprawienia (v7 i thinking nie ruszyły klastrowania; defekt wrodzony modelowi). Pivot → S-43 identity-first. `PROMPT_VERSION` zostaje v6. Dowody: `change.md` „Wyniki i decyzja" + `docs/image-analysis/bbox-groundtruth/`. | S-04, S-18 | FR-010–014 (jakość detekcji) | done |
| S-43  | vision-identity-first         | przeorientowanie pipeline'u z „ciasny bbox per książka" na ROZPOZNANIE jako cel: model zwraca listę `{kind, title, author, confidence}` (książki/gry) bez wymuszania współrzędnych; główny flow = karty „potwierdź" z kandydatami match + miniaturą; lokalizacja zredukowana do kolejności + przybliżonego markera; rysowanie/edycja bbox tylko jako narzędzie doszczegółowiania gdy model nie rozpozna pozycji (reuse `e2aa2ed`). KPI: title-recall + precyzja + czas review (nie IoU). | S-40, S-04, S-05, S-18 | FR-010–014 (rozpoznanie) | proposed |

## Streams

Pomoc nawigacyjna — grupuje wycinki dzielące łańcuch Prerequisites. Kanoniczna kolejność nadal żyje w grafie zależności poniżej; ta tabela to proponowana kolejność czytania w poprzek równoległych torów.

| Stream | Theme                                   | Chain                                            | Note                                                                 |
| ------ | --------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| A      | Fundamenty (dane + kontrakt API)        | `F-01` / `F-02`                                  | Substrat równoległy; obie warstwy łączą się ze Stream B przy `S-01`. |
| B      | Flow A: od konta do skatalogowanej półki | `S-01` → `S-02` → `S-03` → `S-04` → `S-05`        | Ścieżka krytyczna must-have; kończy się gwiazdą przewodnią `S-05`.    |
| C      | Cykl życia zakupu i lokalizacji         | `S-06` / `S-07`                                  | Oba budują na `S-05` (Stream B), równoległe wzajemnie i ze Stream D. |
| D      | Nawigacja po katalogu                   | `S-08`                                           | Buduje na `S-05` (Stream B); równoległy ze Stream C.                 |
| E      | Polish / UX micro-slice'y                | `S-09` (+ kolejne)                               | Małe niezależne kawałki UX po `S-01`; zaplanowane jako bucket do eksperymentu z równoległą realizacją (3-4 slice'y, 3-4 background agents). |

## Baseline

Co jest już w repo na dzień `2026-05-25` (auto-zsondowane + potwierdzone przez użytkownika).
Foundations poniżej zakładają obecność tych warstw i ich NIE odtwarzają.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4 zbootstrapowane (`src/pages/index.astro`, `src/layouts/Layout.astro`, `src/styles/global.css`); build wychodzi czysto. Na razie tylko placeholder landing page; `src/components/` puste (.gitkeep).
- **Backend / API:** absent — brak endpointów w `src/pages/api/`, brak `src/middleware.ts`, brak helpera `src/lib/http/response.ts` (wymaganego przez `lessons.md`).
- **Data:** partial — `supabase/migrations/0001_initial_schema.sql` (8 tabel) + `0002_rls_policies.sql` (pełne polityki RLS) napisane, projekt zlinkowany (`supabase/.temp/linked-project.json`). Ale typowane klienty w `src/lib/db/` puste (.gitkeep); status aplikacji migracji niezweryfikowany.
- **Auth:** absent — `src/lib/auth/` puste (.gitkeep); dep `@supabase/ssr` obecny, ale brak stron logowania i guard'a.
- **Deploy / infra:** present — `.github/workflows/ci.yml` + `deploy.yml` wylądowały (ostatnie commity); `wrangler` + `@astrojs/cloudflare` spięte.
- **Observability:** absent — brak logowania/metryk; koszt/latencja vision to kolumny schematu (`photos`, FR-039), jeszcze niespięte w kodzie.

## Foundations

### F-01: Persystencja + izolacja per-user

- **Outcome:** (foundation) migracje 0001+0002 zaaplikowane do zlinkowanego projektu, izolacja RLS zweryfikowana (użytkownik A nie widzi danych B), typowane klienty Supabase RLS-respecting (server: `@supabase/ssr` anon + JWT z cookies; browser: anon) spięte w `src/lib/db/`, bez service-role.
- **Change ID:** data-and-rls-substrate
- **PRD refs:** FR-003, NFR (privacy guardrail: "użytkownik A pod żadnym warunkiem nie widzi danych B")
- **Unlocks:** S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08 (każdy slice czyta/pisze dane katalogu) + egzekucja guardrail'a prywatności.
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** guardrail prywatności i cały katalog wiszą na RLS; jeśli izolacja per-user nie jest zweryfikowana, zanim ruszą widoki, każdy późniejszy slice dziedziczy lukę bezpieczeństwa.
- **Status:** done

### F-02: Kontrakt odpowiedzi API + middleware auth-guard

- **Outcome:** (foundation) `src/lib/http/response.ts` (typowany `ApiErrorCode` union + `apiResponse` / `apiError` / `parseUuidParam` z `Cache-Control: private, no-store` i 404-privacy w defaultach, plus `buildResponse` fallback dla envelope contract na worst-case JSON.stringify); middleware split (`src/middleware.ts` thin Astro wrapper + `src/lib/middleware/handler.ts` core z try/catch fallback dla bootstrap i `getUser()`, whitelist public paths, redirect/401 dla protected); `src/env.d.ts` (`App.Locals`: `supabase` required + `user: AuthUser | null`). CLAUDE.md § API endpoints wskazuje response.ts jako single source of truth.
- **Change ID:** api-response-contract
- **PRD refs:** FR-004, NFR (privacy: jednoznaczny brak dla cudzego zasobu, brak współdzielonego cache JWT-scoped contentu)
- **Unlocks:** S-01 (endpointy auth) + wszystkie slice'y z `/api` (S-02–S-08); enforcement-by-code konwencji z `CLAUDE.md` + `lessons.md` (test 2026-05-20: sama proza nie zacisnęła kontraktu).
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** bez typowanego envelope błędów + nagłówków prywatności w defaultach agent rozjeżdża kontrakt API endpoint po endpoincie (udokumentowane w `lessons.md`); taniej wymusić kodem raz, na starcie, niż prozą przy każdym endpoincie.
- **Status:** done

## Slices

### S-01: Rejestracja, logowanie i ochrona ścieżek

- **Outcome:** użytkownik może utworzyć konto (email + hasło), zalogować się, wylogować; niezalogowany na chronionej ścieżce jest przekierowany na logowanie; widzi wyłącznie własne dane.
- **Change ID:** email-password-auth
- **PRD refs:** FR-001, FR-003, FR-004; US-01 (prerekwizyt); NFR (privacy)
- **Prerequisites:** F-01, F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** brama wejścia do wszystkiego per-user; błędna konfiguracja guard/redirect odsłania chronione ścieżki — to regresja guardrail'a prywatności, nie zwykły bug UI.
- **Status:** done

### S-02: CRUD półek + automatyczna półka "Zakupione"

- **Outcome:** użytkownik może utworzyć/edytować/usunąć półkę (nazwa + opcjonalna lokalizacja), przeglądać listę półek z liczbą książek; systemowa wirtualna półka "Zakupione" tworzona przy rejestracji, niesuwalna; usunięcie półki przenosi jej książki na "Zakupione" (dialog potwierdzenia z liczbą książek).
- **Change ID:** shelves-crud-and-purchased
- **PRD refs:** FR-005, FR-006, FR-007, FR-008, FR-009; US-01 (utworzenie półki)
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** niezmiennik "każda książka na dokładnie jednej półce" (FR-029) + niesuwalna "Zakupione" to fundament, na którym opierają się Flow A i Flow B; postawić, zanim pojawią się książki, bo dorabianie wstecz to migracja danych.
- **Status:** done

### S-03: Upload zdjęcia półki + detekcja grzbietów (vision)

- **Outcome:** użytkownik może wgrać jedno zdjęcie półki (drag-drop / wybór z dysku) przypisane do wybranej fizycznej półki; system przetwarza je, wydobywa detekcje (tytuł, autor, pewność, dominujący kolor grzbietu z palety ~10), persistuje wszystkie detekcje przed matchingiem (idempotentny retry) i pokazuje status z paskiem postępu; koszt + latencja zapisane na rekordzie zdjęcia.
- **Change ID:** shelf-photo-vision-detection
- **PRD refs:** FR-010, FR-011, FR-012, FR-013, FR-014, FR-039; US-01; NFR (ack < 200 ms, postęp > 2 s, no-data-loss guardrail)
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Finalna paleta ~10 nazwanych kolorów grzbietu (Open Q2) — Owner: użytkownik. Block: no (kierunek: 11 sugerowanych kolorów w PRD; zamrozić przed S-08, bo kolor jest częścią kontraktu rozpoznawania).
  - Eskalacja modelu vision przy padających detekcjach (Open Q5) — Owner: użytkownik. Block: no (w MVP jeden model; Opus jako post-MVP fallback).
- **Risk:** rdzeń ryzyka technicznego (recall ≥ 70%) + idempotentna persystencja detekcji (no-data-loss guardrail); reality check dał recall 100% / precision ~82% na polskiej półce, więc ryzyko częściowo zdjęte, ale to najdroższy i najbardziej zmienny krok pipeline'u.
- **Status:** done

### S-04: Matching z bazą publiczną + propozycje z dedupe

- **Outcome:** dla każdej detekcji system odpytuje Google Books (primary) + OpenLibrary (fallback), buduje kandydatów z metadanymi, liczy pewność dopasowania i progresję (≥ 0.75 pre-zaznaczone / 0.55–0.75 wymaga potwierdzenia / < 0.55 "wpisz ręcznie"), sprawdza duplikat w katalogu (ISBN lub fuzzy tytuł+autor) i flaguje "duplikat z półki X" / "masz inną edycję"; użytkownik widzi listę propozycji (najlepszy + 2–4 alternatywy).
- **Change ID:** external-match-and-proposals
- **PRD refs:** FR-015, FR-016, FR-017, FR-018; US-01
- **Prerequisites:** S-03
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Progi pewności 0.75 / 0.55 (Open Q1) — Owner: użytkownik. Block: no (wartości startowe; strojenie z telemetrii korekt po ~1 mies.).
  - Polityka matchingu książek bez ISBN (Open Q4) — Owner: użytkownik. Block: no (kierunek: fuzzy tytuł+autor z wyższym progiem; liczba z telemetrii pierwszych półek).
  - Komunikat UI dla różnych wydań tej samej książki (Open Q3) — Owner: użytkownik. Block: no (decyzja: różne ISBN = różne rekordy + flaga edycji; doszlifowanie UX na realnych kolekcjach).
- **Risk:** progi i polityka bez-ISBN nietestowane na realnych danych — za liberalny próg "pre-zaznaczone" zaniża acceptance rate (Primary KPI); telemetria korekt jest jedynym wiarygodnym sygnałem do strojenia.
- **Status:** done

### S-05: Akceptacja propozycji → katalog + widok półki  ★ north star

- **Outcome:** użytkownik może akceptować (hurtowo pre-zaznaczone lub po kolei), odrzucać lub korygować pola (tytuł/autor/wydawnictwo/rok) przed akceptacją, oraz wpisać książkę ręcznie, gdy brak matchu; zaakceptowana książka trafia do katalogu ze statusem przeczytania = nie przeczytana i pozycją na półce ("od lewej"); użytkownik widzi półkę z okładkami w kolejności od lewej i przełącza status przeczytania jednym kliknięciem; każda korekta/odrzucenie zapisane jako sygnał telemetryczny.
- **Change ID:** proposal-accept-to-catalog
- **PRD refs:** FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-037; US-01 (domknięcie Flow A)
- **Prerequisites:** S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** domyka gwiazdę przewodnią (Flow A end-to-end) i niesie KPI acceptance-rate + time-to-first-shelf; największa wartość produktu, więc sekwencjonowana najwcześniej, jak pozwalają prerekwizyty — opóźnienie tu opóźnia walidację całej hipotezy.
- **Status:** done

### S-06: Flow B — dodaj zakup na półkę "Zakupione"

- **Outcome:** użytkownik może otworzyć akcję "Dodaj zakup" z dowolnego widoku katalogu, wybrać metodę (zdjęcie stosu uruchamia istniejący pipeline rozpoznawania LUB wpisanie ręczne), wpisać tytuł + autora, ustawić opcjonalną datę zakupu (domyślnie dziś) i zatwierdzić; książka ląduje na wirtualnej półce "Zakupione" ze statusem przeczytania = nie przeczytana; ścieżka ręczna ≤ 90 s.
- **Change ID:** add-purchase-flow
- **PRD refs:** FR-025, FR-026, FR-027, FR-028; US-02
- **Prerequisites:** S-05, S-02
- **Parallel with:** S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** 90 s Time-to-add-purchase to próg utrzymania nawyku (Flow B używany dziesiątki razy w roku); przekombinowany formularz zabija KPI — ścieżka ręczna musi być wolna od tarcia. Ścieżka "zdjęcie stosu" deleguje do łańcucha S-03→S-05, więc nie duplikuje vision.
- **Status:** done

### S-07: Przenoszenie książek + wersjonowana historia lokalizacji

- **Outcome:** użytkownik może przenieść książkę z dowolnej półki (w tym "Zakupione") na inną przez akcję "Przenieś na półkę X"; data zakupu i ręczne metadane pozostają na rekordzie książki; system zapisuje wersjonowaną historię lokalizacji (poprzednia oznaczona jako historyczna, nowa jako aktualna), tak by katalog odpowiadał "gdzie ta książka jest dziś i gdzie była".
- **Change ID:** move-book-and-history
- **PRD refs:** FR-029, FR-030, FR-031, FR-038; US-02 (przeniesienie z "Zakupione")
- **Prerequisites:** S-05, S-02
- **Parallel with:** S-06, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** wersjonowana historia lokalizacji (FR-038) to dług, który tanio zaciągnąć od razu, a drogo dorobić wstecz po nagromadzeniu danych bez kolumny historii.
- **Status:** done

### S-08: Wyszukiwarka katalogu — pełnotekst + filtry

- **Outcome:** użytkownik może wyszukać książkę pełnotekstowo (tytuł, autor, wydawnictwo, krótki opis z bazy publicznej), filtrować po kolorze grzbietu (paleta ~10), po półce (multi-select) i statusie przeczytania, oraz kombinować pełnotekst z dowolnym zestawem filtrów; wyniki pokazują nazwę półki + pozycję + status przeczytania; brak wyników daje jednoznaczny komunikat "nie masz tej książki".
- **Change ID:** catalog-search-and-filters
- **PRD refs:** FR-032, FR-033, FR-034, FR-035, FR-036; US-03, US-04; NFR (p95 < 1 s na ~1000 wyników)
- **Prerequisites:** S-05, S-02
- **Parallel with:** S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - ~~Finalna paleta nazwanych kolorów grzbietu (Open Q2)~~ **ZAMROŻONA 2026-05-29** → `src/lib/vision/prompt.ts` `SPINE_COLORS` (12 kolorów) jest single source of truth. S-08 filtruje po tej liście; zmiana = migracja danych w `detections.spine_color`.
- **Risk:** p95 < 1 s na ~1000 wyników + kombinowalne filtry to KPI find-in-house i in-bookstore; niezindeksowane pole opisu/koloru rozjeżdża wydajność, a niezamrożona paleta unieważnia zindeksowane wartości.
- **Status:** done

### S-09: Landing page — CTA dla niezalogowanych + skrót dla zalogowanych

- **Outcome:** niezalogowany na `/` widzi 2 widoczne CTA: „Zaloguj się" (→ `/login`) i „Załóż konto" (→ `/signup`); zalogowany widzi 1 CTA: „Przejdź do biblioteki" (→ `/library`); landing content (tytuł + pitch) pozostaje, dorzucamy tylko sekcję CTA pod nim. Dodatkowo: `LogoutButton` po wylogowaniu redirektuje na `/login` (zamiast `/`) — bardziej naturalne UX („wylogowano → tu zaloguj się ponownie"), spójne z guard'em F-02 dla protected paths.
- **Change ID:** landing-auth-cta
- **PRD refs:** FR-001 (UX adjacent — nie zmienia kontraktu auth, tylko nawigację z root URL)
- **Prerequisites:** S-01 (mechanizm logowania musi już istnieć)
- **Parallel with:** S-10, S-11, S-12 (Stream E micro-slice bucket — zero file-scope overlap), S-02..S-08.
- **Blockers:** —
- **Unknowns:** —
- **Risk:** zero ryzyka technicznego — pure UI polish; jedyna pułapka to nie zepsuć istniejącej landing-page semantyki (SSR-rendered, Astro.locals.user już dostępne). Out-of-scope dla S-01 świadomie (M1L4 decyzja: scope discipline) — wyodrębniony tu jako pierwszy element bucketa Stream E.
- **Status:** done

### S-10: Custom 404 page

- **Outcome:** Astro renderuje `src/pages/404.astro` dla unmatched routes — customowa strona z `Layout.astro`, h1 „Nie znaleziono strony" + krótki tekst + conditional CTA (zalogowany → `/library`, niezalogowany → `/`). Zastępuje wbudowany białą stronę Astro „Page not found".
- **Change ID:** custom-404-page
- **PRD refs:** — (UX polish, brak FR)
- **Prerequisites:** —
- **Parallel with:** S-09, S-11, S-12 (Stream E micro-slice bucket — zero file-scope overlap).
- **Blockers:** —
- **Unknowns:** —
- **Risk:** zero — pure UI; middleware nie tykany (anonymous user nie zobaczy 404 bo F-02 redirektuje wcześniej, ale to świadoma decyzja: out-of-scope dla tego slice'a).
- **Status:** done

### S-11: Health check endpoint

- **Outcome:** publiczny `GET /api/health` zwraca HTTP 200 + `{data:{status:"ok",version:"<pkg>",timestamp:"<iso>"}}` z F-02 envelope (`apiResponse` helper) + `Cache-Control: private, no-store`. Wymaga whitelist'u `/api/health` w `PUBLIC_EXACT` w middleware. Endpoint do wykorzystania przez monitoring / deploy smoke (lesson „Worker Secret validation" w `lessons.md`).
- **Change ID:** health-check-endpoint
- **PRD refs:** NFR (monitoring)
- **Prerequisites:** F-02 (envelope + middleware)
- **Parallel with:** S-09, S-10, S-12 (Stream E micro-slice bucket — ten slice JAKO JEDYNY w bucketcie tyka middleware; pozostałe mają explicit instrukcję nie tykać).
- **Blockers:** —
- **Unknowns:** —
- **Risk:** trywialne; pułapka jeśli endpoint zostałby pomylony z protected — middleware whitelist musi być prawidłowo dodany.
- **Status:** done

### S-12: Loading skeleton component

- **Outcome:** `src/components/Skeleton.tsx` — generic React komponent (gray pulsing div, Tailwind `animate-pulse`) z props `className?`, `width?`, `height?`, `aria-label?` (default „Ładowanie"). Substrate UI dla S-03 (photo upload progress), S-04 (book candidates loading), S-08 (search results loading). Bez konsumentów teraz — testowany w izolacji.
- **Change ID:** loading-skeleton-component
- **PRD refs:** — (UI substrate; przyda się w przyszłych FRs)
- **Prerequisites:** —
- **Parallel with:** S-09, S-10, S-11 (Stream E micro-slice bucket — zero file-scope overlap).
- **Blockers:** —
- **Unknowns:** —
- **Risk:** zero — czysty substrate, izolowany plik + test.
- **Status:** done

### S-21: Re-OCR grzbietów z niską pewnością na wyciętym cropie

- **Outcome:** przy przetwarzaniu zdjęcia system automatycznie re-analizuje detekcje z `vision_confidence < 0.7` poprzez wysłanie do Claude wyciętego cropa grzbietu (ze `storage_path` + bbox 0..1 z S-04) zamiast pełnego zdjęcia; po re-OCR aktualizuje `raw_title`, `raw_author`, `vision_confidence` na detekcji; użytkownik widzi poprawione tytuły w widoku review bez dodatkowej akcji.
- **Change ID:** vision-spine-crop-reocr
- **PRD refs:** FR-010–014 (jakość detekcji), FR-039 (koszt — cropping pozwala użyć mniejszego kontekstu)
- **Prerequisites:** S-04 (bbox 0..1 w DB i `storage_path` oryginalnego zdjęcia), S-18 (overlay potwierdził poprawność bbox w UI)
- **Parallel with:** S-19, S-20
- **Blockers:** —
- **Unknowns:**
  - Czy re-OCR na wyciętym grzbiecie faktycznie poprawia precyzję vs pełne zdjęcie dla Claude (Open Q — wymaga A/B testu na realnych danych przed implementacją). Inspiracja: `suxrobgm/bookshelf-scanner` (GitHub, marzec 2026) — YOLO + Moondream2 pipeline stosuje crop-first i raportuje lepszą dokładność na tłoczonych polskich tytułach; dla naszego serverless stack YOLO odpada (GPU), ale crop z istniejących bbox jest tani.
  - Próg `confidence < 0.7` do kalibracji na realnych danych telemetrii (`corrections` table).
  - Koszt: N re-OCR calls × cena Claude Sonnet per detection — ograniczyć tylko do detekcji z niską pewnością + cap per photo (np. max 10 re-OCR).
- **Risk:** Dodatkowy koszt Anthropic API per zdjęcie; efekt może być marginalny jeśli Claude i tak już widzi grzbiet wystarczająco dobrze na pełnym zdjęciu. Realizować dopiero gdy telemetria korekt (`corrections.correction_type = 'title_typo'`) wskazuje pattern złych detekcji na gęstych półkach — nie implementować spekulatywnie.
- **Status:** proposed

### S-22: Edycja okładki książki — pole URL + podgląd

- **Outcome:** w widoku edycji/szczegółu książki w katalogu pojawia się pole tekstowe „Link do okładki" z wartością bieżącego `cover_url`; po wklejeniu URL poniżej pokazuje się miniatura (img z `onError` → placeholder); zapis przez `PATCH /api/books/[id]`; pole można wyczyścić (null = brak okładki).
- **Change ID:** book-edit-cover-url
- **PRD refs:** FR (UX polish — edycja metadanych książki)
- **Prerequisites:** S-05 (books w katalogu + `PATCH /api/books/[id]`)
- **Parallel with:** S-23, S-24
- **Blockers:** —
- **Unknowns:** czy `PATCH /api/books/[id]` już istnieje lub wymaga stworzenia (sprawdzić w `src/pages/api/books/`).
- **Risk:** niski — czysto frontendowy + jeden endpoint. Jedyna pułapka: nie cachować `cover_url` po stronie klienta (Cloudflare edge cache musi dostać `private, no-store` — już w defaultach F-02).
- **Status:** done — zrealizowane szerzej niż Outcome przy okazji S-33/PR #43 + PR #48 (`unify-add-cover`): `BookModal` + `CoverEditor` z 3-slotowym modelem okładki (`cover_url`/`user_cover_url` + flaga), podgląd, czyszczenie, `cover-suggestion` endpointy. Drift status alignment 2026-06-06 (bez osobnego cyklu change).

### S-23: Re-match pojedynczej detekcji

- **Outcome:** na karcie każdej detekcji w review (obok „Ponów match" dla całego zdjęcia) pojawia się przycisk „Odśwież" który uruchamia matching tylko dla tej jednej pozycji — nowy endpoint `POST /api/detections/[id]/match` wywołuje `matchDetection()` i nadpisuje `book_candidates` dla tej detekcji; strona odświeża kartę bez przeładowania.
- **Change ID:** per-detection-rematch
- **PRD refs:** FR-015–018 (UX — lokalna aktualizacja propozycji bez kosztu re-matchowania całego zdjęcia)
- **Prerequisites:** S-04, S-05
- **Parallel with:** S-22, S-24
- **Blockers:** —
- **Unknowns:** —
- **Risk:** niski — `matchDetection()` w `match.ts` jest już izolowaną funkcją; endpoint opakowuje ją per-detekcję. Subrequest limit CF Workers (50) nie jest problemem — to jeden detection, nie batch.
- **Status:** done — endpoint `POST /api/detections/[id]/rematch` + UI w review istnieją, pokryte E2E `tests/e2e/manual-rematch.spec.ts`. Drift status alignment 2026-06-06 (zrealizowane przy iteracjach review, bez osobnego cyklu change).

### S-24: UX overlay zdjęcia — toggle ramek + lightbox

- **Outcome:** w widoku review (S-18): a) przycisk „Pokaż/Ukryj ramki" nad zdjęciem przełącza widoczność bbox-ów detekcji (`useState`); b) kliknięcie zdjęcia otwiera lightbox (natywny `<dialog>` lub `modal` div z z-index) z pełnoekranową wersją obrazu i ramkami; zamknięcie przez Esc lub kliknięcie tła.
- **Change ID:** photo-overlay-ux
- **PRD refs:** FR-010–014 (UX domknięcie overlay)
- **Prerequisites:** S-18 (overlay z ramkami)
- **Parallel with:** S-22, S-23
- **Blockers:** —
- **Unknowns:** —
- **Risk:** niski — pure UI, brak API. Pułapka: lightbox na CF Workers nie ma dostępu do `document.body` po stronie serwera — komponent musi być React island (`client:load`).
- **Status:** done
- **Nota (M23, 2026-06-07):** trigger lightboxa (klik w zdjęcie) wyłączony na życzenie usera — zoom/pan + pinch (M6) na miejscu wystarczają. Komponent `PhotoLightbox` + testy unit zostają w repo („wyłącz, nie kasuj"); E2E `photo-lightbox.spec.ts` = `test.skip`. Przywrócenie = re-import + `onClick` na `<img>` w `PhotoDetectionOverlay`. Zob. `review-ux-pack`.

### S-25: Alternatywne widoki listy detekcji w review

- **Outcome:** w górnej belce strony review pojawia się przełącznik trybu prezentacji z 3 opcjami: **Karty** (obecny widok — pełna karta z okładką, kandydatami, akcjami), **Lista** (1 linia: `#N tytuł — autor | badge pewności | [Akceptuj][Odrzuć][Popraw]`), **Kafelki** (siatka: okładka + tytuł + badge + mini-akcje); wybór persystowany w `localStorage`; domyślnie Karty na desktopie, Lista na mobilnej szerokości.
- **Change ID:** detection-list-views
- **PRD refs:** UX polish (19+ detekcji na jednym ekranie = zbyt długa strona)
- **Prerequisites:** S-04, S-05
- **Parallel with:** S-28 (mobile — naturalny punkt integracji)
- **Blockers:** —
- **Unknowns:** jak mini-akcje w trybie Lista/Kafelki obsługują tryb „Popraw" (formularz inline vs modal). Decyzja: w trybie Lista i Kafelki `Popraw` otwiera modal, nie inline.
- **Risk:** średni — refaktor `DetectionCard` na obsługę 3 trybów bez rozbijania istniejących testów (mają `data-testid`); tryby muszą zachować pełną funkcjonalność.
- **Status:** done

### S-30: Zachowanie historii kosztów vision (prereq S-29 DELETE)

- **Outcome:** koszty vision przeżywają usunięcie zdjęcia: `vision_runs.user_id` i `refine_calls.user_id` dodane bezpośrednio (denorm, ale pozwala na agregację po user_id niezależnie od photos); FK `vision_runs.photo_id` i `refine_calls.photo_id` zmienione z `ON DELETE CASCADE` na `ON DELETE SET NULL`; nowy endpoint `GET /api/account/stats` zwraca `{ total_vision_cost_usd, total_refine_cost_usd, vision_run_count, refine_call_count }`.
- **Change ID:** vision-cost-preservation
- **PRD refs:** NFR (integralność danych kosztowych)
- **Prerequisites:** S-03
- **Parallel with:** S-31, S-35
- **Blockers:** —
- **Unknowns:** czy Supabase pozwala ALTER CONSTRAINT na istniejącym FK w jednej migracji — sprawdzić składnię (DROP + ADD CONSTRAINT).
- **Risk:** migracja zmienia FK behaviour — test na lokalnej DB przed push. Istniejące cascade-delete przestają działać dla vision_runs przy DELETE photo (pożądana zmiana).
- **Status:** done

### S-31: Strona /account — profil użytkownika

- **Outcome:** użytkownik widzi i może edytować: display_name (PATCH /api/account/profile, optymistyczny update); email (Supabase Auth updateUser + re-confirmation email); hasło (Supabase Auth updateUser); widzi blok statystyk kosztów vision (łączny koszt, liczba analiz — z S-30); widzi listę podłączonych kluczy API (z S-32, na początku pusta sekcja z CTA „Dodaj klucz").
- **Change ID:** user-account-page
- **PRD refs:** FR (profil użytkownika)
- **Prerequisites:** S-01
- **Parallel with:** S-30, S-35
- **Blockers:** —
- **Unknowns:** czy sekcja kluczy API w S-31 to placeholder (CTA) czy czeka na S-32 — rekomendacja: placeholder z CTA, S-32 wypełnia.
- **Risk:** niski — Auth updateUser przez Supabase browser client (bez custom endpointu); jedyna pułapka to email re-confirmation flow (Supabase wysyła maila, user musi potwierdzić).
- **Status:** done

### S-32: Własne klucze API do modeli vision (BYOK)

- **Outcome:** użytkownik może na `/account` dodać klucz API do jednego z providerów (Anthropic / OpenAI / OpenRouter / OpenAI-compatible z custom base_url+model); klucze szyfrowane at rest; lista kluczy pokazuje label, provider, model, datę dodania — NIGDY plaintext; przycisk „Testuj" weryfikuje klucz próbnym żądaniem; przycisk „Usuń" kasuje fizycznie zaszyfrowany rekord.
- **Change ID:** byok-api-keys
- **PRD refs:** FR (multi-provider vision, BYOK)
- **Prerequisites:** S-31
- **Parallel with:** —
- **Blockers:** wybór mechanizmu szyfrowania (Supabase Vault vs pgcrypto AES-256 z kluczem z Worker Secrets) — sprawdzić dostępność Vault na tym projekcie przed planem.
- **Unknowns:** Supabase Vault API (`vault.create_secret`) vs pgcrypto `pgp_sym_encrypt` — oba feasible, Vault czystszy ale wymaga rozszerzenia; pgcrypto bardziej przenośny.
- **Risk:** WYSOKI dla bezpieczeństwa — klucze API userów muszą być szyfrowane, never-logged, never-returned. Ryzyko wycieku przy błędzie implementacji jest poważne. Wymagany security review przed merge.
- **Status:** done

### S-33: Pipeline vision wymaga klucza usera (BYOK enforcement)

- **Outcome:** `POST /api/photos/[id]/process` sprawdza aktywny klucz w `user_api_keys` przed wywołaniem vision; brak klucza → 403 `NO_API_KEY` z body `{ message: "...", account_url: "/account" }`; istniejący klucz → odszyfrowany i przekazany do fabryki `VisionProvider`; `src/lib/vision/client.ts` refaktorowany do abstrakcji `VisionProvider` z implementacjami per-provider (Anthropic / OpenAI-compatible); globalny `ANTHROPIC_API_KEY` z Worker Secrets wyłączony dla zwykłych userów (może zostać jako fallback dla is_admin); `PhotoUploader` pokazuje pusty stan z CTA do `/account` gdy user nie ma klucza.
- **Change ID:** byok-pipeline
- **PRD refs:** FR (BYOK enforcement)
- **Prerequisites:** S-32
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** co z flagą `ai_enabled` z S-26 — czy zastąpiona przez „ma aktywny klucz" czy zostaje jako osobna bramka admina. Rekomendacja: `ai_enabled` pozostaje jako admin-gate (można blokować per user nawet gdy ma klucz); „ma klucz" to osobny warunek.
- **Risk:** WYSOKI — zmiana breaking dla wszystkich userów bez klucza; wymaga komunikacji w UI + onboardingu. Wdrożyć po przetestowaniu S-32 na prod.
- **Status:** done

### S-34: Tryby widoku książek na półce

- **Outcome:** na `/shelves/[id]` w zakładce Książki pojawia się przełącznik trybu prezentacji: **Karty** (obecny, pełna karta z okładką + akcjami), **Lista** (1 linia: okładka-mini + tytuł + autor + ikony akcji), **Kafelki** (siatka: okładka + tytuł); wybór persystowany w `localStorage`; domyślnie Karty na desktop, Lista na mobile; analogiczny wzorzec do S-25 `detection-list-views`.
- **Change ID:** shelf-book-view-modes
- **PRD refs:** UX polish
- **Prerequisites:** S-29 (stabilna struktura zakładek)
- **Parallel with:** S-36
- **Blockers:** —
- **Unknowns:** —
- **Risk:** niski — refaktor czysto frontendowy; pułapka jak w S-25: `matchMedia` guard dla jsdom/SSR przy odczycie localStorage default.
- **Status:** done

### S-35: UX przycisków refine — spójny label + info o koszcie

- **Outcome:** oba warianty przycisku refine (`DetectionReview.tsx`) mają ten sam label „Doprecyzuj odczyt"; przy `uncertain_localization` ikona ⚠ + tooltip „Crop o niskiej jakości — wynik może być słaby"; pod każdym wariantem drobna informacja „Dodatkowa analiza AI (płatna)" lub szacowany koszt z `CostPanel`; opcjonalnie: dialog potwierdzenia gdy crop jest słaby.
- **Change ID:** refine-ux-cost-info
- **PRD refs:** UX polish
- **Prerequisites:** —
- **Parallel with:** S-30, S-31
- **Blockers:** —
- **Unknowns:** —
- **Risk:** zerowy — czysto frontendowy, bez zmian API.
- **Status:** done

### S-36: Upload zdjęcia bez uruchamiania vision

- **Outcome:** w `PhotoUploader` pojawia się checkbox „Analizuj od razu" (domyślnie zaznaczony, persystowany w localStorage); gdy odznaczony — zdjęcie wgrane do Storage i zapisane w DB jako `status='uploaded'`, bez wywołania `/process`; takie zdjęcie widoczne w zakładce Zdjęcia (`/shelves/[id]`) z przyciskiem „Analizuj" który ręcznie uruchamia pipeline; użytkownik ma pełną kontrolę nad tym kiedy i co analizuje (i płaci).
- **Change ID:** photo-upload-skip-process
- **PRD refs:** FR (kontrola kosztu vision)
- **Prerequisites:** S-29 (zakładka Zdjęcia z listą + akcjami)
- **Parallel with:** S-34
- **Blockers:** —
- **Unknowns:** —
- **Risk:** niski; pułapka: `sessionStorage.setItem('upload_resume_photo_id')` w obecnym kodzie zakłada że po wgraniu następuje process — trzeba obsłużyć ścieżkę bez process (nie zapisywać resume state lub zapisywać z flagą skip).
- **Status:** done

### S-29: CRUD zdjęć + zakładki Książki/Zdjęcia + NULL hash badge

- **Outcome:** (1) `/shelves/[id]` dostaje dwie zakładki: **Książki** (obecny widok) i **Zdjęcia** (nowa lista z miniaturkami, statusem, akcjami); (2) GET `/api/photos?shelf_id=` zwraca listę zdjęć półki; (3) DELETE `/api/photos/[id]` kasuje plik z Storage `shelf-photos` + cascade detections/book_candidates (shelf_entries NULL-owane przez istniejący FK, skatalogowane książki zostają); (4) PATCH `/api/photos/[id]` pozwala zmienić shelf_id; (5) zdjęcia z `file_hash_sha256 = NULL` oznaczone badge „bez hasha" w zakładce Zdjęcia; (6) modal potwierdzenia DELETE z liczbą detekcji/kandydatów; UI ostrzeżenie „usunięcie zdjęcia nie usuwa skatalogowanych książek".
- **Change ID:** photos-crud
- **PRD refs:** FR (zarządzanie zdjęciami)
- **Prerequisites:** S-03, S-05, **S-30** (cost preservation — DELETE nie może tracić historii kosztów vision)
- **Parallel with:** S-27, S-28, S-35
- **Blockers:** —
- **Unknowns:** —
- **Risk:** DELETE destruktywny i nieodwracalny. Modal potwierdzenia obowiązkowy. Po S-30 `vision_runs` ma SET NULL zamiast CASCADE — koszty przeżywają DELETE.
- **Status:** done

### S-26: Panel administracyjny

- **Outcome:** użytkownik z flagą `is_admin=true` widzi dodatkowy link „Admin" w headerze; panel `/admin` zawiera: listę użytkowników (email, data rejestracji, liczba półek/książek, flagi), przełącznik `ai_enabled` per user (domyślnie false — blokuje wywołania vision/match), przycisk „Zaloguj jako" (impersonacja przez Supabase Admin API → `generateLink` + redirect), przycisk „Usuń konto" (books + shelf_entries → admin, półki → admin, potem `deleteUser`), akcję „Przenieś półkę" (zmiana `user_id` na innego usera). Migracja: nowe kolumny `profiles.is_admin bool default false` i `profiles.ai_enabled bool default false`.
- **Change ID:** admin-panel
- **PRD refs:** NFR (admin ops — zarządzanie użytkownikami)
- **Prerequisites:** S-01 (auth), F-01 (RLS)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Impersonacja: Supabase `auth.admin.generateLink({type:'magiclink', email})` z service-role key — generuje jednorazowy link; admin klika, loguje się jako user. Alternatywnie: custom JWT. Obie ścieżki wymagają service-role key (już w secrets).
  - RLS vs admin: panel musi używać service-role client (omija RLS) do list użytkowników — ścisła izolacja od RLS-respecting klientów standardowych.
  - Flaga `ai_enabled`: middleware lub endpoint vision/match sprawdza `profiles.ai_enabled` zanim wywoła Anthropic API; błąd 403 z czytelnym komunikatem dla usera.
- **Risk:** WYSOKI scope — wiele powierzchni (migracja, service-role endpoints, impersonacja, cascade delete). Zalecany podział na fazy: (1) migracja + flaga ai_enabled + guard w vision/match → (2) lista userów + przełącznik ai_enabled → (3) impersonacja + delete + przeniesienie półki. Nie implementować całości w jednym PR.
- **Status:** proposed

### S-27: Tryb ciemny/jasny

- **Outcome:** przycisk przełącznika ☀/☾ w prawym rogu headera zmienia motyw całego UI; Tailwind `darkMode: 'class'` — klasa `dark` na `<html>`; preferencja zapisana w `localStorage` + respektuje `prefers-color-scheme` przy pierwszym odwiedzeniu; wszystkie kolory UI mają odpowiedniki `dark:`.
- **Change ID:** dark-light-mode
- **PRD refs:** UX (standard nowoczesnych aplikacji)
- **Prerequisites:** — (cross-cutting, niezależne)
- **Parallel with:** S-28 (mobile — oba cross-cutting CSS; realizować razem lub sekwencyjnie)
- **Blockers:** —
- **Unknowns:** Tailwind 4 zmienił konfigurację `darkMode` — sprawdzić składnię w v4 (może być `@variant dark` w CSS zamiast `tailwind.config`).
- **Risk:** średni — cross-cutting zmiana widoczna w każdym pliku `.astro`/`.tsx`; brak mechanicznego refaktoru (każda klasa koloru wymaga ręcznego `dark:` variant). Zakres: ~20-30 plików UI. Warto zacząć od Layout + najczęściej używanych komponentów.
- **Status:** done — `src/components/ThemeToggle.tsx` w headerze (☀/☾ widoczne na screenshotach README), dark UI w całej aplikacji. Drift status alignment 2026-06-06 (bez osobnego cyklu change).

### S-28: Responsywność mobilna

- **Outcome:** wszystkie ścieżki read (library `/library`, widok półki `/shelves/[id]`, szczegół książki) i ścieżki write (upload, review `/photos/[id]`) działają na ekranie 375px szerokości bez poziomego scrollowania; nawigacja header składa się do hamburgera lub ikon; karty detekcji/książek dostosowują layout do wąskiego ekranu; domyślny tryb listy w S-25 na mobilnej szerokości = Lista (nie Karty).
- **Change ID:** mobile-responsive
- **PRD refs:** NFR (UX — użytkowanie w przeglądarce telefonu)
- **Prerequisites:** S-05 (stabilny UI przed cross-cutting CSS refaktorem)
- **Parallel with:** S-27 (dark mode — oba cross-cutting)
- **Blockers:** —
- **Unknowns:** upload zdjęcia na mobilnym: `<input type="file">` działa wszędzie; drag-drop nie ma sensu na dotykowym — warunkowy UI (ukryć drag area na touch devices).
- **Risk:** średni — cross-cutting jak S-27, ale ograniczony do breakpoints Tailwind (`sm:`/`md:`). Priorytet: ścieżka review (najdłuższy widok, 19 kart) i header nav. Uwaga: kamera mobilna (getUserMedia) świadomie POZA zakresem (Parked).
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                            | Ready for `/10x-plan` | Notes                                  |
| ---------- | ---------------------------- | ---------------------------------------------------------------- | --------------------- | -------------------------------------- |
| F-01       | data-and-rls-substrate       | Persystencja + izolacja per-user (migracje + RLS + klienty)      | yes                   | Run `/10x-plan data-and-rls-substrate` |
| F-02       | api-response-contract        | Kontrakt odpowiedzi API + middleware auth-guard                  | yes                   | Run `/10x-plan api-response-contract`  |
| S-01       | email-password-auth          | Rejestracja, logowanie i ochrona ścieżek                         | no                    | Czeka na F-01, F-02                    |
| S-02       | shelves-crud-and-purchased   | CRUD półek + automatyczna półka "Zakupione"                      | no                    | Czeka na S-01                          |
| S-03       | shelf-photo-vision-detection | Upload zdjęcia + detekcja grzbietów (vision)                     | no                    | Czeka na S-02                          |
| S-04       | external-match-and-proposals | Matching z bazą publiczną + propozycje z dedupe                  | no                    | Czeka na S-03                          |
| S-05       | proposal-accept-to-catalog   | Akceptacja propozycji → katalog + widok półki (gwiazda)          | no                    | Czeka na S-04                          |
| S-06       | add-purchase-flow            | Flow B — dodaj zakup na półkę "Zakupione"                        | no                    | Czeka na S-05, S-02                    |
| S-07       | move-book-and-history        | Przenoszenie książek + wersjonowana historia lokalizacji         | no                    | Czeka na S-05, S-02                    |
| S-08       | catalog-search-and-filters   | Wyszukiwarka katalogu — pełnotekst + filtry                      | no                    | Czeka na S-05, S-02                    |
| S-09       | landing-auth-cta             | Landing page — CTA dla niezalogowanych + skrót dla zalogowanych  | yes                   | Stream E bucket — eksperyment parallel |
| S-10       | custom-404-page              | Custom Astro 404 page                                            | yes                   | Stream E bucket — eksperyment parallel |
| S-11       | health-check-endpoint        | `GET /api/health` endpoint + middleware whitelist                | yes                   | Stream E bucket — eksperyment parallel |
| S-12       | loading-skeleton-component   | Generic React `<Skeleton />` komponent                            | yes                   | Stream E bucket — eksperyment parallel |
| S-14       | photo-process-reload-recovery | Reload-recovery utkniętego 'processing' na /upload (konsumuje GET /api/photos/[id]) | yes | Follow-up z S-03 impl-review (F2); happy-path retry już działa |
| S-16       | photo-upload-dedup           | Dedup zdjęć przy uploadzie (hash treści + reuse detekcji)         | no                    | Czeka na domknięcie S-05; sframe'uj (`/10x-frame`) — kierunek: SHA-256 treści + reuse istniejących detekcji (oszczędność vision FR-039), user może świadomie kontynuować mimo trafienia. Open: dokładny hash vs perceptual, UX akcji (auto-redirect vs przycisk) |
| S-18       | photo-detection-overlay      | Pełne zdjęcie z numerowanymi ramkami detekcji w review            | yes                   | Substrat S-04 (`bbox` 0..1 w DB+DTO, `photos.original_path`) gotowy; doda signed URL pełnego zdjęcia do `GET /api/photos/[id]` + overlay renderujący `DetectionDTO.bbox` z numerkami skorelowanymi z `position_index`. Realizowany 1. (B) |
| S-19       | manual-cover-match           | Ręczne wyszukiwanie Google Books + wybór okładki w review         | yes                   | Pełny picker: nowy endpoint search (reuse `src/lib/books/googleBooks.ts`) + UI w `DetectionReview`; wybór nadpisuje aktywnego kandydata (cover_url + metadane). UWAGA (alignment 2026-06-06): intent w dużej mierze pokryty inną drogą — `BookModal` „Wyszukaj po danych" + `identify` w katalogu (PR #43/#48) i per-detection rematch (S-23 done); w review pozostał tylko link Google (nowa karta). Przed planem zważyć resztkową wartość. |
| S-20       | shelf-statistics             | photo_count na liście półek (obok książek) + agregaty na widoku półki | yes                | #1 obie liczby (rozszerz `ShelfListItemDTO` o `photo_count` z `photos`); #2 blok agregatów na `/shelves/[id]` (suma zdjęć / wykrytych / skatalogowanych). Realizowany 3. (A) |
| S-21       | vision-spine-crop-reocr      | Re-OCR grzbietów z niską pewnością na wyciętym cropie (bbox z S-04)  | no                 | **Nie planować przed weryfikacją hipotezy** — realizować dopiero gdy telemetria `corrections` pokaże pattern złych detekcji na gęstych półkach. Inspiracja: `suxrobgm/bookshelf-scanner` (crop-first pipeline). Unknowns: skuteczność vs pełne zdjęcie, próg confidence, cap kosztu per photo. |
| S-22       | book-edit-cover-url          | Edycja okładki książki — pole URL + miniatura podglądu               | yes                | Sprawdzić czy `PATCH /api/books/[id]` istnieje; jeśli nie — stworzyć w ramach slice'a. |
| S-23       | per-detection-rematch        | Re-match pojedynczej detekcji (bez matchowania całego zdjęcia)        | yes                | Nowy endpoint `POST /api/detections/[id]/match` opakowuje istniejącą funkcję `matchDetection()`. |
| S-24       | photo-overlay-ux             | Toggle ramek detekcji + lightbox zdjęcia w review                    | yes                | Buduje na S-18; pure UI — React island, brak nowych API. |
| S-25       | detection-list-views         | Tryby prezentacji listy detekcji: Karty / Lista / Kafelki            | yes                | Refaktor `DetectionCard` na 3 tryby; Popraw w trybie Lista/Kafelki otwiera modal zamiast inline. |
| S-26       | admin-panel                  | Panel administracyjny: users, ai_enabled, impersonacja, delete, przeniesienie półki | no   | **DUŻE** — podzielić na 3 fazy: (1) migracja + guard ai_enabled, (2) lista + przełącznik, (3) impersonacja + delete. Zaczynać od fazy 1. |
| S-27       | dark-light-mode              | Przełącznik ciemny/jasny — Tailwind `dark:`, localStorage, prefers-color-scheme | yes     | Sprawdzić składnię Tailwind v4 dla dark mode przed planem. |
| S-28       | mobile-responsive            | Responsywność mobilna (375px) — breakpoints Tailwind, hamburger nav, upload bez drag-drop na touch | yes | Realizować po S-27 (lub równolegle — oba cross-cutting CSS). |
| S-29       | photos-crud                  | CRUD zdjęć + zakładki Książki/Zdjęcia na shelf view + NULL hash badge | **no** | Czeka na S-30 (cost preservation jako prereq dla DELETE). |
| S-30       | vision-cost-preservation     | `user_id` do vision_runs + refine_calls, FK SET NULL, GET /api/account/stats | yes | Prosta migracja — niezależna od innych nowych slice'ów. |
| S-31       | user-account-page            | Strona /account: display_name, email, hasło, statystyki, lista kluczy | yes | Prereq: S-01 (done). Shell dla S-32 i stats z S-30. |
| S-32       | byok-api-keys                | Tabela user_api_keys, szyfrowanie, UI na /account | no | Czeka na S-31. |
| S-33       | byok-pipeline                | Pipeline wymaga klucza usera, abstrakcja VisionProvider, wyłączenie global env | no | Czeka na S-32. |
| S-34       | shelf-book-view-modes        | Tryby widoku książek: lista/kafelki/panele (analogia S-25) | no | Czeka na S-29 (stabilne tabs). |
| S-35       | refine-ux-cost-info          | Ujednolicony label refine + info o koszcie + dialog potwierdzenia | yes | Czysto frontendowy, niezależny. |
| S-36       | photo-upload-skip-process    | Checkbox „Analizuj od razu" w uploaderze + akcja „Analizuj" na liście zdjęć | no | Czeka na S-29 (tab Zdjęcia). |
| S-37       | book-to-detection-focus      | Deep-link książka→review z fokusem na jej detekcji (1 ramka + scroll) | yes | Prereqs done (S-15 link, S-18 fokus overlay); czyste wiring — `detection_id` w books API + `?detection=` w DetectionReview; zero migracji. Szacunek S. |
| S-38       | user-onboarding-help         | Onboarding warstwowy: empty states + HelpTip + /help | done | Zrealizowane i zarchiwizowane 2026-06-08 → `context/archive/2026-06-07-user-onboarding-help/`. Impl-review fazy 3 złapał krytyczny prod-bug (prerender → SSR). |
| S-39       | match-rate-limit-resilience  | Retry+backoff na 429 GB + komunikat „N wstrzymał limit" w review | done | Zrealizowane 2026-06-07. Weryfikacja prod POTWIERDZIŁA: photo `e9876820…` — 9/14 pending z 0 kandydatów na popularnych tytułach. Adaptacja: toast w tabie Zdjęcia (review robi reload). |
| S-40       | bbox-quality-validation      | Benchmark ground-truth bboxów → prompt → decyzja | done (decision-point) | **ZAMKNIĘTE 2026-06-09**: zmierzono (self-test LLM-via-Read + realny API v6/v7/thinking, N=3) że bbox przez prompt jest nie do naprawienia — klastrowanie y2 i zawyżona szerokość są wrodzone modelowi (v7 gorszy, thinking bez efektu). GT naprawiony (`CONVENTION.md`), metryki kierunkowe (xIoU/szer×/|Δy2|). v7 NIE wdrożony (`PROMPT_VERSION`=v6). Pivot → S-43. Raport: `change.md` „Wyniki i decyzja". Do `/10x-archive`. |
| (framed)   | purchase-add-book-merge      | Unifikacja „Dodaj zakup" → BookModal add + data zakupu | frame done | `context/changes/purchase-add-book-merge/frame.md` (M8, Confidence HIGH, wariant A) — czeka na akceptację kierunku (kasuje /purchase + link nav), potem `/10x-plan`. |
| S-41       | cost-analysis-view           | Ekran/modal analizy kosztów per klucz i działanie (uwagi-round3, 2026-06-07) | done | Zrealizowane 2026-06-07 (PR #80/#81), zarchiwizowane → `context/archive/2026-06-07-cost-analysis-view/`. Substrat gotowy: atrybucja `api_key_id` w vision_runs/refine_calls (migracja 0020 + zapis przy callach), `cost_by_key` w /api/account/stats, chip sumy przy kluczu. Slice: sekcja „Koszty analizy" na /account klikalna → widok/modal z listą wywołań filtrowaną per klucz/typ (vision/OCR)/okres; rozważyć paginację (historia rośnie) i drill-down do zdjęcia. |
| S-42       | camera-capture               | Zdjęcie półki prosto z kamery: webcam na desktopie + aparat telefonu w wersji mobilnej (rozwój, 2026-06-07) | done | Zrealizowane 2026-06-07 (PR #81), zarchiwizowane → `context/archive/2026-06-07-camera-capture/`; impl-review: mobile path przez getUserMedia na HTTPS (F6) — follow-up w review-fixes. Dwie warstwy: (1) mobile — tanio: `<input type="file" accept="image/*" capture="environment">` w PhotoUploader otwiera natywny aparat (zero nowych API, reszta pipeline'u bez zmian, w tym miniatura M15); (2) desktop — `getUserMedia` + podgląd `<video>` + przechwycenie do canvas → File → istniejący doUpload. Uwagi: HTTPS wymagany dla getUserMedia (prod OK, dev localhost OK), permission-denied → czytelny fallback do wyboru pliku; E2E z fake-device (`--use-fake-device-for-media-stream`). Świadomie wyjęte z „NIE w MVP" (CLAUDE.md) jako slice rozwojowy post-MVP. |
| S-43       | vision-identity-first        | Pivot pipeline'u na identity-first (rozpoznanie > lokalizacja) — wynik S-40 | no | **DUŻE — przez `/10x-plan` (pełny cykl, dotyka prompt+schema+API+UI).** Prompt identity-only (bez bbox; `{kind,title,author,confidence}`, książki+gry); `bbox` → optional w `schema.ts`; review = lista kart „potwierdź" z kandydatami match (overlay/numer jako kotwica pomocnicza, nie ciasny box); bbox-editor (`e2aa2ed`) przepięty na doszczegółowianie gdy brak rozpoznania. KPI z IoU → title-recall+precyzja+czas review. Dowód kierunku: `bbox-identity-test.mjs` (identity ≥ v6 recall, 30–46% taniej). Otwarte: „inne narzędzie" do geometrii (CV grzbietów / Gemini grounding) tylko warunkowo, osobny slice. |

## Open Roadmap Questions

1. **Strojenie progów pewności dopasowania (FR-016: 0.75 / 0.55).** Owner: użytkownik. Block: `S-04` (nieblokujące startu; wartości startowe, strojenie z telemetrii korekt po ~1 mies. używania na realnej kolekcji).
2. ~~**Finalna paleta nazwanych kolorów grzbietu (FR-011, FR-033).**~~ **ROZSTRZYGNIĘTE 2026-05-29.** Zamrożona lista 12 kolorów w `src/lib/vision/prompt.ts` `SPINE_COLORS`: czerwony, pomarańczowy, żółty, zielony, niebieski, granatowy, fioletowy, różowy, brązowy, czarny, biały, szary (+ `null` = „nie pasuje żaden"). To kontrakt rozpoznawania (vision prompt) i filtra S-08 — single source of truth. Zmiana wymaga migracji `detections.spine_color`.
3. **Komunikat UI dla różnych wydań tej samej książki (FR-017).** Owner: użytkownik. Block: `S-04` (decyzja kierunkowa: różne ISBN = różne rekordy + flaga "masz inną edycję"; doszlifowanie wording'u na testach UX z realnymi kolekcjami).
4. **Polityka matchingu książek bez ISBN (FR-017).** Owner: użytkownik. Block: `S-04` (kierunek: fuzzy tytuł+autor z wyższym progiem niż przy ISBN; konkretny próg z telemetrii pierwszych przetworzonych półek).
5. **Eskalacja modelu rozpoznawania (Sonnet → Opus) przy padających detekcjach.** Owner: użytkownik. Block: `roadmap-wide` / post-MVP (w MVP jeden model; ścieżka eskalacji jako świadomy post-MVP follow-up).

## Parked

- **Sign-on przez zewnętrznego dostawcę tożsamości (FR-002 deferred)** — Why parked: nice-to-have rzadko ląduje na produkcji w oknie czasowym; email+hasło wystarcza (PRD §Non-Goals + FR-002).
- **Re-scan istniejącej półki + reconciliation ("była tu" / "gdzie indziej" / "zniknęła")** — Why parked: skomplikowana logika różnicowa + interfejs trzech stanów; post-MVP (PRD §Non-Goals).
- **Identyfikacja serii + numery tomów + widok luk w serii** — Why parked: najmniej dojrzałe dane w bazach publicznych, najwięcej pracy na korekty (PRD §Non-Goals).
- **Filtr po typie oprawy i dekadzie wydania** — Why parked: pełnotekst + kolor wystarczają, by potwierdzić find-in-house (PRD §Non-Goals).
- **Strukturalne pole "okoliczność zakupu"** — Why parked: naruszyłoby KPI Time-to-add-purchase ≤ 90 s; w MVP tylko opcjonalna data (PRD §Non-Goals).
- **Aplikacja mobilna / native + camera capture w przeglądarce** — Why parked: desktop-first; mobile responsive tylko dla read-path (PRD §Non-Goals + NFR).
- **Skanowanie kodów ISBN, batch upload wielu zdjęć** — Why parked: drugi tryb input'u / przedwczesna optymalizacja; post-MVP (PRD §Non-Goals).
- **Współdzielenie półek między użytkownikami** — Why parked: single-user = single-collection; wymaga ról/kolekcji jako osobnego bytu (PRD §Access Control + §Non-Goals).
- **Wypożyczanie, dziennik czytania, oceny/recenzje** — Why parked: w MVP tylko binarny status przeczytania (PRD §Non-Goals).
- **Rekomendacje / podobne książki / wyszukiwanie semantyczne / obraz-po-obrazie** — Why parked: kolejne reguły domenowe poza zakresem MVP (PRD §Non-Goals).
- **Import/eksport (CSV, JSON), tryb offline / PWA, edycja zdjęcia w przeglądarce** — Why parked: łatwe do dodania post-MVP, nieobecne w MVP (PRD §Non-Goals).
- **Pełen audit WCAG-AA, internacjonalizacja (PL+EN)** — Why parked: w MVP tylko podstawy a11y, UI w całości po polsku (PRD §Non-Goals + NFR).

## Done

- **F-01: (foundation) migracje 0001+0002 zaaplikowane do zlinkowanego projektu, izolacja RLS zweryfikowana (użytkownik A nie widzi danych B), typowane klienty Supabase RLS-respecting (server: `@supabase/ssr` anon + JWT z cookies; browser: anon) spięte w `src/lib/db/`, bez service-role.** — Archived 2026-05-26 → `context/archive/2026-05-25-data-and-rls-substrate/`. Lesson: —.
- **F-02: (foundation) `src/lib/http/response.ts` (typowany `ApiErrorCode` union + `apiResponse` / `apiError` / `parseUuidParam` z `Cache-Control: private, no-store` i 404-privacy w defaultach, plus `buildResponse` fallback dla envelope contract na worst-case JSON.stringify); middleware split (`src/middleware.ts` thin Astro wrapper + `src/lib/middleware/handler.ts` core z try/catch fallback dla bootstrap i `getUser()`, whitelist public paths, redirect/401 dla protected); `src/env.d.ts` (`App.Locals`: `supabase` required + `user: AuthUser | null`). CLAUDE.md § API endpoints wskazuje response.ts jako single source of truth.** — Archived 2026-05-26 → `context/archive/2026-05-26-api-response-contract/`. Lesson: —.
- **S-01: zarejestrować się, zalogować, wylogować; ochrona ścieżek** — Archived 2026-05-26 → `context/archive/2026-05-26-email-password-auth/`. Lesson: Worker Dashboard Secrets walidacja vs `.dev.vars` przed „deploy done" — sama deployment success workflow nie pokrywa runtime secret correctness (zapisane jako rule w `lessons.md`).
- **S-09: niezalogowany na `/` widzi CTA do logowania i rejestracji; zalogowany — CTA do biblioteki; logout redirektuje na `/login` zamiast `/`** — Archived 2026-05-26 → `context/archive/2026-05-26-landing-auth-cta/`. Lesson: —. (Stream E parallel experiment slice 1/4.)
- **S-10: Astro renderuje custom 404 page (Layout + conditional CTA) zamiast default białej strony** — Archived 2026-05-26 → `context/archive/2026-05-26-custom-404-page/`. Lesson: —. (Stream E parallel experiment slice 2/4.)
- **S-11: `GET /api/health` zwraca `{data:{status,version,timestamp}}` z F-02 envelope; whitelisted w middleware** — Archived 2026-05-26 → `context/archive/2026-05-26-health-check-endpoint/`. Lesson: —. Endpoint przyda się jako monitor target dla lesson „Worker Secret validation". (Stream E parallel experiment slice 3/4.)
- **S-12: Generic React `<Skeleton />` (gray pulsing div) gotowy dla S-03/S-04/S-08** — Archived 2026-05-26 → `context/archive/2026-05-26-loading-skeleton-component/`. Lesson: —. Substrate komponent — bez konsumenta teraz, ready dla przyszłych slice'ów loading states. (Stream E parallel experiment slice 4/4.)
- **S-02: tworzyć/edytować/usuwać półki; auto-półka „Zakupione"** — Archived 2026-05-26 → `context/archive/2026-05-26-shelves-crud-and-purchased/`. Lesson: workflow „branch per change" zaadoptowany od tego slice'a — całość w `change/shelves-crud-and-purchased` + PR (zob. `lessons.md` § Branch per change workflow). Integration + E2E testy napisane z `describe.skip` na brak env (deferred do post-merge po `supabase db push` migracji 0004).
- **S-13: header nav „Moje półki" → /shelves dla auth user'a + landing CTA pivot na /shelves (do czasu /library w S-08)** — Archived 2026-05-27 → `context/archive/2026-05-27-header-nav-when-auth/`. Lesson: —. UX gap fix po S-02 (nikt nigdzie nie linkował /shelves; landing CTA z S-09 prowadził do nieistniejącego /library). Po S-08 wrócimy do oryginalnej intencji S-09 z linkiem do /library.
- **S-03: użytkownik może wgrać jedno zdjęcie półki (drag-drop / wybór z dysku) przypisane do wybranej fizycznej półki; system przetwarza je, wydobywa detekcje (tytuł, autor, pewność, dominujący kolor grzbietu z palety ~10), persistuje wszystkie detekcje przed matchingiem (idempotentny retry) i pokazuje status z paskiem postępu; koszt + latencja zapisane na rekordzie zdjęcia.** — Archived 2026-05-27 → `context/archive/2026-05-27-shelf-photo-vision-detection/`. Lesson: —. Follow-up S-14 (reload-recovery utkniętego 'processing') zarejestrowany z impl-review F2. Manual smoke (bucket, vision, Worker Secret) deferred do post-merge + `supabase db push`.
- **S-04: dla każdej detekcji system odpytuje Google Books (primary) + OpenLibrary (fallback), buduje kandydatów z metadanymi, liczy pewność dopasowania i progresję (≥ 0.75 pre-zaznaczone / 0.55–0.75 wymaga potwierdzenia / < 0.55 "wpisz ręcznie"), sprawdza duplikat w katalogu (ISBN lub fuzzy tytuł+autor) i flaguje "duplikat z półki X" / "masz inną edycję"; użytkownik widzi listę propozycji (najlepszy + 2–4 alternatywy).** — Archived 2026-05-29 → `context/archive/2026-05-28-external-match-and-proposals/`. Lesson: —. Rozszerzony zakres (bbox 0..1 + `photos.original_path` + region model, migracja 0006) jako substrat pod przyszłą re-analizę fragmentów — zob. memory `s04-detection-spatial-region-model`. Manual smoke (realny /match, polski OCR, idempotencja, prod review z okładkami) deferred do post-merge + `supabase db push`.
- **S-05: użytkownik może akceptować (hurtowo pre-zaznaczone lub po kolei), odrzucać lub korygować pola (tytuł/autor/wydawnictwo/rok) przed akceptacją, oraz wpisać książkę ręcznie, gdy brak matchu; zaakceptowana książka trafia do katalogu ze statusem przeczytania = nie przeczytana i pozycją na półce ("od lewej"); użytkownik widzi półkę z okładkami w kolejności od lewej i przełącza status przeczytania jednym kliknięciem; każda korekta/odrzucenie zapisane jako sygnał telemetryczny.** — Archived 2026-05-29 → `context/archive/2026-05-29-proposal-accept-to-catalog/`. Lesson: RLS join-tabel waliduj OBA FK (lessons.md); helper confirm bez transakcji — obserwuj błędy zapisów (impl-review F1 fix). Manual smoke (accept/bulk/correct/reject/widok półki/toggle) deferred do post-merge + `supabase db push` (migracje 0008+0009).
- **S-06: użytkownik może otworzyć „Dodaj zakup" z dowolnego widoku, wybrać metodę (zdjęcie stosu → pipeline rozpoznawania LUB wpisanie ręczne), wpisać tytuł + autora, ustawić opcjonalną datę zakupu (domyślnie dziś) i zatwierdzić; książka ląduje na wirtualnej półce „Zakupione" ze statusem nie przeczytana; ścieżka ręczna ≤ 90 s.** — Archived 2026-05-29 → `context/archive/2026-05-29-add-purchase-flow/`. Lesson: —. Manual entry = świeży `POST /api/books` (helper confirm jest detection-bound); migracja 0010 `books.purchase_date`. Świadome cuty: data na ścieżce zdjęcia (NULL), render daty, telemetria Flow B (odroczone). Manual smoke (≤90s ręczny, upload preset Zakupione) deferred do post-merge + `supabase db push` (migracja 0010).
- **S-08: użytkownik może wyszukać książkę pełnotekstowo (tytuł, autor, wydawnictwo), filtrować po kolorze grzbietu, półce (multi-select) i statusie przeczytania, kombinować filtry; wyniki pokazują nazwę półki + pozycję + status; brak wyników → „nie masz tej książki".** — Archived 2026-05-29 → `context/archive/2026-05-29-catalog-search-and-filters/`. Lesson: —. `/library` + `GET /api/books/search` (2-zapytaniowy, RLS×2, escaped ILIKE); migracja 0011 `books.spine_color` (denorm z detekcji + backfill) + `search_text` GENERATED. Świadome cięcie: „krótki opis" (FR-032) odroczony → S-17. Manual smoke (US-03/04) deferred do post-merge + `supabase db push` (migracja 0011).
- **S-07: użytkownik może przenieść książkę z dowolnej półki (w tym "Zakupione") na inną przez akcję "Przenieś na półkę X"; data zakupu i ręczne metadane pozostają na rekordzie książki; system zapisuje wersjonowaną historię lokalizacji (poprzednia oznaczona jako historyczna, nowa jako aktualna), tak by katalog odpowiadał "gdzie ta książka jest dziś i gdzie była".** — Archived 2026-05-30 → `context/archive/2026-05-30-move-book-and-history/`. Lesson: —. Realizacja bez migracji/rpc (plan-review F1: typ `Database.Functions` pusty, nieregenerowalny w branchu) — dwa typowane zapisy w `POST /api/books/[id]/move` (INSERT bieżący max+1 → UPDATE stary na `is_current=false`), insert-first → książka nigdy bez bieżącej półki; non-atomic zgodny z `confirm.ts`. UI: picker `<select>` w BookCard + optimistic w obu wyspach. Świadome cięcie: widok historii lokalizacji (timeline) odroczony — materializujemy dane, nie ekran. Manual smoke (2.5–2.7) user-only post-merge.

- **S-18: kliknąć zdjęcie w review → zobaczyć pełny obraz z numerowanymi ramkami (bbox) detekcji + skorelowaną numerowaną listą wykrytych pozycji** — Archived 2026-05-30 → `context/archive/2026-05-30-photo-detection-overlay/`. Lesson: —. Signed URL pełnego oryginału w `GET /api/photos/[id]` (graceful null przy błędzie storage); overlay `PhotoDetectionOverlay` z clamp + imgLoaded/imgError guard + `overflow-hidden`. Manual smoke (ramki na realnym zdjęciu, responsywność) user-only post-merge.

- **S-25: widok listy detekcji (review) — przełącznik trybu prezentacji: karty rozwinięte (obecne), lista kompaktowana (1 linia/książka), kafelki (okładka + tytuł + badge pewności)** — Archived 2026-05-31 → `context/archive/2026-05-31-detection-list-views/`. Lesson: —. Refaktor wewnątrzplikowy `DetectionReview.tsx` (zero zmian API/DB): współdzielony hook `useDetectionDecision` (Karty/Lista/Kafelki bez duplikacji fetch), `useDetectionViewMode` (localStorage + responsywny default z guardem `matchMedia`→`cards` dla jsdom/SSR — krytyczne ustalenie plan-review F2), `ViewModeSwitcher`, `CorrectionModal` (Esc+backdrop, opakowuje istniejący `CorrectForm` w trybach kompaktowych; Karty zostają inline). Wszystkie oryginalne `data-testid` zachowane (zero regresji 14 testów Kart). Impl-review APPROVED (0 crit/warn, 4 obs). Manual smoke (1.6/2.6/3.5/4.5 — wizualny przegląd 3 trybów + persystencja) user-only post-merge.

- **S-16: przy wgraniu zdjęcia: wykryj identyczne (hash treści SHA-256), ostrzeż i zaproponuj reuse istniejących detekcji zamiast ponownego (płatnego) vision** — Archived 2026-06-02 → `context/archive/2026-06-02-photo-dedup/`. Lesson: —. SHA-256 obliczany w przeglądarce (SubtleCrypto) przed Storage upload; GET /api/photos/check-hash + UI warning z 3 akcjami (Otwórz istniejące / Wgraj mimo to / Anuluj); obsługa race condition 409 DUPLICATE_PHOTO; migracja 0013 (unique partial index per user_id). Manual smoke (3.M) deferred user-only.

- **S-35: ujednolicony label „Doprecyzuj odczyt" we wszystkich trybach refine + widoczna informacja o koszcie (płatna analiza AI); słaby crop sygnalizowany ⚠ prefixem (rozróżnialność po tekście, nie po kolorze)** — Archived 2026-06-03 → `context/archive/2026-06-03-refine-ux-cost-info/`. Lesson: —. Ekstrakcja współdzielonego `RefineButton` (likwidacja 3 rozjeżdżających się kopii). impl-review APPROVED (1 obs accept-by-design).

- **S-30: koszty vision przeżywają DELETE zdjęcia — vision_runs +user_id (denorm) + trigger derywujący z photos, FK photo_id/detection_id CASCADE→SET NULL (vision_runs + refine_calls), RLS vision_runs na user_id; GET /api/account/stats** — Archived 2026-06-03 → `context/archive/2026-06-03-vision-cost-preservation/`. Lesson: —. Prereq dla S-29 DELETE. impl-review APPROVED (1 obs: migracja walidowana post-merge db push — lokalny stack AV-blocked). Manual (db push + Studio) post-merge.

- **S-29: `/shelves/[id]` zakładki Książki/Zdjęcia; DELETE `/api/photos/[id]` (Storage + cascade detections/book_candidates, shelf_entries i koszty SET NULL — katalog i historia kosztów zostają); PATCH shelf_id (przeniesienie zdjęcia); badge „Bez hash" dla NULL `file_hash_sha256`; modal potwierdzenia usunięcia.** — Archived 2026-06-04 → `context/archive/2026-06-03-photos-crud/`. Lesson: adaptacje literalne — lista zdjęć reuse istniejącego `GET /api/shelves/[id]/photos` (nie nowy `?shelf_id=`), „retitle" porzucone (brak kolumny title); DELETE DB-first → best-effort Storage remove (orphan-safe); cascade + SET-NULL zweryfikowane na prod (zdjęcie usunięte, 2 vision_runs / $0.061 przeżyły z user_id). B1 (rename „Zobacz zdjęcia"→„Pokaż szczegóły") zafoldowany. Pozostałe uwagi z review → memory `backlog-s29-review-2026-06-04`.

- **S-15: przycisk „Źródłowe zdjęcie" na karcie książki → `/photos/[photo_id]` z aktywnego shelf_entry (is_current=true); graceful ukrycie gdy photo_id=NULL (ręczny wpis lub zdjęcie usunięte); pokrywa /shelves/[id] i /library** — Archived 2026-06-04 → `context/archive/2026-06-04-review-page-nav-entry/`. Lesson: —.

- **S-32: użytkownik może na `/account` dodać klucz API do jednego z providerów (Anthropic / OpenAI / OpenRouter / OpenAI-compatible z custom base_url+model); klucze szyfrowane at rest; lista kluczy pokazuje label, provider, model, datę dodania — NIGDY plaintext; przycisk „Testuj" weryfikuje klucz próbnym żądaniem; przycisk „Usuń" kasuje fizycznie zaszyfrowany rekord.** — Archived 2026-06-05 → `context/archive/2026-06-04-byok-api-keys/`. Lesson: —.

- **S-33: pipeline vision wymaga aktywnego klucza usera (BYOK enforcement) — `/api/photos/[id]/process` i `/api/detections/[id]/refine` → 403 `NO_API_KEY` bez klucza; abstrakcja `VisionProvider` (Anthropic + OpenAI-compatible); `PhotoUploader` CTA do `/account`.** — Archived 2026-06-05 → `context/archive/2026-06-05-byok-pipeline/`. Lesson: PR #43 rozrósł się o sąsiednie usprawnienia katalogu (Biblioteka Narodowa jako 3. źródło matchingu, override okładki 3-slot+flaga, identyfikacja/edycja/ręczne dodawanie książek bez zdjęcia); migracje 0017/0018 ręcznie na prod (hotfix, lokalny stack AV-blocked). Manual smoke (2.6/2.7/3.3/3.4/4.5/4.6) user-only deferred.

- **S-31: użytkownik widzi i może edytować: display_name (PATCH /api/account/profile, optymistyczny update); email (Supabase Auth updateUser + re-confirmation email); hasło (Supabase Auth updateUser); widzi blok statystyk kosztów vision (łączny koszt, liczba analiz — z S-30); widzi listę podłączonych kluczy API (z S-32, na początku pusta sekcja z CTA „Dodaj klucz").** — Archived 2026-06-06 → `context/archive/2026-06-04-user-account-page/`. Lesson: —.

- **S-34: na `/shelves/[id]` w zakładce Książki pojawia się przełącznik trybu prezentacji: **Karty** (obecny, pełna karta z okładką + akcjami), **Lista** (1 linia: okładka-mini + tytuł + autor + ikony akcji), **Kafelki** (siatka: okładka + tytuł); wybór persystowany w `localStorage`; domyślnie Karty na desktop, Lista na mobile; analogiczny wzorzec do S-25 `detection-list-views`.** — Archived 2026-06-06 → `context/archive/2026-06-06-shelf-book-view-modes/`. Lesson: —.

- **S-17: full-text obejmuje „krótki opis z publicznej bazy" — capture opisu w klientach S-04 + confirm + backfill (re-fetch), rozszerzenie search_text** — Archived 2026-06-06 → `context/archive/2026-06-06-catalog-description-search/`. Lesson: —. Migracja 0019 (description w book_candidates+books, search_text 4-arg IMMUTABLE) ręcznie na prod pre-merge (za zgodą usera; ADD COLUMN STORED = darmowy backfill search_text). Świadoma adaptacja: bulk re-fetch backfill zastąpiony per-book refresh przez edit BookModal („Wyszukaj po danych" → PATCH); capture tylko GB (OL/BN → null). impl-review APPROVED (F1: sentinel undefined w BookModal — kandydat OL/BN czyści stary opis). Manual smoke (1.5/2.5/2.6) user-only deferred.

- **S-37: „Źródłowe zdjęcie" z karty/modala książki otwiera review spozycjonowany na propozycji TEJ książki: `detection_id` dołożony do GET /api/shelves/[id]/books (+ ścieżka /library), link `/photos/[photo_id]?detection=`, `DetectionReview` czyta param → `setFocusedDetectionId` (overlay pokazuje wtedy tylko 1 ramkę — mechanizm fokusa z S-18) + scroll do karty detekcji; fallback bez `detection_id` (NULL po re-analizie/wpis ręczny) = obecne zachowanie** — Archived 2026-06-06 → `context/archive/2026-06-06-book-to-detection-focus/`. Lesson: —. Manual 2.5 (deep-link na realnej kolekcji) user-only deferred.

- **S-24: w widoku review (S-18): a) przycisk „Pokaż/Ukryj ramki" nad zdjęciem przełącza widoczność bbox-ów detekcji (`useState`); b) kliknięcie zdjęcia otwiera lightbox (natywny `<dialog>` lub `modal` div z z-index) z pełnoekranową wersją obrazu i ramkami; zamknięcie przez Esc lub kliknięcie tła.** — Archived 2026-06-07 → `context/archive/2026-06-06-photo-overlay-ux/`. Lesson: —. Scope-reduced: (a) istniało wcześniej (`toggle-bboxes-button` + zoom/pan); dowieziono (b) jako `PhotoLightbox` (modal React zamiast natywnego `<dialog>` — konwencja repo). Manual 1.5 user-only deferred.

- **S-36: w `PhotoUploader` pojawia się checkbox „Analizuj od razu" (domyślnie zaznaczony, persystowany w localStorage); gdy odznaczony — zdjęcie wgrane do Storage i zapisane w DB jako `status='uploaded'`, bez wywołania `/process`; takie zdjęcie widoczne w zakładce Zdjęcia (`/shelves/[id]`) z przyciskiem „Analizuj" który ręcznie uruchamia pipeline; użytkownik ma pełną kontrolę nad tym kiedy i co analizuje (i płaci).** — Archived 2026-06-07 → `context/archive/2026-06-07-photo-upload-skip-process/`. Lesson: —. Adaptacja: przycisk w tabie zostaje „Uruchom vision" (granularny pipeline S-29); dodatkowo `useShelfTab` honoruje `?tab=` (lądowanie po skip-uploadzie). Manual 1.5 user-only deferred.

- **S-19: w review ręcznie wyszukać Google Books i wybrać trafienie (z okładką + ISBN + metadanymi), gdy auto-match pudłuje lub brak okładki — zastępuje aktywnego kandydata** — Archived 2026-06-07 → `context/archive/2026-06-07-manual-cover-match/`. Lesson: —. **Alignment-closure**: Outcome pokryty wcześniejszą pracą (S-23 per-detection-rematch + dual-path p2 — „Szukaj po tytule" dla detekcji z i bez kandydatów, wybór spośród altów, conservative-replace guard); change dowiózł tylko brakujące 2 scenariusze E2E (rematch przy istniejącym złym kandydacie). **Sprostowanie (M19, 2026-06-07)**: „wszystkie 3 tryby" było prawdziwe tylko dla detekcji BEZ kandydata — w Lista/Kafelki gałąź z kandydatem (`top`) renderowała tylko „Popraw"; parytet domknięty w `review-ux-pack`.

- **S-28: wszystkie ścieżki read (library `/library`, widok półki `/shelves/[id]`, szczegół książki) i ścieżki write (upload, review `/photos/[id]`) działają na ekranie 375px szerokości bez poziomego scrollowania; nawigacja header składa się do hamburgera lub ikon; karty detekcji/książek dostosowują layout do wąskiego ekranu; domyślny tryb listy w S-25 na mobilnej szerokości = Lista (nie Karty).** — Archived 2026-06-07 → `context/archive/2026-06-07-mobile-responsive/`. Lesson: —. Element „domyślny tryb Lista" był już done (S-34 `defaultViewMode()`); dowiezione: hamburger `MobileNav`, `p-4 sm:p-8`, fix overflow trybu Lista (DetectionRow flex-wrap) wykryty nową asercją no-h-scroll, spec E2E 375px (7 testów). Manual 3.4 (realny telefon) user-only deferred.

- **S-41: modal analizy kosztów AI na /account — lista wywołań (vision + OCR) filtrowana per klucz API / typ / okres, z paginacją po 25, sumą dla filtra i drill-downem do zdjęcia; widok SQL `cost_events` (security_invoker) + `GET /api/account/costs`** — Archived 2026-06-07 → `context/archive/2026-06-07-cost-analysis-view/`. Lesson: —. Impl-review APPROVED; follow-up: martwy retry w error state (fix w review-fixes).

- **S-42: zdjęcie półki prosto z kamery — mobile `<input capture="environment">` + desktop `getUserMedia`/`CameraPreview` (canvas → File → istniejący pipeline uploadu); E2E z fake-device** — Archived 2026-06-07 → `context/archive/2026-06-07-camera-capture/`. Lesson: —. Impl-review NEEDS ATTENTION; follow-upy w review-fixes (busy-guard error stage, mocki storage w E2E, dispatch mobile/desktop na HTTPS).

- **S-38: onboarding warstwowy (M7): instruktażowe empty states z CTA następnego kroku + kontekstowe „?" (`HelpTip`) przy decyzjach kosztowych/nietrywialnych + publiczna strona `/help` (golden path ze screenshotami jasny/ciemny + lightbox + FAQ); tour poza zakresem** — Archived 2026-06-08 → `context/archive/2026-06-07-user-onboarding-help/`. Lesson: impl-review fazy 3 złapał krytyczny prod-bug niewidoczny w dev/E2E — `prerender=true` zamrażał redirect `/help/→/login` jako statyczny HTML (trailing slash vs PUBLIC_EXACT); fix `prerender=false` (SSR). Build-time prerender weryfikować buildem, nie tylko dev.

(Pusta przy pierwszej generacji. `/10x-archive` dopisuje tu wpis — i przerzuca Status pozycji na `done` — gdy archiwizowana zmiana ma `Change ID` zgodny z pozycją roadmapy. NIE wypełniać ręcznie.)
