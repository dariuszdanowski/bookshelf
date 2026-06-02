---
project: "BookShelf Scanner"
version: 1
status: draft
created: 2026-05-25
updated: 2026-06-02
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
| S-14  | photo-process-reload-recovery | po reloadzie /upload odzyskać stan utkniętego 'processing' (GET /api/photos/[id]) + retry | S-03 | UX recovery | proposed |
| S-15  | review-page-nav-entry         | link do strony review (/photos/[id]) z poziomu list półek / katalogu; breadcrumbs | S-04 | UX polish | proposed |
| S-16  | photo-upload-dedup            | przy wgraniu zdjęcia: wykryj identyczne (hash treści SHA-256), ostrzeż i zaproponuj reuse istniejących detekcji zamiast ponownego (płatnego) vision | S-03 | FR-039 (koszt), NFR (no-dup) | done     |
| S-17  | catalog-description-search    | full-text obejmuje „krótki opis z publicznej bazy" — capture opisu w klientach S-04 + confirm + backfill (re-fetch), rozszerzenie search_text | S-08 | FR-032 (opis, domknięcie) | proposed |
| S-18  | photo-detection-overlay       | kliknąć zdjęcie w review → zobaczyć pełny obraz z numerowanymi ramkami (bbox) detekcji + skorelowaną numerowaną listą wykrytych pozycji | S-04, S-05 | FR-010–014 (UX domknięcie) | done     |
| S-19  | manual-cover-match            | w review ręcznie wyszukać Google Books i wybrać trafienie (z okładką + ISBN + metadanymi), gdy auto-match pudłuje lub brak okładki — zastępuje aktywnego kandydata | S-04, S-05 | FR-015–018 (UX domknięcie) | proposed |
| S-20  | shelf-statistics              | zobaczyć liczbę zdjęć obok liczby książek na liście półek + blok agregatów (zdjęcia / wykryte / skatalogowane) na widoku półki | S-03, S-05 | FR (UX) | proposed |
| S-21  | vision-spine-crop-reocr       | poprawić precyzję detekcji na gęsto ustawionych półkach — każdy grzbiet z niską pewnością (`vision_confidence < 0.7`) re-analizowany przez Claude na wyciętym cropie (bbox z S-04) zamiast całego zdjęcia | S-04, S-18 | FR-010–014, FR-039 | proposed |
| S-22  | book-edit-cover-url           | w edycji książki w katalogu: pole „Link do okładki" (URL) z podglądem — wklejenie URL od razu pokazuje miniaturę okładki; pole można wyczyścić | S-05 | FR (UX) | proposed |
| S-23  | per-detection-rematch         | przycisk „Ponów match" przy pojedynczej detekcji (bez ponownego matchowania całego zdjęcia) — odświeża kandydatów tylko dla tej jednej pozycji | S-04, S-05 | FR-015–018 (UX) | proposed |
| S-24  | photo-overlay-ux              | w review: a) przycisk toggle show/hide ramek detekcji na zdjęciu; b) kliknięcie zdjęcia → lightbox (modal) z pełnym obrazem i ramkami | S-18 | FR-010–014 (UX) | proposed |
| S-25  | detection-list-views          | widok listy detekcji (review) — przełącznik trybu prezentacji: karty rozwinięte (obecne), lista kompaktowana (1 linia/książka), kafelki (okładka + tytuł + badge pewności) | S-04, S-05 | UX polish | done |
| S-26  | admin-panel                   | panel administracyjny: lista użytkowników, flaga AI-enabled (domyślnie false — admin włącza), impersonacja (zaloguj się jako user), usunięcie konta (półki/książki przechodzą do admina), przeniesienie półki między użytkownikami | S-01 | NFR (admin ops) | proposed |
| S-27  | dark-light-mode               | przełącznik trybu ciemnego/jasnego w headerze; preferencja persystowana w localStorage; Tailwind `dark:` variant na całym UI | — | UX (standard) | proposed |
| S-28  | mobile-responsive             | responsywność mobilna dla ścieżek read (library, shelves, book detail) i write (upload, review karty); Tailwind breakpoints `sm:`/`md:` — desktop-first zachowane, telefon bez poziomego scrollowania | S-05 | NFR (UX) | proposed |
| S-29  | photos-crud                   | pełny CRUD dla zdjęć: lista zdjęć per półka (GET /api/photos?shelf_id=), usunięcie zdjęcia z Storage + cascade detections/book_candidates (DELETE /api/photos/[id]), edycja metadanych (PATCH — zmiana shelf_id / retitle); widok listy zdjęć na stronie półki | S-03, S-05 | FR (zarządzanie zdjęciami) | proposed |

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
- **Status:** proposed

