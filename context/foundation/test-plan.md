# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-04 (Phase 1 → complete, PR #39)

## 1. Strategy

Testy w tym projekcie podlegają trzem nienegocjowalnym zasadom:

1. **Koszt × sygnał.** Wygrywa najtańszy test dający realny sygnał na dane
   ryzyko. Nie awansujemy do e2e, bo „e2e wydaje się bezpieczniejsze". Nie
   nakładamy modelu vision na deterministyczny diff, który i tak łapie
   regresję. **Twardy guardrail kosztu: NIGDY nie wywołujemy realnego
   vision/LLM w automatach** — Anthropic API to fizyczne pieniądze; vision
   zawsze mockujemy przez `page.route` (E2E) lub `vi.mock` (unit).
2. **Obawy użytkownika to dowód pierwszej klasy.** Ryzyka zakotwiczone w
   „zespół boi się X, a porażka ujawni się gdzieś w obszarze `<area>`" ważą
   tyle samo, co linie PRD czy dane hot-spot. W tym projekcie obawy są
   nietypowo gęsto udokumentowane w `CLAUDE.md` (guardrail prywatności,
   guardrail kosztu, no-data-loss), `context/foundation/lessons.md` i
   archiwum slice'ów — mapa §2 czerpie z nich jak z wywiadu.
3. **Ryzyka to scenariusze, nie lokalizacje w kodzie.** Ten plan dokumentuje
   *co może się zepsuć* i *dlaczego to prawdopodobne* — z dokumentów, obaw i
   *sygnału* z kodu (churn, struktura, baza testów). NIE twierdzi, która
   linia jest właścicielem porażki. Tę wiedzę produkuje `/10x-research` w
   każdej fazie rolloutu. Gdy plan i research nie zgadzają się co do tego,
   gdzie żyje porażka — ground truth jest research.

Zakres hot-spot użyty do ważenia prawdopodobieństwa: `src/components`,
`src/pages/api`, `src/lib/{vision,books,matching,db,http,photos}`,
`src/layouts`.

## 2. Risk Map

Czołowe scenariusze porażki, które projekt musi chronić, uporządkowane wg
ryzyka = impact × likelihood. Ryzyka są scenariuszami w kategoriach
użytkownika/biznesu, nie nazwami testów. Kolumna Źródło cytuje *dowód, który
wyniósł ryzyko na wierzch* — nigdy konkretnego pliku jako „gdzie żyje
porażka" (to zadanie research, zob. §1 zasada #3).

| # | Ryzyko (scenariusz porażki) | Impact | Likelihood | Źródło (dowód — nie kotwica) |
|---|------------------------------|--------|------------|-------------------------------|
| 1 | Wyciek RLS — uwierzytelniony user A czyta lub mutuje dane usera B (półki, książki, zdjęcia, detekcje) | High | High | CLAUDE.md § Supabase „RLS od pierwszego dnia" + privacy guardrail (powtarzany); roadmap F-01 risk „cały katalog wisi na RLS", NFR-privacy; hot-spot `src/pages/api` + `src/lib/db` (14 commitów/30d) |
| 2 | IDOR / 404-privacy — endpoint item ujawnia istnienie cudzego zasobu albo pozwala na cross-user mutację przez zgadnięty lub zniekształcony UUID | High | Medium | CLAUDE.md § API endpoints „Status codes (privacy-first)" + `parseUuidParam`; hot-spot `src/pages/api/photos/[id]` (23) + `src/pages/api/detections/[id]` (12) |
| 3 | Niekontrolowany koszt vision — regresja odpala płatny call gdy nie powinna (podwójny process, retry-loop, re-process już-przetworzonego) albo koszt/latencja nie zostają zapisane | High | Medium | CLAUDE.md § Testy „Koszt = twardy guardrail" + § Vision LLM; PRD FR-039 + daily budget cap; roadmap S-30 cost-preservation, S-36 skip-process; hot-spot `src/lib/vision` (17) |
| 4 | Utrata danych detekcji / brak idempotencji — retry lub reload gubi albo duplikuje detekcje; DELETE zdjęcia kasuje historię kosztów vision | High | Medium | CLAUDE.md § Vision „każda detekcja persistowana przed matchingiem (idempotencja)"; memory `s04-detection-spatial-region-model` „dane nie mogą zginąć"; roadmap S-03 no-data-loss, S-30; hot-spot `src/pages/api/photos/[id]` (23) |
| 5 | Błędny matching — fallback OpenLibrary nie odpala przy padzie/limicie Google Books (puste propozycje wyglądają jak „brak matchu"); drift progów 0.75/0.55 pre-zaznacza złych kandydatów | Medium | Medium | PRD § Matching progi; roadmap S-04 risk „za liberalny próg zaniża acceptance rate"; hot-spot `src/lib/books` (15) + `src/lib/matching` (9) |
| 6 | Naruszenie integralności katalogu — accept/move/delete łamie inwariant „książka na dokładnie jednej półce" lub non-atomiczny zapis zostawia sieroty (shelf_entry bez book, brak bieżącej półki) | Medium | Medium | roadmap S-02 inwariant + niesuwalna „Zakupione"; archive S-05 lesson „helper confirm bez transakcji — obserwuj błędy zapisów"; S-07 non-atomic move insert-first; hot-spot `src/pages/api/detections/[id]` (12) |

Lens abuse/security pokryty: ryzyko #1 (authorization/ownership), #2 (IDOR +
enumeracja), #3 (resource abuse — koszt w pętli). **BYOK secret leakage
(roadmap S-32)** świadomie POZA tą mapą — to kod jeszcze nieistniejący;
zakotwiczenie ryzyka na nieistniejącym kodzie byłoby spekulatywne. Aktywuje
się jako osobna faza rolloutu, gdy S-32 wejdzie (zob. §7).

