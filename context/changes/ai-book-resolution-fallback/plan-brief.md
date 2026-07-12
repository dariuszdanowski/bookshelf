# AI book resolution fallback (S-50) — Krótki plan

> Pełny plan: `context/changes/ai-book-resolution-fallback/plan.md`
> Roadmap: `context/foundation/roadmap.md` (S-50)

## Co i dlaczego

Trzeci, ostatni poziom kaskady dopasowania książek: gdy strukturalne źródła (Google Books/OpenLibrary/BN) i word-level fallback (S-48) nie znajdą kandydata `>= MATCH_MID`, użytkownik może ręcznie uruchomić rozwiązanie przez AI — Claude z narzędziem `web_search`, opłacane własnym kluczem Anthropic (BYOK). Wykryte przy teście #153 (2026-07-12): OCR gubi odmianę/liczbę tytułu („Złodziej" zamiast „Złodzieje książek"), keyword-search BN zwraca wtedy zupełnie inne wyniki. Web search naturalnie radzi sobie z takim szumem bez budowania własnego stemmera (zastępuje wcześniejszy pomysł „polish-grammatical-variants").

## Punkt wyjścia

Kaskada matchingu (`findBookCandidates`) już ma dwa poziomy (strukturalne źródła + S-48 word-fallback) i zostawia detekcję ze statusem `pending`/0 kandydatów gdy oba zawiodą. Istnieje gotowy szablon dla zewnętrznego, manualnego rozwiązania per-detekcja (`rematch.ts`, conservative-replace). BYOK (`getActiveProviderConfig`) i wzorce kosztowo-audytowe (`vision_runs`/`refine_calls`) już istnieją, ale **guardrail kosztowy w runtime nie istnieje nigdzie** — najbliższy precedens (`fallbackPolicy.ts::REFINE_BUDGET_LIMITS`) jest martwym kodem, nigdy niewpiętym do `refine.ts`.

## Pożądany stan końcowy

Na karcie detekcji bez kandydatów pojawia się przycisk „Rozwiąż przez AI" → dialog potwierdzenia kosztu → wynik (jeśli znaleziony i pewny) trafia jako zwykły `book_candidates` (source `ai_resolution`), przechodzi przez ten sam scoring i UI accept/reject co każdy inny kandydat. Operacja ograniczona faktycznie egzekwowanym budżetem, dostępna tylko z aktywnym kluczem Anthropic, audytowana kosztowo i widoczna w `/account`.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Granularność wywołania | Pojedyncze per detekcja, nie batch | Roadmapowy otwarty punkt; batch to nowy, ryzykowny wzorzec (partial-failure) bez precedensu — single-call 1:1 mapuje się na istniejący `rematch.ts` | Plan |
| Trigger | Manualny przycisk (nie automatyczny w `/process`) | Spójne z konwencją S-35 `manual_only` — user świadomie płaci za wywołanie | Plan |
| Zakres providerów | Tylko aktywny klucz `provider='anthropic'` | `web_search` to narzędzie Anthropic-specific; inne providery idą przez surowy fetch bez tool-use | Plan |
| Wynik → dokąd | Zwykły `book_candidates` (source `ai_resolution`), re-scored przez `scoreCandidate()` | Reużywa całą istniejącą review UI; nie ufa ślepo self-reported confidence z AI (defense-in-depth) | Plan |
| Guardrail kosztowy | Nowy, faktycznie egzekwowany budżet (3/zdjęcie, 20/dzień) | Precedens (`fallbackPolicy.ts`) jest martwym kodem — trzeba realnie wpiąć, nie skopiować | Plan |
| Tabela audytu | Nowa `resolution_calls`, od startu `photo_id`/`detection_id` nullable + `api_key_id` | Inny rodzaj wywołania niż vision/refine; unika późniejszej migracji SET NULL jak S-30/M27 | Plan |
| Schema wyniku | Zod discriminated union `found`/`not_found` + server-side floor `confidence>=0.5` | Mirror `BookCandidate` + jawne „nie zgaduj" (spójne z Vision LLM prompt philosophy) | Plan |

