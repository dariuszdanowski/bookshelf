---
project: "BookShelf Scanner"
version: 1
status: draft
created: 2026-05-25
updated: 2026-05-26
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
| S-02  | shelves-crud-and-purchased   | tworzyć/edytować/usuwać półki; auto-półka "Zakupione"     | S-01          | FR-005–009            | proposed |
| S-03  | shelf-photo-vision-detection | wgrać zdjęcie półki → rozpoznane detekcje grzbietów        | S-02          | FR-010–014, FR-039    | proposed |
| S-04  | external-match-and-proposals | zobaczyć propozycje z bazy publicznej + flagi duplikatów  | S-03          | FR-015–018            | proposed |
| S-05  | proposal-accept-to-catalog   | akceptować/odrzucać/korygować → katalog + widok półki     | S-04          | FR-019–024, FR-037    | proposed |
| S-06  | add-purchase-flow            | dodać zakup (ręcznie/zdjęcie) na półkę "Zakupione"        | S-05, S-02    | FR-025–028            | proposed |
| S-07  | move-book-and-history        | przenieść książkę między półkami z historią lokalizacji   | S-05, S-02    | FR-029–031, FR-038    | proposed |
| S-08  | catalog-search-and-filters   | wyszukać katalog pełnotekstowo + filtry (kolor/półka/status) | S-05, S-02 | FR-032–036            | proposed |
| S-09  | landing-auth-cta             | niezalogowany na `/` widzi CTA do logowania i rejestracji; zalogowany — CTA do biblioteki; logout redirektuje na `/login` zamiast `/` | S-01 | FR-001 (UX adjacent)  | done     |
| S-10  | custom-404-page              | Astro renderuje custom 404 page (Layout + conditional CTA) zamiast default białej strony | — (S-01 adjacent) | UX polish | done     |
| S-11  | health-check-endpoint        | `GET /api/health` zwraca `{data:{status,version,timestamp}}` z F-02 envelope; whitelisted w middleware | F-02 | NFR (monitoring) | done     |
| S-12  | loading-skeleton-component   | Generic React `<Skeleton />` (gray pulsing div) gotowy dla S-03/S-04/S-08 | — | UI substrate | done     |

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
- **Status:** proposed

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
- **Status:** proposed

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
- **Status:** proposed

### S-05: Akceptacja propozycji → katalog + widok półki  ★ north star

- **Outcome:** użytkownik może akceptować (hurtowo pre-zaznaczone lub po kolei), odrzucać lub korygować pola (tytuł/autor/wydawnictwo/rok) przed akceptacją, oraz wpisać książkę ręcznie, gdy brak matchu; zaakceptowana książka trafia do katalogu ze statusem przeczytania = nie przeczytana i pozycją na półce ("od lewej"); użytkownik widzi półkę z okładkami w kolejności od lewej i przełącza status przeczytania jednym kliknięciem; każda korekta/odrzucenie zapisane jako sygnał telemetryczny.
- **Change ID:** proposal-accept-to-catalog
- **PRD refs:** FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-037; US-01 (domknięcie Flow A)
- **Prerequisites:** S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** domyka gwiazdę przewodnią (Flow A end-to-end) i niesie KPI acceptance-rate + time-to-first-shelf; największa wartość produktu, więc sekwencjonowana najwcześniej, jak pozwalają prerekwizyty — opóźnienie tu opóźnia walidację całej hipotezy.
- **Status:** proposed

### S-06: Flow B — dodaj zakup na półkę "Zakupione"