### Risk Response Guidance

| Risk | Co dowodzi ochrony | Co zakwestionować | Kontekst, który `/10x-research` musi ugruntować | Najtańsza warstwa | Anty-wzorzec do uniknięcia |
|------|--------------------|--------------------|--------------------------------------------------|-------------------|-----------------------------|
| #1 | Klient z JWT usera B dostaje pusty wynik / 404 na zasób usera A — na obu kształtach polityk (bezpośredni `user_id` ORAZ EXISTS-przez-parent) | „Mockowany select w unitach dowodzi izolacji" — mock omija RLS; dowód wymaga realnej bazy z politykami | Realny lokalny Supabase (migracje 0001+0002), dwóch userów przez admin API, JWT-scoped klienci anon; service-role tylko w pliku testu | integration (realna DB) | Mockowanie warstwy DB i twierdzenie, że to dowód RLS (tautologia — testuje mock, nie politykę) |
| #2 | Żądanie cross-user na `/api/<res>/[id]` zwraca 404 (nie 403, nie 200); zniekształcony UUID → 404 bez przecieku kształtu ID; 401 przed fetchem zasobu | „404 = rekord nie istnieje" — w tym kontrakcie 404 ma też znaczyć „cudze"; nie wolno kodować osobnej gałęzi 403 | Kolejność guardów (401 przed fetch), zachowanie `parseUuidParam`, czy RLS faktycznie zwraca PGRST116 mapowane na 404 | unit (mock) + integration (real cross-user) | Test sprawdzający tylko happy-path 200; assert na 403 zamiast 404 (przeciek istnienia) |
| #3 | Endpoint `/process` nie wywołuje vision dla zdjęcia już w stanie `processed`; retry po parse-fail nie mnoży kosztu; `vision_cost_usd`/`vision_latency_ms` zapisane na rekordzie | „Sukces 200 znaczy, że koszt policzony poprawnie"; „retry jest darmowy" | Maszyna stanów `photos.status`, ścieżka retry-with-thinking, gdzie zapisywany jest koszt, idempotency-key na detekcji | unit (mock vision) + integration | Wywołanie realnego Anthropic w teście (koszt!); assert tylko na status bez sprawdzenia braku ponownego billingu |
| #4 | Po retry/reload liczba detekcji jest stała (idempotencja); po DELETE zdjęcia wpisy kosztów (`vision_runs`) przeżywają z `user_id`, książki zostają | „Reprocess czyści i wstawia od nowa" — to gubi historię; „CASCADE jest OK dla kosztów" — S-30 zmienił na SET NULL | Czy persystencja detekcji jest przed matchingiem; zachowanie FK po S-30 (SET NULL vs CASCADE); co dokładnie kasuje DELETE | integration (real DB, sprawdza efekty uboczne) | Over-mocking — mock storage/DB ukryje realne zachowanie cascade; happy-path bez ścieżki retry |
| #5 | Gdy Google Books zwraca błąd/limit, OpenLibrary dostarcza kandydatów; brak kandydatów daje jawny stan „wpisz ręcznie", nie cichy pusty wynik | „Pusta odpowiedź = brak książki" — może znaczyć padnięty primary; „próg 0.75 jest poprawny" — to wartość startowa do strojenia | Granica sieciowa obu klientów, kolejność primary→fallback, mapowanie błędu na propozycje, jak liczony jest match_score | unit (mock HTTP na granicy) | Assertowanie wyniku skopiowanego z logiki scoringu (oracle problem); over-mock obu API tak, że fallback nigdy nie ćwiczony |
| #6 | Po move książka ma dokładnie jeden `is_current=true` shelf_entry; po accept książka istnieje raz; usunięcie półki przenosi książki na „Zakupione" | „Insert-first move jest atomiczny" — nie jest (zob. S-07); „confirm helper jest transakcyjny" — nie jest (zob. S-05 lesson) | Kolejność zapisów w move (insert nowy max+1 → update stary), brak transakcji w confirm, trigger niesuwalnej „Zakupione" | unit (mock) + integration (inwariant na real DB) | Brittle ordering assumption; test happy-path bez scenariusza częściowej porażki zapisu |