### S-23: Re-match pojedynczej detekcji

- **Outcome:** na karcie każdej detekcji w review (obok „Ponów match" dla całego zdjęcia) pojawia się przycisk „Odśwież" który uruchamia matching tylko dla tej jednej pozycji — nowy endpoint `POST /api/detections/[id]/match` wywołuje `matchDetection()` i nadpisuje `book_candidates` dla tej detekcji; strona odświeża kartę bez przeładowania.
- **Change ID:** per-detection-rematch
- **PRD refs:** FR-015–018 (UX — lokalna aktualizacja propozycji bez kosztu re-matchowania całego zdjęcia)
- **Prerequisites:** S-04, S-05
- **Parallel with:** S-22, S-24
- **Blockers:** —
- **Unknowns:** —
- **Risk:** niski — `matchDetection()` w `match.ts` jest już izolowaną funkcją; endpoint opakowuje ją per-detekcję. Subrequest limit CF Workers (50) nie jest problemem — to jeden detection, nie batch.
- **Status:** proposed

### S-24: UX overlay zdjęcia — toggle ramek + lightbox

- **Outcome:** w widoku review (S-18): a) przycisk „Pokaż/Ukryj ramki" nad zdjęciem przełącza widoczność bbox-ów detekcji (`useState`); b) kliknięcie zdjęcia otwiera lightbox (natywny `<dialog>` lub `modal` div z z-index) z pełnoekranową wersją obrazu i ramkami; zamknięcie przez Esc lub kliknięcie tła.
- **Change ID:** photo-overlay-ux
- **PRD refs:** FR-010–014 (UX domknięcie overlay)
- **Prerequisites:** S-18 (overlay z ramkami)
- **Parallel with:** S-22, S-23
- **Blockers:** —
- **Unknowns:** —
- **Risk:** niski — pure UI, brak API. Pułapka: lightbox na CF Workers nie ma dostępu do `document.body` po stronie serwera — komponent musi być React island (`client:load`).
- **Status:** proposed

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

### S-29: Pełny CRUD dla zdjęć

- **Outcome:** użytkownik może: zobaczyć listę zdjęć przypisanych do półki (GET /api/photos?shelf_id=) wraz ze statusem i skróconymi metadanymi; usunąć zdjęcie (DELETE /api/photos/[id]) co kasuje plik z Storage `shelf-photos` oraz kaskadowo detekcje i book_candidates (RLS: tylko właściciel); edytować metadane zdjęcia (PATCH /api/photos/[id] — zmiana `shelf_id`); widok listy zdjęć na stronie półki `/shelves/[id]` z miniaturkami i akcją usunięcia (z potwierdzeniem modalem).
- **Change ID:** photos-crud
- **PRD refs:** FR (zarządzanie zdjęciami — user-driven backlog)
- **Prerequisites:** S-03 (upload), S-05 (katalog — przed DELETE musi być ostrzeżenie o utraceniu book_candidates/shelf_entries powiązanych ze zdjęciem)
- **Parallel with:** S-27, S-28
- **Blockers:** —
- **Unknowns:**
  - Co dzieje się z `shelf_entries` powiązanymi przez `photo_id`/`detection_id` przy DELETE zdjęcia — czy NULL-ować FK (`on delete set null` jest już w schemacie) czy blokować usunięcie gdy są aktywne shelf_entries. Decyzja: null-ować (schema już tak robi), ale UI musi ostrzegać że „usunięcie zdjęcia nie usuwa potwierdzonych książek z katalogu".
  - Czy DELETE bez potwierdzenia = za ryzykowne (vision kosztuje pieniądze). Decyzja: modal potwierdzenia obowiązkowy.
- **Risk:** DELETE jest destruktywny i nieodwracalny (Storage + DB). Konieczne ostrzeżenie w UI ile detekcji/kandydatów zostanie usuniętych. Nie blokować shelf_entries — book_catalog pozostaje, tylko traci link do źródłowego zdjęcia.
- **Status:** proposed

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
- **Status:** proposed

### S-28: Responsywność mobilna