- **Outcome:** użytkownik może otworzyć akcję "Dodaj zakup" z dowolnego widoku katalogu, wybrać metodę (zdjęcie stosu uruchamia istniejący pipeline rozpoznawania LUB wpisanie ręczne), wpisać tytuł + autora, ustawić opcjonalną datę zakupu (domyślnie dziś) i zatwierdzić; książka ląduje na wirtualnej półce "Zakupione" ze statusem przeczytania = nie przeczytana; ścieżka ręczna ≤ 90 s.
- **Change ID:** add-purchase-flow
- **PRD refs:** FR-025, FR-026, FR-027, FR-028; US-02
- **Prerequisites:** S-05, S-02
- **Parallel with:** S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** 90 s Time-to-add-purchase to próg utrzymania nawyku (Flow B używany dziesiątki razy w roku); przekombinowany formularz zabija KPI — ścieżka ręczna musi być wolna od tarcia. Ścieżka "zdjęcie stosu" deleguje do łańcucha S-03→S-05, więc nie duplikuje vision.
- **Status:** proposed

### S-07: Przenoszenie książek + wersjonowana historia lokalizacji

- **Outcome:** użytkownik może przenieść książkę z dowolnej półki (w tym "Zakupione") na inną przez akcję "Przenieś na półkę X"; data zakupu i ręczne metadane pozostają na rekordzie książki; system zapisuje wersjonowaną historię lokalizacji (poprzednia oznaczona jako historyczna, nowa jako aktualna), tak by katalog odpowiadał "gdzie ta książka jest dziś i gdzie była".
- **Change ID:** move-book-and-history
- **PRD refs:** FR-029, FR-030, FR-031, FR-038; US-02 (przeniesienie z "Zakupione")
- **Prerequisites:** S-05, S-02
- **Parallel with:** S-06, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** wersjonowana historia lokalizacji (FR-038) to dług, który tanio zaciągnąć od razu, a drogo dorobić wstecz po nagromadzeniu danych bez kolumny historii.
- **Status:** proposed

### S-08: Wyszukiwarka katalogu — pełnotekst + filtry

- **Outcome:** użytkownik może wyszukać książkę pełnotekstowo (tytuł, autor, wydawnictwo, krótki opis z bazy publicznej), filtrować po kolorze grzbietu (paleta ~10), po półce (multi-select) i statusie przeczytania, oraz kombinować pełnotekst z dowolnym zestawem filtrów; wyniki pokazują nazwę półki + pozycję + status przeczytania; brak wyników daje jednoznaczny komunikat "nie masz tej książki".
- **Change ID:** catalog-search-and-filters
- **PRD refs:** FR-032, FR-033, FR-034, FR-035, FR-036; US-03, US-04; NFR (p95 < 1 s na ~1000 wyników)
- **Prerequisites:** S-05, S-02
- **Parallel with:** S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - Finalna paleta nazwanych kolorów grzbietu (Open Q2) — Owner: użytkownik. Block: no (kierunek dany; MUSI być zamrożona przed implementacją filtra, bo zmiana unieważnia już zindeksowane wartości — patrz Open Roadmap Questions).
- **Risk:** p95 < 1 s na ~1000 wyników + kombinowalne filtry to KPI find-in-house i in-bookstore; niezindeksowane pole opisu/koloru rozjeżdża wydajność, a niezamrożona paleta unieważnia zindeksowane wartości.
- **Status:** proposed

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

## Open Roadmap Questions

1. **Strojenie progów pewności dopasowania (FR-016: 0.75 / 0.55).** Owner: użytkownik. Block: `S-04` (nieblokujące startu; wartości startowe, strojenie z telemetrii korekt po ~1 mies. używania na realnej kolekcji).
2. **Finalna paleta nazwanych kolorów grzbietu (FR-011, FR-033).** Owner: użytkownik. Block: `S-03`, `S-08` (cross-cutting; ~11 sugerowanych kolorów w PRD, ale precyzyjna lista MUSI być zamrożona przed `S-08`, bo paleta jest częścią kontraktu rozpoznawania i jej zmiana unieważnia już zindeksowane wartości).
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

(Pusta przy pierwszej generacji. `/10x-archive` dopisuje tu wpis — i przerzuca Status pozycji na `done` — gdy archiwizowana zmiana ma `Change ID` zgodny z pozycją roadmapy. NIE wypełniać ręcznie.)