## 3. Phased Rollout

Każdy wiersz to dyskretna faza rolloutu, która otworzy własny folder zmiany
przez `/10x-new`. Status przesuwa się od lewej do prawej; orchestrator
aktualizuje Status w miarę pojawiania się artefaktów na dysku.

Kontekst: projekt jest niemal kompletny (S-01…S-31 done, 62 unit + 20 e2e +
3 integration). „Baseline" poniżej dokumentuje istniejące pokrycie jako
`complete`; fazy 1–3 to **realne luki**, gdzie sygnał jest najsłabszy
względem ryzyka.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|----------------|
| 1 | RLS isolation gate w CI | Dowód izolacji per-user wykonuje się automatycznie, nie tylko ręcznie post-merge (podpiąć `test:integration` do istniejącego joba e2e — lokalna Supabase już stoi) | #1, #4 | integration | complete | PR #39 (zmergowany, CI zielony) |
| 2 | Authorization/IDOR contract | Każdy endpoint item ma test cross-user 404 + malformed-UUID; kontrakt 401-przed-fetch zweryfikowany na realnym RLS | #2 | unit + integration | not started | — |
| 3 | Cost & idempotency regression | Brak podwójnego billingu / re-process; koszt przeżywa DELETE; retry idempotentny | #3, #4 | unit + integration | not started | — |
| — | Baseline (istniejące) | 62 unit + 20 e2e: auth, CRUD półek/książek, matching/dedupe/isbn, accept-flow, search, photos-crud, account, overlay | #5, #6, cross-cutting | unit + e2e | complete | (rozproszone w `tests/`) |

**Status vocabulary** (fixed — parser literals): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

Klasyczna baza testów tego projektu. Narzędzia AI-native (jeśli są) noszą
datę `checked:`. Rekomendacje ugruntowane w lokalnych manifestach/configach
plus MCP/narzędzia faktycznie wystawione w bieżącej sesji.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit | Vitest | 4.1.7 | jsdom env, setup `tests/unit/setup.ts`, coverage v8; config `vitest.config.ts` |
| integration (real DB) | Vitest | 4.1.7 | osobny config `vitest.integration.config.ts` (env node); `describe.skip` bez env Supabase — **dziś nigdy nie odpala w CI, zob. §3 Phase 1** |
| API/HTTP mocking | `vi.mock` + ręczne stuby | n/a | mock na granicy (Supabase client, fetch do Google Books/OpenLibrary, `cloudflare:workers`); nie mockujemy modułów wewnętrznych |
| e2e | Playwright | 1.60.0 | chromium; `storageState` = 1 signup/run; `webServer` startuje `npm run dev` :4321; vision mockowany `page.route` |
| accessibility | brak | — | a11y tylko podstawy (PRD §Non-Goals — pełny WCAG poza MVP); getByRole w e2e daje pośredni sygnał |
| (optional) AI-native | post-edit ESLint hook — checked: 2026-06-03 | n/a | `.claude/hooks/post-edit-lint.cjs` (PostToolUse, advisory); NIE vision-review (koszt) |

**Stack grounding tools (current session):**
- Docs: Context7 — dostępny; nie odpytywany w tej generacji (stack testowy stabilny, wersje z `package.json`/health-check); checked: 2026-06-04
- Search: Exa.ai — dostępny; nie użyty (brak pytania o aktualność narzędzia); checked: 2026-06-04
- Runtime/browser: Playwright MCP — dostępny w sesji; nie użyty jako warstwa testowa (deterministyczne e2e wystarczają; vision-review odrzucony kosztowo); checked: 2026-06-04
- Provider/platform: Cloudflare MCP (Worker logs/secrets), Supabase MCP (wskazuje **remote prod** — używać świadomie); relevantne dla post-deploy smoke i debugowania, nie dla bramki testowej; checked: 2026-06-04