## Zakres

**W zakresie:** migracja (tabela + 2 CHECK), moduł `src/lib/resolution/` (prompt/schema/client/budget), endpoint `POST /api/detections/[id]/resolve`, rozszerzenie `/api/account/stats` i `/api/photos/[id]/costs`, UI przycisk+dialog w `DetectionReview.tsx`, wiersz kosztu w `AccountIsland.tsx` i `CostPanel.tsx`, etykieta źródła w `BookModal.tsx`, testy jednostkowe + E2E (mock).

**Poza zakresem:** batch resolution, automatyczny trigger w pipeline, wsparcie non-Anthropic providerów, drugi „zawsze dostępny" klucz Anthropic niezależny od aktywnego, nowy status DB dla detekcji, admin-level dashboard kosztów.

## Architektura / Podejście

`DetectionReview.tsx` (przycisk+dialog) → `POST /api/detections/[id]/resolve` → budżet-check (query `resolution_calls`) → `resolveBookViaAI()` (`src/lib/resolution/client.ts`, lazy-import Anthropic SDK, `web_search` tool) → Zod-parsowanie → audyt do `resolution_calls` (zawsze) → gałąź found (re-scored przez `scoreCandidate`, insert `book_candidates`) / not_found (insert `corrections`). Wynik pojawia się w istniejącej review UI bez nowej równoległej ścieżki.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Schemat i typy | Migracja + rozszerzone typy/kontrakty błędów | Nazwa auto-generowanego CHECK constraintu (mitygowane: dynamiczne wyszukanie po `pg_constraint`) |
| 2. Moduł `resolution/` | Czysty klient Claude+web_search, Zod schema, budżet | — |
| 3. API endpoint + koszty | `resolve.ts`, rozszerzenie `stats.ts` + `costs.ts` | `resolution_calls` niekomittowane w `database.types.ts` — dostęp przez `as any` + defensywny retry (ugruntowany wzorzec repo, nie blocker) |
| 4. UI | Przycisk, dialog, obsługa błędów, `AccountIsland`/`CostPanel`/`BookModal` | Spójność z istniejącymi wzorcami `RefineButton`/toast |
| 5. Testy | Vitest (schema/budżet) + Playwright (mock) | Zero realnych wywołań Anthropic w automatach (twarda zasada) |

**Wymagania wstępne:** aktywny klucz Anthropic (BYOK, S-32/S-33) na koncie testowym do fazy 3/5 manual smoke; lokalny stack Supabase (WSL) do aplikacji migracji.
**Szacowany nakład pracy:** ~5 faz, każda w osobnym commicie; rozmiar porównywalny do S-23 (per-detection-rematch) + S-30 (cost preservation) razem.

## Otwarte ryzyka i założenia

- Koszt per rozwiązaną książkę (~$0.02–0.04, cytowane w roadmapie z docs Anthropic 2026-07-12) nie był zmierzony na rzeczywistych polskich zapytaniach w tym repo — do potwierdzenia przy manualnym smoke Fazy 3.

(Kształt `usage.server_tool_use.web_search_requests` zweryfikowany bezpośrednio w zainstalowanym `@anthropic-ai/sdk@^0.106.0` podczas plan-review — w pełni typowany, bez `as any`.)

## Kryteria sukcesu (podsumowanie)

- Detekcja bez kandydatów: przycisk → potwierdzenie → wynik trafia do zwykłego flow review (found) albo czytelny komunikat (not_found)
- Koszt każdego wywołania audytowany i widoczny w `/account`
- Budżet faktycznie blokuje po przekroczeniu (nie tylko zdefiniowany, jak w precedensie)
- Użytkownik z kluczem non-Anthropic dostaje jasny komunikat zamiast cichego błędu
