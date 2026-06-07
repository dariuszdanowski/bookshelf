# S-41 Cost Analysis View — Implementation Plan

## Overview

Interaktywny widok analizy kosztów AI na `/account`: modal z listą pojedynczych wywołań (analizy vision + doczytania OCR), filtrowaną per klucz API / typ / okres, z paginacją, sumą dla aktywnego filtra i drill-downem do zdjęcia źródłowego. Domyka kierunek z M26/M27 — agregaty i chipy już są, brakuje „co dokładnie składa się na tę kwotę".

## Current State Analysis

- **Dane**: `vision_runs` (0007 + user_id z 0015 + `api_key_id` z 0020) i `refine_calls` (0012 + `api_key_id` z 0020). Obie tabele przeżywają DELETE zdjęcia (FK `photo_id` SET NULL, 0015) i DELETE klucza (`api_key_id` SET NULL, 0020). RLS bezpośrednio na `user_id = auth.uid()`.
- **Agregaty**: `GET /api/account/stats` ([src/pages/api/account/stats.ts](../../../src/pages/api/account/stats.ts)) zwraca sumy vision/refine + `cost_by_key` (M27). Pobiera WSZYSTKIE wiersze usera i sumuje w JS — precedens akceptowalnej skali.
- **UI /account**: `AccountIsland.tsx` — sekcja „Koszty analizy" (linie ~555–586: grand total + grid vision/refine) i chip sumy przy każdym kluczu (~877–896, M27). Chip jest statyczną etykietą — nie prowadzi nigdzie.
- **Per-zdjęcie breakdown**: `CostPanel.tsx` (dropdown przy zdjęciu/detekcji, lazy fetch `GET /api/photos/[id]/costs`) — inny zakres (jedno zdjęcie), nie nadaje się jako baza dla widoku per-user; reuse tylko formatterów.
- **Wzorce**: BookModal = wzorzec modalu (overlay, ESC, klik poza); brak wzorca paginacji w API (pierwszy endpoint paginowany); `formatCost`/`formatLatency`/`formatDate` lokalne w CostPanel.
- **Typy**: `vision_runs`/`refine_calls` nie są w `database.types.ts` (regen po `db push`) — precedens `(locals.supabase as any)` w stats.ts:29.

## Desired End State