- **Outcome:** wszystkie ścieżki read (library `/library`, widok półki `/shelves/[id]`, szczegół książki) i ścieżki write (upload, review `/photos/[id]`) działają na ekranie 375px szerokości bez poziomego scrollowania; nawigacja header składa się do hamburgera lub ikon; karty detekcji/książek dostosowują layout do wąskiego ekranu; domyślny tryb listy w S-25 na mobilnej szerokości = Lista (nie Karty).
- **Change ID:** mobile-responsive
- **PRD refs:** NFR (UX — użytkowanie w przeglądarce telefonu)
- **Prerequisites:** S-05 (stabilny UI przed cross-cutting CSS refaktorem)
- **Parallel with:** S-27 (dark mode — oba cross-cutting)
- **Blockers:** —
- **Unknowns:** upload zdjęcia na mobilnym: `<input type="file">` działa wszędzie; drag-drop nie ma sensu na dotykowym — warunkowy UI (ukryć drag area na touch devices).
- **Risk:** średni — cross-cutting jak S-27, ale ograniczony do breakpoints Tailwind (`sm:`/`md:`). Priorytet: ścieżka review (najdłuższy widok, 19 kart) i header nav. Uwaga: kamera mobilna (getUserMedia) świadomie POZA zakresem (Parked).
- **Status:** proposed

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
| S-19       | manual-cover-match           | Ręczne wyszukiwanie Google Books + wybór okładki w review         | yes                   | Pełny picker: nowy endpoint search (reuse `src/lib/books/googleBooks.ts`) + UI w `DetectionReview`; wybór nadpisuje aktywnego kandydata (cover_url + metadane). Realizowany 2. (C) |
| S-20       | shelf-statistics             | photo_count na liście półek (obok książek) + agregaty na widoku półki | yes                | #1 obie liczby (rozszerz `ShelfListItemDTO` o `photo_count` z `photos`); #2 blok agregatów na `/shelves/[id]` (suma zdjęć / wykrytych / skatalogowanych). Realizowany 3. (A) |
| S-21       | vision-spine-crop-reocr      | Re-OCR grzbietów z niską pewnością na wyciętym cropie (bbox z S-04)  | no                 | **Nie planować przed weryfikacją hipotezy** — realizować dopiero gdy telemetria `corrections` pokaże pattern złych detekcji na gęstych półkach. Inspiracja: `suxrobgm/bookshelf-scanner` (crop-first pipeline). Unknowns: skuteczność vs pełne zdjęcie, próg confidence, cap kosztu per photo. |
| S-22       | book-edit-cover-url          | Edycja okładki książki — pole URL + miniatura podglądu               | yes                | Sprawdzić czy `PATCH /api/books/[id]` istnieje; jeśli nie — stworzyć w ramach slice'a. |
| S-23       | per-detection-rematch        | Re-match pojedynczej detekcji (bez matchowania całego zdjęcia)        | yes                | Nowy endpoint `POST /api/detections/[id]/match` opakowuje istniejącą funkcję `matchDetection()`. |
| S-24       | photo-overlay-ux             | Toggle ramek detekcji + lightbox zdjęcia w review                    | yes                | Buduje na S-18; pure UI — React island, brak nowych API. |
| S-25       | detection-list-views         | Tryby prezentacji listy detekcji: Karty / Lista / Kafelki            | yes                | Refaktor `DetectionCard` na 3 tryby; Popraw w trybie Lista/Kafelki otwiera modal zamiast inline. |
| S-26       | admin-panel                  | Panel administracyjny: users, ai_enabled, impersonacja, delete, przeniesienie półki | no   | **DUŻE** — podzielić na 3 fazy: (1) migracja + guard ai_enabled, (2) lista + przełącznik, (3) impersonacja + delete. Zaczynać od fazy 1. |
| S-27       | dark-light-mode              | Przełącznik ciemny/jasny — Tailwind `dark:`, localStorage, prefers-color-scheme | yes     | Sprawdzić składnię Tailwind v4 dla dark mode przed planem. |
| S-28       | mobile-responsive            | Responsywność mobilna (375px) — breakpoints Tailwind, hamburger nav, upload bez drag-drop na touch | yes | Realizować po S-27 (lub równolegle — oba cross-cutting CSS). |
| S-29       | photos-crud                  | Pełny CRUD zdjęć: GET list per shelf, DELETE (Storage + cascade), PATCH (shelf_id/metadata) | yes | Brakuje: GET list, DELETE, PATCH. DELETE wymaga cascade: detections → book_candidates, usunięcia pliku z Storage `shelf-photos`. |

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

(Pusta przy pierwszej generacji. `/10x-archive` dopisuje tu wpis — i przerzuca Status pozycji na `done` — gdy archiwizowana zmiana ma `Change ID` zgodny z pozycją roadmapy. NIE wypełniać ręcznie.)