## 5. Quality Gates

Pełny zestaw bramek przed produkcją. „Required after §3 Phase N" znaczy, że
bramka jest egzekwowana, gdy ta faza wyląduje; przedtem jest `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local + CI (`ci.yml`) | required | drift składni/typów; ESLint v9 flat + `astro check` (po `wrangler types`) |
| unit (jsdom/offline) | local + CI (`npm run test`) | required | regresje logiki — 62 pliki, 97+ testów |
| e2e na krytycznych flow | CI on PR (job `e2e`, lokalna Supabase + chromium) | required | zepsute ścieżki użytkownika; vision mockowany |
| integration RLS (real DB) | CI on PR | **planned — required after §3 Phase 1** | wyciek izolacji per-user; dziś `describe.skip` (luka) |
| post-edit ESLint hook | local (pętla agenta) | recommended (done 2026-06-03) | regresje lint w czasie edycji |
| post-deploy smoke | między merge a prod (`deploy.yml`) | required | zombie-deploy / drift sekretów; `curl /api/health` |
| migrate-first (db push) | `deploy.yml` po merge | required | aplikacja migracji przed `wrangler deploy`; walidowana pre-merge przez `supabase start` w `e2e` |

## 6. Cookbook Patterns

Jak dodawać nowe testy w tym projekcie. Projekt ma już bogatą bazę — poniżej
realne testy referencyjne, nie placeholdery.

### 6.1 Dodanie unit testu

- **Lokalizacja**: `tests/unit/` lustrzane do `src/` (np. `tests/unit/lib/matching/` dla `src/lib/matching/`, `tests/unit/pages/api/shelves/` dla endpointów).
- **Nazwa**: `<module>.test.ts` / `<Component>.test.tsx`.
- **Test referencyjny**: `tests/unit/lib/matching/` (score/dedupe/isbn — czysta logika domenowa) oraz `tests/unit/pages/api/shelves/id.test.ts` (endpoint + F-02 envelope + mapowanie SQLSTATE).
- **Mocking**: `vi.mock` na granicy (Supabase client, `cloudflare:workers`); nigdy moduły wewnętrzne. Oracle z wymagań/PRD, nie z testowanej implementacji.
- **Run locally**: `npm run test`.

### 6.2 Dodanie integration testu (realna baza)

- **Lokalizacja**: `tests/integration/`.
- **Polityka mockowania**: ZERO mocków DB — to cały sens. Realny lokalny Supabase (migracje + seed). Service-role client konstruowany **tylko w pliku testu**, nigdy w `src/lib/db/`.
- **Guard env**: `describe.skip` gdy brak `PUBLIC_SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY` — bez env CI nie pada, ale test się nie wykonuje (zob. §3 Phase 1 — to luka do podpięcia).
- **Test referencyjny**: `tests/integration/rls.test.ts` (dowód izolacji na obu kształtach polityk) + `tests/integration/shelves-rls-and-triggers.test.ts`.
- **Run locally**: `npm run test:integration` (wymaga env w `.dev.vars`/`.env.local`).

### 6.3 Dodanie e2e testu

- **Lokalizacja**: `tests/e2e/<risk-name>.spec.ts`. Nazwa po ryzyku, nie „test 1".
- **Locatory**: `getByRole`/`getByLabel`/`getByText` > `getByTestId` > nigdy CSS/XPath. Czekaj na stan (`toBeVisible`, `waitForURL`, `waitForResponse`), nigdy `waitForTimeout`.
- **Izolacja**: każdy test self-contained; auth przez `storageState`, nie logowanie w UI; unikalne dane (timestamp) + cleanup.
- **Vision/external**: ZAWSZE mock przez `page.route` — nigdy realny LLM.
- **Test referencyjny**: `tests/e2e/proposal-accept-to-catalog.spec.ts` (pełny flow accept), `tests/e2e/auth.spec.ts` (golden auth). Brak dedykowanego `seed.spec.ts` (artefakt M3L4) — istniejące spece pełnią rolę wzorca; ewentualny seed wskaż jako kanoniczny w osobnym slice.
- **Run locally**: `npm run test:e2e` (pierwszy raz: `npx playwright install --with-deps chromium`).

### 6.4 Dodanie testu dla nowego API endpointu

- **Typ**: unit (mock Supabase) jako baza + integration (real RLS) dla ścieżki ownership/cross-user.
- **Wzorzec**: assert kształtu odpowiedzi F-02 (`{data}` / `{error:{code}}`) ORAZ efektów ubocznych; mapowanie SQLSTATE (23505→400, 23503→404, P0001→400, PGRST116→404); 401-przed-fetch; 404 dla cudzego/zniekształconego UUID.
- **Test referencyjny**: `tests/unit/pages/api/photos/[id].test.ts`, `tests/unit/pages/api/books/id.test.ts`.

### 6.5 Dodanie testu dla nowej polityki RLS / migracji

- **Typ**: integration (real DB) — jedyna warstwa dowodząca polityki.
- **Wzorzec**: dwóch userów, każdy anon-klientem z własnym JWT; dowód że B nie widzi/nie mutuje danych A; cleanup kasuje userów (cascade czyści domenę). Dla triggerów (niesuwalna „Zakupione", `handle_new_user`) — assert `RAISE EXCEPTION`/P0001.
- **Test referencyjny**: `tests/integration/shelves-rls-and-triggers.test.ts`, `tests/integration/auth-trigger.test.ts`.

### 6.6 Mutation testing (Stryker, moduł matching)

- **Typ**: lokalny audyt skuteczności suite'y unit — `npm run test:mutation` (M3L2, plan certyfikacyjny P3, 2026-06-06). **NIE w CI** (runtime nie strzeże regresji solo-dev; CI gates zostają deterministyczne).
- **Zakres**: `src/lib/matching/**` (czyste funkcje decyzyjne: score/dedupe/isbn/normalize/fallback) — `stryker.config.json` + scoped `vitest.stryker.config.ts` (85→110 testów modułu, run ~25–45 s dzięki wycięciu jsdom i 70 pozostałych plików).
- **Wynik**: baseline **63.07%** → po dopisaniu 25 testów granicznych **76.87%** (713 mutantów, 577 killed). Per plik: `isbn.ts` 98%, `fallbackPolicy.ts` 34→83% (progi 0.62/0.55, geometria bbox, `looksLikeAuthorName`), `normalizeQuery.ts` 56→66% (mapa homoglifów, kwantyfikatory regex), `dedupe.ts` 78%, `score.ts` 77%.
- **Świadomie zaakceptowane przeżycia**: `findCandidates.ts` 50% — kod orkiestracyjny (kaskada query → klienci zewnętrzni), pokrywany przez testy endpointów i E2E, mutation testing na orkiestracji daje niski sygnał; resztkowe mutanty regex-literal w `normalizeQuery` (ekwiwalentne lub kosmetyczne). Próg `thresholds.high: 85` celowo aspiracyjny, `break: null` — raport informacyjny, nie gate.
- **Wzorzec ponownego użycia**: po większej zmianie w `src/lib/matching/` odpal `npm run test:mutation` (incremental cache w `reports/mutation/`); przeżycia wskazujące realną lukę logiki → dopisz test graniczny; przeżycia ekwiwalentne → odnotuj tutaj.

### 6.7 Per-rollout-phase notes

(Uzupełniane po wylądowaniu każdej fazy przez `/10x-implement`.)

## 7. What We Deliberately Don't Test

- **Realny vision/LLM w automatach** — koszt = fizyczne pieniądze (Anthropic API). Zawsze mock. Re-ewaluuj nigdy; realny vision tylko w manualnym smoke (user-only). (Źródło: CLAUDE.md § Testy guardrail kosztu.)
- **Pełny audyt WCAG-AA / a11y** — w MVP tylko podstawy; `getByRole` w e2e daje pośredni sygnał. Re-ewaluuj, jeśli a11y wejdzie do scope. (Źródło: PRD §Non-Goals.)
- **Mobile / responsywność (375px)** — jeszcze nie zbudowane (S-28 proposed). Brak ekranu = brak testu. Re-ewaluuj po S-28.
- **Wnętrze szyfrowania BYOK** — kod nie istnieje do czasu S-32. Gdy wejdzie: szyfrowanie at-rest, never-return plaintext, never-log to ryzyka High wymagające security review + dedykowanej fazy rolloutu. Re-ewaluuj przy `/10x-plan S-32`.
- **Generowane artefakty** (`worker-configuration.d.ts`, `database.types.ts`) — generator jest testem; nie piszemy testów na wygenerowane typy.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-04
- Stack versions last verified: 2026-06-04
- AI-native tool references last verified: 2026-06-04

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (np. S-32 BYOK ląduje → secret-leakage wchodzi do §2),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