Użytkownik na `/account`:
1. Klika „Szczegóły" w sekcji „Koszty analizy" → modal z listą wszystkich wywołań (najnowsze pierwsze): typ (vision/OCR), model, data, latencja, koszt, klucz, link „Zdjęcie".
2. Klika chip kosztu przy kluczu → ten sam modal z prefiltrem na ten klucz.
3. Filtruje per klucz (w tym „Bez przypisania"), typ (vision/OCR/wszystkie), okres (7d/30d/wszystko); widzi sumę kosztów + liczbę wywołań dla aktywnego filtra; paginuje po 25.

### Key Discoveries:

- Migracja 0020 dodała `api_key_id` + indeksy `*_api_key_id_idx` do obu tabel — filtry per klucz są tanie.
- `user_api_keys` DELETE jest fizyczny (CASCADE z 0016) → osierocone koszty mają `api_key_id = NULL`; bucket „Bez przypisania" jest konieczny, inaczej historia znika z widoku.
- vision_runs `running`/`failed` mają `cost_usd NULL` — stats liczy tylko `succeeded` (stats.ts:45-46); widok listy musi być spójny.
- PG 15+ `security_invoker = true` na widoku → RLS tabel bazowych egzekwowane dla wywołującego; PostgREST eksponuje widoki jak tabele.
- Lekcja vite-stale-deps: współdzielone moduły dla islands mają być zod-free — formattery wyciągamy do czystego modułu.

## What We're NOT Doing

- Zmian w `GET /api/account/stats` ani w chipach agregatów (M27 zostaje jak jest — chip dostaje tylko `onClick`).
- Wykresów / wizualizacji czasowych (lista + suma wystarczy; wykresy = przyszły slice, jeśli w ogóle).
- Date-pickerów dowolnego zakresu (presety 7d/30d/all).
- Eksportu CSV (świadomie poza MVP, CLAUDE.md).
- Pokazywania `failed`/`running` vision runs (brak kosztu; spójność z agregatami).
- Backfillu czegokolwiek — dane już są (0020 + backfill prod z uwagi-round3).

## Implementation Approach

Dwie fazy: (1) substrat danych + API — widok SQL `cost_events` unifikujący obie tabele i paginowany endpoint `GET /api/account/costs`; (2) UI — `CostAnalysisModal` + wpięcie w `AccountIsland` + E2E.

Widok SQL zamiast merge'owania dwóch zapytań w JS: UNION ALL daje jeden spójny strumień do sortowania (`created_at desc`) i paginacji (`range`) bez błędów na granicach stron; `security_invoker = true` zachowuje RLS obu tabel bazowych.

## Critical Implementation Details

- **Manual test na dev przed merge**: dev server łączy się z prod DB — widok `cost_events` nie istnieje tam do czasu merge (deploy.yml `db push`). Jak przy M27/0020: user decyduje, czy zaaplikować 0021 ręcznie na prodzie przed testem, czy testować na lokalnej Supabase (`db reset`). Endpoint NIE dostaje defensywnego retry na `42P01` — to jednorazowe okno deweloperskie, nie stan produkcyjny.
- **Typy Supabase**: widok nie będzie w `database.types.ts` do regen — użyć precedensu `(locals.supabase as any)` z komentarzem jak w stats.ts:14-16.
- **RLS w widoku z LEFT JOIN do `detections`**: polityka `detections` filtruje przez `photos` — wiersz refine z żywym zdjęciem dostanie `raw_title`, po usunięciu zdjęcia JOIN zwróci NULL (detekcje kasowane CASCADE). To pożądane degradowanie, nie bug.

## Phase 1: Widok `cost_events` + `GET /api/account/costs`

### Overview

Substrat danych (migracja 0021) i paginowany, filtrowany endpoint listy wywołań z sumą dla filtra. Unit testy endpointu.

### Changes Required:

#### 1. Migracja — widok zunifikowanych zdarzeń kosztowych

**File**: `supabase/migrations/0021_cost_events_view.sql`

**Intent**: Jeden źródłowy strumień zdarzeń kosztowych do sortowania/paginacji/filtrowania, z RLS odziedziczonym z tabel bazowych.

**Contract**: Widok `public.cost_events` z `security_invoker = true`, kolumny: `id`, `kind` (`'vision'`/`'refine'`), `user_id`, `api_key_id`, `model`, `cost_usd`, `latency_ms`, `created_at`, `photo_id`, `detection_id`, `raw_title`. Snippet (kontrakt, od którego zależy endpoint i testy):

```sql
create view public.cost_events
with (security_invoker = true) as
select vr.id, 'vision'::text as kind, vr.user_id, vr.api_key_id, vr.model,
       vr.cost_usd, vr.latency_ms, vr.created_at, vr.photo_id,
       null::uuid as detection_id, null::text as raw_title
from public.vision_runs vr
where vr.status = 'succeeded'
union all
select rc.id, 'refine', rc.user_id, rc.api_key_id, rc.model,
       rc.cost_usd, rc.latency_ms, rc.created_at, rc.photo_id,
       rc.detection_id, d.raw_title
from public.refine_calls rc
left join public.detections d on d.id = rc.detection_id;
```

#### 2. Schema zapytania i DTO

**File**: `src/lib/account/schema.ts`

**Intent**: Zod-walidacja query params endpointu (external I/O) + typy DTO dla island.

**Contract**: `CostEventsQuerySchema` — `key`: uuid | `'none'` | brak (= wszystkie); `type`: `'vision' | 'refine'` | brak; `period`: `'7d' | '30d'` | brak; `page`: int ≥ 1, default 1. Eksport `CostEventDTO` (`kind`, `model`, `cost_usd`, `latency_ms`, `created_at`, `api_key_id`, `photo_id`, `detection_id`, `raw_title`) i `CostEventsResponseDTO` (`items`, `page`, `page_size`, `total_count`, `total_cost_usd`). `z.infer` zgodnie z konwencją.

#### 3. Endpoint listy kosztów

**File**: `src/pages/api/account/costs.ts`

**Intent**: Paginowana lista zdarzeń z `cost_events` + suma kosztów dla aktywnego filtra.

**Contract**: `GET /api/account/costs?key&type&period&page`. 401 przed fetch; zły input → 400 `VALIDATION_ERROR` (Zod). Dwa zapytania do `cost_events` z identycznymi filtrami (`user_id` zawsze; `key` → `eq('api_key_id', uuid)` lub `is('api_key_id', null)` dla `'none'`; `type` → `eq('kind', ...)`; `period` → `gte('created_at', isoZNowMinusX)`): (a) strona — `order('created_at', desc).order('id', desc).range(...)` + `count: 'exact'`, page_size 25; (b) suma — `select('cost_usd')` bez paginacji, suma w JS (wzorzec stats.ts:81). Page poza zakresem → pusta lista (nie błąd). Envelope F-02 (`apiResponse`/`apiError`), `prerender = false`.

#### 4. Unit testy endpointu

**File**: `tests/unit/pages/api/account/costs.test.ts`

**Intent**: Pokrycie kontraktu endpointu na mockach chainable buildera (wzorzec stats.test.ts).

**Contract**: przypadki — 401 bez usera; default (bez filtrów, strona 1); filtr `key=<uuid>`, `key=none` (`is null`), `type`, `period` (sprawdzenie `gte` z poprawną granicą); paginacja (`range(25,49)` dla page=2); `total_cost_usd` liczone z drugiego query z `NULL cost_usd → 0`; 400 na zły `page`/`key`; 500 na błąd DB.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto na lokalnej Supabase: `npx supabase db reset` (WSL)
- Unit testy przechodzą: `npm run test -- costs`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

#### Manual Verification:

- (odroczone do końca Fazy 2 — endpoint bez UI weryfikujemy automatami; user-only test całości po Fazie 2)

---

## Phase 2: `CostAnalysisModal` + wpięcie w AccountIsland + E2E

### Overview

Modal z listą, filtrami, paginacją i sumą; dwa punkty wejścia na /account; ekstrakcja współdzielonych formatterów; pełne E2E.

### Changes Required:

#### 1. Współdzielone formattery kosztów

**File**: `src/lib/costs/format.ts` (nowy) + `src/components/CostPanel.tsx` (konsumpcja)

**Intent**: `formatCost`/`formatLatency`/`formatDate` wyciągnięte z CostPanel do zod-free modułu (lekcja vite-stale-deps), żeby modal nie tworzył drugiej kopii.

**Contract**: czyste funkcje, identyczne sygnatury jak w CostPanel.tsx:34-54; CostPanel importuje zamiast definiować lokalnie. Zero zmian zachowania.

#### 2. Modal analizy kosztów

**File**: `src/components/CostAnalysisModal.tsx` (nowy)

**Intent**: Główny deliverable slice'a — interaktywna lista wywołań z filtrami, paginacją, sumą i drill-downem.

**Contract**: Props: `keys: { id, label }[]` (do dropdownu, z już pobranej listy w AccountIsland), `initialKeyId?: string`, `onClose`. Zachowanie:
- Fetch `GET /api/account/costs` przy otwarciu i każdej zmianie filtra/strony; loading skeleton, error state z retry, empty state („Brak wywołań dla wybranych filtrów").
- Filtry: select klucza (Wszystkie / per label / „Bez przypisania"), segmenty typu (Wszystkie / Vision / OCR), segmenty okresu (Wszystko / 30 dni / 7 dni). Zmiana filtra resetuje stronę na 1.
- Wiersz: ikona+etykieta typu, model, `formatDate(created_at)`, `formatLatency`, `formatCost`, label klucza (lookup po `api_key_id` w `keys`; NULL → „—"), `raw_title` dla OCR jeśli jest, link „Zdjęcie" → `/photos/[photo_id]` gdy `photo_id != null`.
- Footer: „N wywołań · suma $X.XXXX" (z `total_count`/`total_cost_usd`) + paginacja Poprzednia/Następna ze wskaźnikiem strony (`Math.ceil(total_count/page_size)`).
- Modal in-app (wzorzec BookModal): overlay, ESC, klik w tło zamyka; bez `window.confirm`/natywnych okien (konwencja CLAUDE.md).

#### 3. Punkty wejścia w AccountIsland

**File**: `src/components/AccountIsland.tsx`

**Intent**: Sekcja „Koszty analizy" dostaje przycisk „Szczegóły" otwierający modal; chip kosztu przy kluczu staje się buttonem otwierającym modal z prefiltrem na ten klucz.

**Contract**: stan `costModal: { open: boolean; keyId?: string }`; chip (linie ~877–896) zamieniony na `<button>` z zachowanym wyglądem i tooltipem + `aria-label` („Pokaż wywołania wykonane tym kluczem"); modal montowany warunkowo z `keys` mapowanymi z już pobranej listy kluczy.

#### 4. Unit testy modalu

**File**: `tests/unit/components/CostAnalysisModal.test.tsx`

**Intent**: Logika komponentu na mockowanym `fetch` (wzorzec AccountIsland.test.tsx).

**Contract**: render z danymi (wiersze vision + OCR, link Zdjęcie tylko gdy `photo_id`); prefiltr `initialKeyId` trafia do query stringa; zmiana filtra → refetch z poprawnymi params + reset strony; paginacja → `page=2`; empty state; error state; klucz NULL → „—".

#### 5. E2E

**File**: `tests/e2e/account-costs.spec.ts` (nowy)

**Intent**: Pełne scenariusze przepływu na mockowanych route'ach (`page.route` na `/api/account/costs*`, `/api/account/stats`, `/api/account/keys`) — zero realnych wywołań LLM.

**Contract**: scenariusze — (1) otwarcie z przycisku „Szczegóły" i widoczność wierszy; (2) otwarcie z chipa klucza → request zawiera `key=<id>` i select pokazuje label klucza; (3) zmiana filtra typu → refetch z `type=refine`; (4) paginacja Następna → `page=2`; (5) link „Zdjęcie" ma href `/photos/<id>`, wiersz bez `photo_id` nie ma linku; (6) empty state przy pustej odpowiedzi; (7) zamknięcie ESC i klikiem w tło. Lokatory `getByRole`/`getByLabel`, bez `waitForTimeout` (E2E rules, CLAUDE.md).

### Success Criteria:

#### Automated Verification:

- Unit testy przechodzą: `npm run test`
- E2E przechodzi: `npm run test:e2e -- account-costs`
- Pełna suita E2E bez regresów (account, cost-panel): `npm run test:e2e`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Build: `npm run build`

#### Manual Verification:

- Na /account przycisk „Szczegóły" otwiera modal z realnymi danymi (prod DB po ręcznej aplikacji 0021 LUB lokalna Supabase — decyzja usera, precedens M27)
- Chip przy kluczu „Anthropic" otwiera modal prefiltrowny — widać 26 zbackfillowanych wywołań ($0.8801 łącznie)
- Filtry i paginacja działają płynnie; suma w footerze zgadza się z chipem przy pełnym zakresie
- Link „Zdjęcie" prowadzi do działającej strony zdjęcia; wywołania po usuniętych zdjęciach nie mają linku

**Implementation Note**: Po Fazie 2 i zielonych automatach — pauza na manualną weryfikację user-only przed `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- Endpoint: filtry (key/none/type/period), paginacja, suma, walidacja, błędy (Faza 1 #4)
- Modal: render, prefiltr, refetch na zmianę filtra, stany loading/empty/error (Faza 2 #4)

### Integration Tests:

- Brak nowych — RLS widoku dziedziczy z tabel pokrytych w `tests/integration/`; widok waliduje `db reset` + job e2e w CI (efemeryczna Supabase)

### Manual Testing Steps:

1. /account → „Szczegóły" → przejrzyj listę, zweryfikuj sumę vs chip
2. Chip klucza → prefiltr; przełącz na „Bez przypisania" → historyczne wywołania
3. Filtr okresu 7d → tylko świeże wywołania; paginacja przy >25 wierszach
4. Klik „Zdjęcie" → strona zdjęcia

## Performance Considerations

Suma dla filtra pobiera wszystkie `cost_usd` pasujące do filtra (bez paginacji) — identyczny koszt jak istniejący stats.ts; przy skali osobistej (tysiące wierszy) bez znaczenia. Indeksy `*_api_key_id_idx` (0020) i PK pokrywają filtry. Widok UNION ALL bez materializacji — koszt zapytania ~suma dwóch skanów po `user_id` (indeksy z 0015/0012).

## Migration Notes

0021 jest czysto addytywna (CREATE VIEW) — zero ryzyka dla istniejących danych; `db push` po merge aplikuje automatycznie. Rollback = `drop view cost_events`.

## References

- Roadmap: `context/foundation/roadmap.md` S-41 (linia 522)
- Substrat M27: `context/archive/2026-06-07-uwagi-round3/change.md`
- Wzorzec endpointu: `src/pages/api/account/stats.ts`
- Wzorzec modalu: `src/components/BookModal.tsx`
- Wzorzec testów: `tests/unit/pages/api/account/stats.test.ts`, `tests/e2e/cost-panel.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Widok cost_events + GET /api/account/costs

#### Automated

- [ ] 1.1 Migracja aplikuje się czysto: `npx supabase db reset`
- [ ] 1.2 Unit testy endpointu przechodzą: `npm run test -- costs`
- [ ] 1.3 Typecheck: `npm run typecheck`
- [ ] 1.4 Lint: `npm run lint`

### Phase 2: CostAnalysisModal + AccountIsland + E2E

#### Automated

- [ ] 2.1 Unit testy przechodzą: `npm run test`
- [ ] 2.2 E2E account-costs przechodzi: `npm run test:e2e -- account-costs`
- [ ] 2.3 Pełna suita E2E bez regresów: `npm run test:e2e`
- [ ] 2.4 Typecheck: `npm run typecheck`
- [ ] 2.5 Lint: `npm run lint`
- [ ] 2.6 Build: `npm run build`

#### Manual

- [ ] 2.7 Modal z „Szczegóły" pokazuje realne dane; suma zgodna z chipem
- [ ] 2.8 Chip klucza otwiera modal z prefiltrem (26 wywołań Anthropic)
- [ ] 2.9 Filtry/paginacja/link „Zdjęcie" działają na realnych danych
