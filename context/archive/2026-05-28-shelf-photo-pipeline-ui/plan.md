# Shelf photo pipeline UI — Implementation Plan

## Overview

Zastępujemy „ślepą rurę" upload→auto-process→auto-match→redirect transparentnym modelem pipeline'u z **manualnymi triggerami per stage** i **append-only versioningiem vision runs**. Użytkownik wchodzi w `/shelves/[id]`, widzi listę swoich zdjęć z odczytywalnymi statusami (uploaded / vision_done / match_done / confirmed), miniaturkami i przyciskami do uruchomienia/ponowienia każdego kroku osobno. Vision-runs są historyczne: ponowne uruchomienie wizji nie kasuje detekcji z poprzedniego runa — to otwiera drogę do porównań modeli, naprawy zepsutej generacji i agregacji wyników (na razie scope MVP = „pokaż latest succeeded run; historia zostaje w DB").

## Current State Analysis

- `/upload` (src/pages/upload.astro:14) renderuje `PhotoUploader` (src/components/PhotoUploader.tsx) który po wyborze pliku automatycznie wykonuje łańcuch: Supabase Storage upload → `POST /api/photos` → `POST /api/photos/[id]/process` → `POST /api/photos/[id]/match` → `window.location.href = '/photos/[id]'`. Przed dzisiejszą zmianą (PhotoUploader.tsx:48) `handleRetry` zawsze powtarzał cały łańcuch; teraz flaga `canRetryMatchOnly` pozwala retry tylko match, ale to wciąż jednorazowa sesja w ramach jednego uploadu — po reloadzie strony cała kontrola znika.
- `POST /api/photos/[id]/process` (src/pages/api/photos/[id]/process.ts:138) robi `DELETE FROM detections WHERE photo_id = $id` przed insertem — re-process nadpisuje historię.
- `POST /api/photos/[id]/match` (src/pages/api/photos/[id]/match.ts:121-126) iteruje po wszystkich `detections WHERE photo_id = $id AND status != 'rejected'` — nie ma pojęcia „bieżącego vision_runa".
- `GET /api/photos/[id]` (src/pages/api/photos/[id].ts:38) zwraca jedno zdjęcie + listę detekcji + kandydatów. **Brak** endpointu `GET /api/shelves/[id]/photos` — `/shelves` (src/pages/shelves.astro + ShelvesIsland.tsx) pokazuje tylko CRUD półek, nie ich zawartości fotograficznej.
- `/photos/[id]` (src/pages/photos/[id].astro) renderuje `DetectionReview` — read-only widok dopasowań bez przycisków akcji.
- DB schema (supabase/migrations/0001_initial_schema.sql:26-58):
  - `photos.status` ∈ `uploaded|processing|processed|failed` (CHECK constraint)
  - `photos.vision_model`, `vision_cost_usd`, `vision_latency_ms`, `error_message` — pola metryk per **ostatni** run (po dzisiejszej zmianie staną się cache'em ostatniego succeeded runa).
  - `detections.photo_id` FK ON DELETE CASCADE; brak pojęcia run.
  - `book_candidates.detection_id` FK ON DELETE CASCADE.
- Roadmap S-14 `photo-process-reload-recovery` i S-15 `review-page-nav-entry` (oba `proposed`) są **wchłonięte** przez tę zmianę — recovery jest naturalną konsekwencją per-stage przycisków na liście, navigation entry to `ShelfListItem → /shelves/[id]`. Po archive obie pozycje w roadmap.md zaktualizować na `done` z notą supersession.

## Desired End State

- Użytkownik wchodzi na `/shelves/[id]` (link z `ShelfListItem` w `/shelves`) i widzi **listę swoich zdjęć tej półki** w odwrotnej kolejności chronologicznej. Każdy wiersz ma: miniaturkę (signed URL z Storage), badge bieżącego stage'a (4 kolory), liczniki (`X wykryto · Y dopasowano · Z zatwierdzono`), i 1-3 przyciski akcji odpowiednie dla stage'a.
- Klikając „Uruchom vision" / „Ponów vision (nowy run)" / „Uruchom match" / „Ponów match" / „Otwórz review" użytkownik wywołuje konkretny krok pipeline'u; status wiersza odświeża się in-place po sukcesie (refetch listy) bez nawigacji.
- Wszystkie poprzednie vision-runy zostają w DB; UI pokazuje detekcje z **najnowszego succeeded run** (`latest succeeded vision_run for photo`). Historic runs są dostępne przez schemę DB (UI do przeglądu historii — out of scope, follow-up).
- Concurrent `POST /process` na tym samym `photo_id` (np. double-click, dwa taby) → DB trigger blokuje drugi insert do `vision_runs` jeśli istnieje running run młodszy niż 5 minut; endpoint zwraca **409 CONFLICT** (`ApiErrorCode` rozszerzony). Stuck running runs (>5 min) są przeźroczyste — kolejny click działa.
- `/upload` zachowuje istniejące auto-run zachowanie (zero regression dla golden path); jeśli po `/process` lub `/match` poleci błąd, UI pokazuje co się stało i kieruje do `/shelves/[id]` zamiast porzucać użytkownika w ślepym `/upload`.
- Verify: po reloadzie `/shelves/[id]` użytkownik widzi prawdziwy stan każdego zdjęcia (status + liczniki) — nic nie znika z UI bo zostało w stanie sesji. Manualnie wywołane retry dowozi recovery z dowolnego stanu (uploaded, failed, processed-without-matches).

### Key Discoveries:

- DB trigger pattern dla domain invariants jest już ustalony w projekcie: `handle_new_user` (migration 0003), `prevent_zakupione_delete/rename` (migration 0004). Konwencja: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `RAISE EXCEPTION ... USING errcode = 'P0001'`, mapping w endpointach P0001 → 400/409 z `error.message` verbatim (CLAUDE.md § Supabase + § API endpoints).
- `ApiErrorCode` union (src/lib/http/response.ts) jest single source of truth dla envelope'u; rozszerzanie unii świadomie odsunięte do per-slice need (CLAUDE.md). Slice S-04 nie potrzebował CONFLICT; ten potrzebuje — dorzucamy `RATE_LIMITED`-style: `CONFLICT` z domyślnym status 409.
- Supabase Storage ma `createSignedUrls(paths[], expiresIn)` batch API — można jednym callem wygenerować URL'e dla wszystkich miniaturek na liście. TTL = 1h dla MVP (lista odświeża się przy każdym render).
- Generated artifacts: migracja zmienia schemat, więc `src/lib/db/database.types.ts` wymaga regeneracji (`npx supabase gen types typescript --linked --schema public > src/lib/db/database.types.ts`). Plik jest w `eslint.config.mjs` ignores (lessons.md § generated artifacts).
- Astro dynamic page `/shelves/[id]` wymaga `export const prerender = false` (jak `/photos/[id]`).

## What We're NOT Doing

- **UI do przeglądu historii vision-runów per photo** — schemat to wspiera (`vision_runs` + `vision_run_id` FK), ale UI default pokazuje tylko latest succeeded. Side-by-side compare / merge runs to follow-up slice (po S-05).
- **`match_runs` table** — `book_candidates` zostaje per-detection delete-then-insert (jak teraz). Google Books jest tani; pełna audytowalność match'y nie warta migracji w tym slice.
- **Auto-reaper stuck runs** — UI pokazuje status, user klika „Ponów". Trigger ma 5-minutowy window dla concurrency check, ale nie ma background joba czyszczącego stale `running`.
- **`vision_run_id` query param na `GET /api/photos/[id]`** — endpoint zawsze wybiera latest succeeded. Selekcja konkretnego runa to follow-up.
- **Drop kolumn `photos.vision_model` / `vision_cost_usd` / `vision_latency_ms` / `error_message`** — pozostają jako cache najnowszego succeeded run dla backward-compat (PhotoDTO consumer'y w S-04 UI). Dropping = osobny refactor.
- **Auto-toggle „run automatycznie po uploadzie"** — `/upload` zachowuje obecne zachowanie, manual triggery żyją w `/shelves/[id]`.
- **Inline confirm detections (S-05)** — zatwierdzanie detekcji do katalogu (`detections.status = 'confirmed'` + INSERT books + shelf_entries) to S-05. Tutaj badge `confirmed` dla 4. stage to **derived from existing `detections.status='confirmed'` count** (≥1 → stage 4); akcja confirm jeszcze nie istnieje.
- **Real-time updates** — refetch po akcji lub manualny reload; brak SSE/WebSocket.

## Implementation Approach

Trzy atomic phases, każda testowalna osobno i commit'owalna jako oddzielny krok. Po Phase 1 (DB) test suite musi przejść z aktualnym kodem (FK z domyślnym vision_run_id po backfill nie psuje istniejących callów). Po Phase 2 (API) dotychczasowy `/upload` flow musi nadal działać end-to-end (auto-run łańcuch przechodzi przez zmieniony `/process` i `/match`). Phase 3 dodaje nowy widok bez ruszania `/upload`.

State machine — 4 stages w UI, derived ze stanu DB:

| Stage | Warunek (per photo) | Akcje na liście |
|---|---|---|
| `uploaded` | brak `vision_runs` LUB tylko `failed` runs | „Uruchom vision" |
| `vision_done` | ≥1 `succeeded` vision_run, **0** book_candidates dla detections latest run | „Uruchom match", „Ponów vision (nowy run)", „Otwórz review" |
| `match_done` | ≥1 `succeeded` vision_run, ≥1 detection latest run ma book_candidates, **0** detections ze statusem `confirmed` | „Ponów match", „Ponów vision (nowy run)", „Otwórz review" |
| `confirmed` | ≥1 detection latest run ze statusem `confirmed` | „Ponów match", „Ponów vision (nowy run)", „Otwórz review" |

Transient state `processing` (vision run w toku) pokazywany jako spinning badge przed `vision_done`/`failed`. Frontend nie pollinguje — refetch listy po akcji wystarcza (vision call jest sync, <30s).

## Critical Implementation Details

- **Trigger concurrency window**: trigger `prevent_concurrent_vision_run` blokuje INSERT gdy istnieje row dla `photo_id` ze `status='running'` AND `created_at > now() - interval '5 minutes'`. Po 5 minutach stary running run jest uważany za stuck — kolejny click nie blokuje się. Wartość 5 min: CF Workers Paid CPU limit to 30s, Anthropic timeout dochodzi do 60s, margin bezpieczeństwa 5x.
- **Backfill kolejność**: w migration 0006 najpierw `CREATE TABLE vision_runs`, potem `INSERT INTO vision_runs ... FROM photos WHERE EXISTS detections` (jeden synthetic run per photo z metadanymi z `photos.vision_*`), potem `ALTER TABLE detections ADD COLUMN vision_run_id ... NULL`, potem `UPDATE detections SET vision_run_id = ...`, potem `ALTER TABLE detections ALTER COLUMN vision_run_id SET NOT NULL` + FK. Jeśli któryś krok poleci na produkcji z istniejącymi danymi (Dev DB tester ma jeden uploaded photo z dzisiejszej sesji vision-debugging), backfill musi to obsłużyć.
- **Signed URL TTL**: 1h dla thumbnails w liście. Storage `createSignedUrls(paths, 3600)` batch. Po godzinie reload listy regeneruje URL'e — akceptowalne dla MVP.

---

## Phase 1: DB foundations — vision_runs table + RLS + trigger + backfill

### Overview

Nowa migracja Supabase `0007_vision_runs.sql` (numer `0006` zajęty przez `0006_detection_bbox.sql` ze slice'a external-match-and-proposals) wprowadza tabelę `vision_runs`, FK `detections.vision_run_id`, RLS policy, trigger blokujący concurrent runs, oraz backfill istniejących detections (synthetic vision_run per photo z metadanymi z `photos.vision_*`).

### Changes Required:

#### 1. Migration 0007_vision_runs.sql

**File**: `supabase/migrations/0007_vision_runs.sql`

**Intent**: Wprowadzić wersjonowanie vision runs — każde wywołanie `/process` tworzy nowy wiersz `vision_runs`; detections są na zawsze przypięte do swojego runa. Trigger `prevent_concurrent_vision_run` zapobiega podwójnym kliknięciom. Backfill istniejących detections (z aktualnej Dev DB i z przyszłych prod migracji — tabela `photos` z `vision_model != null` musi zostać zmapowana na synthetic running w stanie `succeeded`).

**Contract**:
- Tabela `vision_runs` z kolumnami: `id uuid PK`, `photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE`, `model text`, `prompt_version text`, `status text NOT NULL CHECK (status IN ('running','succeeded','failed'))`, `cost_usd numeric(10,6)`, `latency_ms int`, `error_message text`, `created_at timestamptz NOT NULL DEFAULT now()`, `completed_at timestamptz`.
- Index: `vision_runs_photo_id_status_idx ON vision_runs(photo_id, status, created_at DESC)` — wspiera „latest succeeded for photo" i concurrency check.
- RLS policies (wzór: migration 0002 § detections): wszystkie **4 operacje** (SELECT, INSERT, UPDATE, DELETE) używają tego samego predykatu:
  `EXISTS (SELECT 1 FROM photos WHERE photos.id = vision_runs.photo_id AND photos.user_id = auth.uid())`.
  Konkretnie: `enable row level security`, potem `create policy "vision_runs_select_own" ... for select using (<exists>)`, `... for insert with check (<exists>)`, `... for update using (<exists>) with check (<exists>)`, `... for delete using (<exists>)`. Per CLAUDE.md § Supabase + lessons.md § Load-bearing convention detail — kompletne 4 operacje są obowiązkowe nawet gdy w MVP user-facing DELETE nie istnieje (CASCADE z `photos` zadziała; policy DELETE zachowuje spójność audit).
- `ALTER TABLE detections ADD COLUMN vision_run_id uuid REFERENCES vision_runs(id) ON DELETE CASCADE` (initially NULL).
- Backfill: dla każdego `photos` mającego **≥1 detection** (`EXISTS (SELECT 1 FROM detections WHERE photo_id = p.id)`), `INSERT INTO vision_runs (photo_id, model, status, cost_usd, latency_ms, created_at, completed_at) SELECT p.id, p.vision_model, 'succeeded', p.vision_cost_usd, p.vision_latency_ms, COALESCE(p.processed_at, p.created_at), p.processed_at FROM photos p WHERE EXISTS (SELECT 1 FROM detections WHERE photo_id = p.id)`. Potem `UPDATE detections d SET vision_run_id = (SELECT id FROM vision_runs WHERE photo_id = d.photo_id LIMIT 1)`. Świadomie pomijamy photos z `vision_model IS NOT NULL` ale `detected_count = 0`: synthetic `succeeded` run z 0 detections wprowadziłby fake stage='vision_done' z pustą listą review (zob. F3 plan-review).
- Po backfillu: `ALTER TABLE detections ALTER COLUMN vision_run_id SET NOT NULL`.
- Trigger `prevent_concurrent_vision_run BEFORE INSERT ON vision_runs FOR EACH ROW EXECUTE FUNCTION ...` — funkcja `SECURITY DEFINER`, `SET search_path = public, pg_temp`; sprawdza `EXISTS (SELECT 1 FROM vision_runs WHERE photo_id = NEW.photo_id AND status = 'running' AND created_at > now() - interval '5 minutes')`; jeśli tak → `RAISE EXCEPTION 'Vision run already in progress for this photo. Try again in a moment.' USING errcode = 'P0001'`.

Snippet trigger (signature contract — referencowany przez Phase 2 P0001 catch path):

```sql
create or replace function public.prevent_concurrent_vision_run()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'running' and exists (
    select 1 from public.vision_runs
    where photo_id = new.photo_id
      and status = 'running'
      and created_at > now() - interval '5 minutes'
  ) then
    raise exception 'Vision run already in progress for this photo. Try again in a moment.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Idempotency: drop trigger if exists przed create — zgodne z patternem 0003/0004 (replay safety)
drop trigger if exists vision_runs_prevent_concurrent on public.vision_runs;
create trigger vision_runs_prevent_concurrent
  before insert on public.vision_runs
  for each row execute function public.prevent_concurrent_vision_run();
```

#### 2. Regenerate database types

**File**: `src/lib/db/database.types.ts`

**Intent**: Po migration apply lokalnie regeneracja typów daje TS dostęp do `vision_runs` i nowej kolumny `detections.vision_run_id`.

**Contract**: `npx supabase gen types typescript --linked --schema public > src/lib/db/database.types.ts`. Plik jest w `eslint.config.mjs` ignores (lessons.md). Po regeneracji `npm run typecheck` musi przejść bez zmian w kodzie aplikacji — istniejące typy `Database['public']['Tables']['detections']` zyskają `vision_run_id`, ale konsument'y w S-04 (`detections insert`) operują na obiektach literalnych; pole nowe jest wymagane → Phase 2 doda je do insert payload.

### Success Criteria:

#### Automated Verification:

- Migration aplikuje się czysto przeciwko świeżej DB: `npx supabase db push` (po merge do main; w branchu test lokalny `psql -f supabase/migrations/0007_vision_runs.sql` na shadow DB lub Vitest integration mock).
- Typecheck pass: `npm run typecheck`.
- Lint pass: `npm run lint`.
- Vitest pass: `npm run test` (Phase 1 nie zmienia testów, ale regen typów nie może niczego zepsuć).
- `database.types.ts` zawiera typ `vision_runs` Tables row.

#### Manual Verification:

- W Supabase Studio: `select * from vision_runs` zwraca ≥1 wiersz dla każdego photo z dzisiejszej sesji (backfill).
- `select count(*) from detections where vision_run_id is null` = 0.
- Próba `insert into vision_runs (photo_id, status) values ('<id>', 'running')` dwukrotnie pod rząd dla tego samego photo zwraca błąd P0001 z trigger'a (drugi INSERT).
- RLS isolation: zalogowany user A nie widzi `vision_runs` user'a B (Studio z anon JWT user A).

**Implementation Note**: Po Phase 1 zatrzymaj i poczekaj na potwierdzenie ręcznej weryfikacji w Supabase Studio przed Phase 2 (migracja jest nieodwracalna; jeśli backfill nie domknął się, Phase 2 padnie na NOT NULL).

---

## Phase 2: API — versioned /process, run-scoped /match, list-by-shelf endpoint, CONFLICT code

### Overview

`/api/photos/[id]/process` przestaje delete-by-photo_id, tworzy nowy `vision_runs(status=running)`, na sukces insertuje detections z `vision_run_id`, na koniec ustawia `vision_runs.status='succeeded'` + cache w `photos`. `/api/photos/[id]/match` operuje tylko na detections najnowszego succeeded run. Nowy endpoint `GET /api/shelves/[id]/photos` zwraca listę z metadanymi do renderowania PhotoListItem (status, liczniki, signed URL thumbnaila). `ApiErrorCode` zyskuje `CONFLICT` dla mapping P0001 → 409.

### Changes Required:

#### 1. Rozszerz `ApiErrorCode` union

**File**: `src/lib/http/response.ts`

**Intent**: Dorzucić `CONFLICT` jako stabilny code dla rezerwacji optymistycznej / blokady DB trigger'a. Per CLAUDE.md § API endpoints — rozszerzamy unię gdy realny consumer pojawi się; pojawił się tu.

**Contract**: `type ApiErrorCode = 'UNAUTHENTICATED' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'INTERNAL_ERROR' | 'RATE_LIMITED' | 'CONFLICT'`. Default `status: 409` dla `CONFLICT` w jakimkolwiek helperze (lub explicit `status: 409` przy każdym `apiError({ code: 'CONFLICT' })`).

#### 2. Versioned `/api/photos/[id]/process`

**File**: `src/pages/api/photos/[id]/process.ts`

**Intent**: Każdy call tworzy nowy `vision_runs` row; jeśli trigger zablokuje (P0001) → 409 CONFLICT z wiadomością z trigger'a. Nie usuwamy historic detections. Na sukces: insert detections z `vision_run_id`, update vision_runs (succeeded, cost, latency, completed_at), update `photos` (status=processed, cache metryk, detected_count = liczba detections **z tego runa**). Na vision rate limit (429/529): vision_runs.status='failed' + error_message, photo.status zostaje (nie ruszamy go jeśli istnieje wcześniejszy succeeded run; jeśli to był pierwszy run → 'uploaded' jak teraz). Na parse_failure: vision_runs.status='failed', photo.status='failed', INSERT corrections (jak teraz).

**Contract**:
- Wczytuj photo, sprawdz RLS (PGRST116 → 404).
- **Nie** `UPDATE photos SET status='processing'` — `photos.status` przestaje być trackerem in-flight; rolę przejął `vision_runs.status='running'`. Zostaw `photos.status` jako cache końcowego stanu (najnowszy succeeded run → 'processed'; failed → 'failed' jeśli brak prior succeeded; uploaded → init).
- `INSERT INTO vision_runs (photo_id, model, prompt_version, status) VALUES (id, 'claude-sonnet-4-6', '<PROMPT_VERSION const>', 'running') RETURNING id` — jeśli PostgrestError code === 'P0001' → `apiError({ code: 'CONFLICT', status: 409, message: <trigger message verbatim> })`.
- Download blob, photon resize, base64 (bez zmian).
- `detectSpines` (bez zmian); na exception 429/529 → `UPDATE vision_runs SET status='failed', error_message, completed_at=now() WHERE id=<run_id>`; respond 429 RATE_LIMITED.
- Na sukces vision: `INSERT INTO detections (photo_id, vision_run_id, ...)` (dodajemy nową kolumnę do payload). Na insert fail → `UPDATE vision_runs SET status='failed', error_message WHERE id=<run_id>`; respond 500.
- `UPDATE vision_runs SET status='succeeded', cost_usd, latency_ms, completed_at = now() WHERE id=<run_id>`.
- `UPDATE photos SET status='processed', vision_model, vision_cost_usd, vision_latency_ms, detected_count = <count z tego runa>, processed_at = now(), error_message = null WHERE id=<photo_id>`.
- GET-style response (re-fetch): zwracaj detections **tego nowego runa** (filter by `vision_run_id = <run_id>`).

#### 3. Run-scoped `/api/photos/[id]/match`

**File**: `src/pages/api/photos/[id]/match.ts`

**Intent**: Operuj wyłącznie na detections z **najnowszego succeeded vision_run** dla tego photo. Reszta logiki (Google Books, OL, scoring, dedupe, per-detection delete-then-insert book_candidates) bez zmian.

**Contract**: Zamiast `from('detections').select(...).eq('photo_id', id).neq('status', 'rejected')` użyj subquery / 2-step: najpierw `SELECT id FROM vision_runs WHERE photo_id=$1 AND status='succeeded' ORDER BY created_at DESC LIMIT 1` (RLS scoped); jeśli brak → 404 (nie ma czego match'ować). Potem `SELECT ... FROM detections WHERE vision_run_id = <latest_run_id> AND status != 'rejected'`. Reszta ścieżki identyczna. Idempotent `DELETE FROM book_candidates WHERE detection_id = <det_id>` per detection bez zmian.

#### 4. Latest-run-aware `GET /api/photos/[id]`

**File**: `src/pages/api/photos/[id].ts`

**Intent**: Default view = latest succeeded vision_run; gdy brak żadnego succeeded run → pusta lista detections + `photo.status` zwracany jako jest.

**Contract**: Po `select photos` dodaj `select id from vision_runs where photo_id=$1 and status='succeeded' order by created_at desc limit 1`. Jeśli brak → respond `{ photo, detections: [] }`. Jeśli jest — query detections `where vision_run_id = <run_id>` (zamiast `where photo_id = id`). Reszta (candidates, duplicate check) bez zmian. Dorzuć do response opcjonalne `vision_run` metadata: `{ id, model, created_at, cost_usd, latency_ms }` (rozszerz `DetectionResponseData` / dodaj nowe pole w response).

#### 5. NEW: `GET /api/shelves/[id]/photos`

**File**: `src/pages/api/shelves/[id]/photos.ts` (nowy plik; trzeba utworzyć katalog `[id]/`)

**Intent**: Lista zdjęć danej półki z metadanymi do renderowania `PhotoListItem`. Każdy wpis zawiera: photo info, derived stage (jeden z 4), liczniki (detected, matched, confirmed), latest vision_run metadata (model, created_at), thumbnail signed URL.

**Contract**:
- `export const prerender = false`.
- Auth guard (401 jeśli brak `locals.user`).
- `parseUuidParam(params.id)` → 404 jeśli zniekształcony.
- Verify shelf ownership: `SELECT id FROM shelves WHERE id=$1` (RLS scope; PGRST116 → 404).
- Query: `SELECT p.id, p.storage_path, p.status, p.created_at FROM photos WHERE shelf_id=$1 ORDER BY created_at DESC` (RLS już ogranicza do user_id).
- Dla każdego photo:
  - Latest succeeded vision_run: `SELECT id, model, created_at, cost_usd FROM vision_runs WHERE photo_id=$1 AND status='succeeded' ORDER BY created_at DESC LIMIT 1`. (Batch: jedno query z `WHERE photo_id = ANY($1)` + DISTINCT ON, albo per-photo subquery — preferowane DISTINCT ON ze względu na ≤30 zdjęć per półka w MVP).
  - Czy istnieje running vision_run (młodszy niż 5 min): `SELECT photo_id FROM vision_runs WHERE photo_id = ANY($1) AND status='running' AND created_at > now() - interval '5 minutes'` (Set lookup).
  - Detection counts dla latest run (batch: `SELECT vision_run_id, count(*), count(*) filter (where ... book_candidates_count > 0), count(*) filter (where status='confirmed') FROM detections JOIN book_candidates ON ... GROUP BY vision_run_id`). Konkretnie chcemy 3 liczniki: `detected_count`, `matched_count` (detections w tym runie które mają ≥1 book_candidate), `confirmed_count` (detections w tym runie ze `status='confirmed'`). Implementuj jednym agregującym query po `vision_run_id IN (...)` lub trzech sub-queries — wybierz formę czytelną.
- Stage derivation (per CLAUDE.md plan §state machine table):
  - `latest_succeeded_run_id IS NULL && running_run_present` → stage `processing` (transient badge)
  - `latest_succeeded_run_id IS NULL && NOT running_run_present` → `uploaded` (nawet jeśli były failed runy)
  - `latest_succeeded_run_id IS NOT NULL && matched_count == 0` → `vision_done`
  - `latest_succeeded_run_id IS NOT NULL && matched_count > 0 && confirmed_count == 0` → `match_done`
  - `latest_succeeded_run_id IS NOT NULL && confirmed_count > 0` → `confirmed`
- Thumbnails: batch `supabase.storage.from('shelf-photos').createSignedUrls(storage_paths, 3600)`. Map result back per photo.
- Response shape: `{ data: { photos: PhotoListItemDTO[] } }` gdzie `PhotoListItemDTO = { id, status, stage, created_at, thumbnail_url, detected_count, matched_count, confirmed_count, latest_vision_run: { id, model, created_at, cost_usd } | null, has_running_run: boolean }`.
- Cache header: `private, no-store` (z `apiResponse` defaultów).

#### 6. Update `src/lib/vision/AGENTS.md` — versioning rule

**File**: `src/lib/vision/AGENTS.md`

**Intent**: Aktualne `AGENTS.md:13` ma bullet „Idempotencja: re-process = delete-then-insert per `photo_id` (nie duplikować)" — po tym slice zasada jest fałszywa i sprzeczna z append-only versioning. Per lessons.md § „Onboarding docs (CLAUDE.md + AGENTS.md) dryfują niezależnie" — aktualizacja musi pójść w tym samym commit'cie co zmiana kodu, inaczej przyszły agent dostanie sprzeczną instrukcję.

**Contract**: Zastąpić bullet „Idempotencja" nowym: „Wersjonowanie vision: każde wywołanie `/process` tworzy nowy `vision_runs` row; detections są pisane z `vision_run_id`. Nigdy nie kasujemy historic detections z innych runów. UI default pokazuje detekcje z najnowszego succeeded run." Dodać też bullet o concurrency: „Trigger `vision_runs_prevent_concurrent` blokuje INSERT vision_runs(running) gdy istnieje running run < 5 min dla tego samego photo_id; endpoint mapuje P0001 → 409 CONFLICT."

#### 7. PhotoListItemDTO schema

**File**: `src/lib/photos/schema.ts`

**Intent**: Type-safe DTO współdzielony przez backend (response constructor) i UI (PhotoListIsland).

**Contract**: Nowy export `type PhotoListItemDTO = { id: string; status: string; stage: 'uploaded' | 'processing' | 'vision_done' | 'match_done' | 'confirmed'; created_at: string; thumbnail_url: string | null; detected_count: number; matched_count: number; confirmed_count: number; latest_vision_run: { id: string; model: string | null; created_at: string; cost_usd: number | null } | null; has_running_run: boolean }`. Nowy export `type ShelfPhotosResponse = { photos: PhotoListItemDTO[] }`.

### Success Criteria:

#### Automated Verification:

- Typecheck pass: `npm run typecheck`.
- Lint pass: `npm run lint`.
- Vitest pass: `npm run test` — istniejące testy `tests/unit/pages/api/photos/**` (jeśli są) muszą zostać zaktualizowane aby uwzględnić nowy DB shape; nowy test plik `tests/unit/pages/api/shelves/photos.test.ts` pokrywa: 401 dla anon, 404 dla nieistniejącej półki, 404 dla bad UUID, sukces z mock'owanymi photos + stage derivation dla 4 wariantów (uploaded/vision_done/match_done/confirmed).
- Nowy test pliku `tests/unit/pages/api/photos/process.test.ts` (lub augmentacja istniejącego): 409 CONFLICT gdy mock supabase insert do `vision_runs` zwraca `{ code: 'P0001', message: '...' }`.
- Match endpoint test: po mock'owanym 2 succeeded runs dla tego samego photo, match operuje TYLKO na detections najnowszego runa (assertion na liczbie call'i Google Books).

#### Manual Verification:

- `curl POST /api/photos/<id>/process` z prawidłowym JWT — drugi call w ciągu 1s zwraca 409 z `error.code='CONFLICT'`, `error.message` z trigger'a (Polish).
- Po sukcesie `/process` w Supabase Studio: `vision_runs` ma nowy wiersz `status='succeeded'`, `detections.vision_run_id` wszystkie wskazują na ten run.
- Ponowny `/process` na tym samym photo (po 1 minucie, żeby nie konfliktować z trigger): nowy wiersz w `vision_runs`, **stare detections zostają w DB** (`select count(*) from detections where photo_id=<id>` rośnie), latest succeeded run zwraca tylko nowe detections.
- `curl GET /api/shelves/<shelf_id>/photos` zwraca listę z poprawnym stage per photo + ważne signed URL thumbnaila (otwórz w przeglądarce, obraz się ładuje).

**Implementation Note**: Po Phase 2 zatrzymaj i poczekaj na potwierdzenie ręcznego curl testu (golden path + concurrent conflict) przed Phase 3. Backend musi działać przed UI.

---

## Phase 3: UI — /shelves/[id] page + PhotoListIsland + augmented DetectionReview + nawigacja

### Overview

Nowa strona `/shelves/[id].astro` renderuje `PhotoListIsland` — React komponent fetchujący `/api/shelves/[id]/photos` i renderujący wiersze z stage badge, miniaturkami, licznikami i przyciskami akcji per stage. `DetectionReview` zyskuje badge bieżącego vision_run + inline przyciski „Ponów vision (nowy run)" / „Ponów match". `ShelfListItem` w `/shelves` dostaje link „Zobacz zdjęcia →" prowadzący do `/shelves/[id]`. `PhotoUploader` bez zmian zachowania — opcjonalnie redirect po sukcesie zmieniony na `/shelves/[shelf_id]` zamiast `/photos/[id]` (decyzja w trakcie implementacji: zostaw bieżący redirect i dodaj „Wszystkie zdjęcia tej półki →" link z `/photos/[id]`).

### Changes Required:

#### 1. Astro page `/shelves/[id].astro`

**File**: `src/pages/shelves/[id].astro`

**Intent**: Server-side guard auth + render React island z `shelfId` i `shelfName` props. Layout konsystentny z `/shelves` i `/photos/[id]`.

**Contract**: `export const prerender = false`. `if (!Astro.locals.user) return Astro.redirect('/login')`. Wczytaj shelf name dla title page (jedna query `select name from shelves where id=$1` przez `Astro.locals.supabase`). 404 redirect przy bad UUID / brak shelf. Render `<Layout title={`Zdjęcia: ${shelf.name}`}>` z breadcrumbs „Moje półki → {shelf.name}" + `<PhotoListIsland client:load shelfId={id} shelfName={shelf.name} />`. Link do `/upload?shelf=<id>` jako CTA „+ Dodaj zdjęcie".

#### 2. `PhotoListIsland` component

**File**: `src/components/PhotoListIsland.tsx` (nowy)

**Intent**: Fetch + render listy z stage-aware kontrolami. Refetch po każdej akcji (process / match / re-run). Per-row state ('idle' / 'processing' / 'matching' / 'error') do disable przycisków + spinning.

**Contract**:
- Props: `{ shelfId: string; shelfName: string }`.
- Effect: fetch `/api/shelves/[shelfId]/photos`, set state `photos: PhotoListItemDTO[]`, `loading`, `error`.
- Per-row akcje:
  - `Run vision` (gdy stage='uploaded'): `POST /api/photos/[id]/process` → on success refetch listy. On 409 CONFLICT → toast „Run już w toku, poczekaj chwilę". On 429 → toast „Vision rate limit".
  - `Re-run vision (nowy run)` (gdy stage='vision_done'/'match_done'/'confirmed'): confirm modal („Uruchomimy nowy vision run. Poprzednie wyniki zostaną w historii. Koszt: ~$0.01 + ~10s. OK?"); na potwierdzeniu — ten sam POST `/process`. Modal jednolinijkowy `window.confirm` dla MVP (bez dedykowanego dialog component'u — YAGNI).
  - `Run match` (gdy stage='vision_done'): `POST /api/photos/[id]/match` → refetch. Toast na 429.
  - `Re-run match` (gdy stage='match_done'/'confirmed'): ten sam POST (idempotent per detection).
  - `Otwórz review` (gdy stage='vision_done'+): link do `/photos/[id]`.
- Stage badge: 4 kolory (uploaded = gray, processing = blue spinning, vision_done = amber, match_done = blue, confirmed = green) + tekst etykiety po polsku („Wgrane" / „Vision w toku" / „Wykryte" / „Dopasowane" / „Zatwierdzone").
- Thumbnail: `<img src={thumbnail_url} className="h-16 w-16 object-cover rounded" />` z fallback gdy `thumbnail_url === null`.
- Liczniki: `{detected_count} wykryto · {matched_count} dopasowano · {confirmed_count} zatwierdzono`.
- Metadane vision_run: small text „Run #N · {model} · {czas}" dla najnowszego succeeded (N derive'owane client-side z indexu w historii — out of scope w MVP, pokaż tylko `model + relative time`).
- Skeletons w loading state (`<Skeleton />` z src/components/Skeleton.tsx).
- Empty state: „Brak zdjęć dla tej półki. Wgraj pierwsze →" z linkiem do `/upload`.

#### 3. Link w `ShelfListItem` → `/shelves/[id]`

**File**: `src/components/ShelfListItem.tsx`

**Intent**: Dodać przycisk/link „Zobacz zdjęcia →" na każdym wierszu półki. Klik prowadzi do `/shelves/[id]`.

**Contract**: Wewnątrz wiersza dodaj `<a href={`/shelves/${shelf.id}`}>Zobacz zdjęcia →</a>`. Bez zmian w istniejących akcjach (edit/delete).

#### 4. Augmented `DetectionReview`

**File**: `src/components/DetectionReview.tsx`

**Intent**: Pokazać metadane bieżącego vision_run (model + czas) i dodać dwa przyciski akcji: „Ponów vision (nowy run)" i „Ponów match". Bez zmian w renderowaniu DetectionCard.

**Contract**:
- Dodaj fetch w `useEffect` — response `/api/photos/[id]` teraz zawiera `vision_run` field (Phase 2 §4). State `visionRun: { model, created_at, cost_usd } | null`.
- Nagłówek przed listą detekcji: jeśli `visionRun` → small panel `<div>Vision: {model} · {relative time} · ${cost}</div>`.
- Dwa przyciski (poniżej panelu): `Ponów vision` (z `window.confirm`), `Ponów match`. Click → POST do odpowiedniego endpointu → po sukcesie refetch całej strony (`window.location.reload()` lub re-fetch przez set state — dla MVP reload jest prostszy).
- Toasty/error: in-place pod przyciskami; na 429 → „Rate limit, spróbuj za chwilę"; na 409 → „Vision run w toku, poczekaj 1 minutę".

#### 5. (Optional) Redirect tail w `PhotoUploader`

**File**: `src/components/PhotoUploader.tsx`

**Intent**: Po sukcesie pełnego auto-run zostaw użytkownika na `/photos/[id]` (jak teraz), ale dorzuć po cichu link do `/shelves/[shelfId]` z poziomu `/photos/[id]` (poprzez Phase 3 §4 DetectionReview header).

**Contract**: Bez zmian w `PhotoUploader` (poza poprzednią zmianą `canRetryMatchOnly` która już jest). Wystarczy że Phase 3 §4 doda link w DetectionReview albo Layout/Header.

### Success Criteria:

#### Automated Verification:

- Typecheck pass: `npm run typecheck`.
- Lint pass: `npm run lint`.
- Vitest pass: `npm run test`. Nowy plik `tests/unit/components/PhotoListIsland.test.tsx` — render listy z 4 photo wariantami (po jednym per stage); klik na „Run vision" wywołuje fetch z poprawnym URL; klik na „Re-run vision" pokazuje confirm i wywołuje fetch tylko po potwierdzeniu; toast po 409/429.
- Astro build: `npm run build` przechodzi (`/shelves/[id]` jest dynamic, prerender false).

#### Manual Verification:

- `/shelves` pokazuje link „Zobacz zdjęcia →" przy każdej półce; klik prowadzi do `/shelves/[id]`.
- `/shelves/[id]` pokazuje listę zdjęć posortowaną od najnowszego; każdy wiersz ma miniaturkę, badge stage, liczniki, akcje per stage.
- Klik „Run vision" na photo w stage='uploaded' triggeruje vision call, po sukcesie wiersz pokazuje stage='vision_done' (refetch zadziałał).
- Klik „Re-run vision" na photo w stage='match_done' pokazuje confirm; po potwierdzeniu nowy run wystartowany; po sukcesie wiersz pokazuje stage='vision_done' bo nowy run jeszcze nie ma match'y; w Supabase Studio widać 2 succeeded runs i detections z obu (stare zachowane).
- Double-click na „Run vision" w ciągu 1s — drugi klik dostaje toast „Run już w toku".
- `/photos/[id]` pokazuje badge vision_run metadanych w nagłówku; klik „Ponów match" wywołuje endpoint i refresh strony pokazuje nowe kandydaty.
- Edge: photo z tylko failed vision runs (`select status from vision_runs where photo_id=X` = wszystkie 'failed') pokazuje stage='uploaded' + akcja „Uruchom vision" (recovery z failed = retry).
- Mobile/responsive sanity check listy (Cloudflare Workers działa, ale Tailwind powinien zachować layout na <640px).

**Implementation Note**: Po Phase 3 zatrzymaj i poczekaj na potwierdzenie ręcznej weryfikacji wszystkich 4 stage'ów + concurrent click + re-run-with-history + recovery-from-failed. To golden path tej zmiany.

---

## Testing Strategy

### Unit Tests:

- `tests/unit/pages/api/photos/process.test.ts`: P0001 → 409, sukces tworzy nowy `vision_runs`, detections insert z `vision_run_id`, no delete-by-photo_id.
- `tests/unit/pages/api/photos/match.test.ts`: operuje tylko na detections najnowszego succeeded run; gdy brak succeeded run → 404.
- `tests/unit/pages/api/shelves/photos.test.ts`: 4 stage'e (mock'owane DB shape per wariant), 401 anon, 404 bad UUID, 404 nieistniejąca półka.
- `tests/unit/components/PhotoListIsland.test.tsx`: render per stage, action triggers, confirm modal, error toasts.
- `tests/unit/lib/photos/schema.test.ts`: PhotoListItemDTO + ShelfPhotosResponse type narrowing.

### Integration Tests:

- W tym slice integration = manual (Vitest mocks pokrywają DB shape per CLAUDE.md § Testy). Real DB integration odraczamy do post-merge na produkcji.

### Manual Testing Steps:

1. Migracja: `npx supabase db push` (po merge); w Studio sprawdź `vision_runs` populated dla istniejących photos + `detections.vision_run_id` not null.
2. Stary `/upload` flow: wgraj nowe zdjęcie, automatyczna ścieżka działa, redirect do `/photos/[id]` pokazuje detections + nowy header z vision_run metadata.
3. `/shelves` → klik „Zobacz zdjęcia →" → `/shelves/[id]` pokazuje to nowe zdjęcie + (jeśli były) historyczne.
4. Klik „Re-run vision (nowy run)" na photo z historią → confirm → po sukcesie `select count(*) from vision_runs where photo_id=X` = 2.
5. Otwórz `/shelves/[id]` w dwóch tabach; w jednym klik „Run vision" na uploaded photo, w drugim klik tego samego — drugi tab dostaje toast 409.
6. Symuluj failed vision: w Studio `update vision_runs set status='failed', error_message='test' where id=<latest>` → reload `/shelves/[id]` → photo pokazuje stage='uploaded' + akcja „Uruchom vision".
7. Symuluj stuck running: `insert into vision_runs (photo_id, status, created_at) values (<id>, 'running', now() - interval '6 minutes')`. Reload listy → photo pokazuje stage='uploaded' (>5min, ignored przez logic stage'a; klik „Uruchom vision" działa bo trigger ignoruje stary running run.

## Performance Considerations

- `GET /api/shelves/[id]/photos` — N+1 risk przy per-photo subqueries. Batch przez `IN (...)` lub DISTINCT ON dla latest run, jeden agregat dla liczników. ≤30 zdjęć per półka w MVP → akceptowalne nawet bez perfect batching; zoptymalizować jeśli realny user zgłosi slowness.
- Signed URLs batch `createSignedUrls` — 1 call dla wszystkich thumbnails, nie N.
- Refetch listy po każdej akcji jest prosty, ale przy długiej liście (>20 zdjęć) i powolnym łączu może być laggy. Optymistic update odsunięte do follow-up.

## Migration Notes

- Migration 0007 jest jednokierunkowa (NOT NULL po backfillu). Rollback wymagałby manualnego `ALTER TABLE detections DROP COLUMN vision_run_id` + `DROP TABLE vision_runs`. Standardowy CLAUDE.md branch-per-change workflow: `supabase db push` ZAWSZE po merge do main (lessons.md § Branch per change). Nie pchać migracji w branchu.
- Po merge i push, jeśli production DB ma istniejące photos z dzisiejszej sesji vision-debugging (2026-05-28), backfill je też pokryje (tabela `photos` ma `vision_model` = 'claude-sonnet-4-6' dla tych runs).

## Open Risks & Assumptions

- **Roadmap S-14/S-15 supersession**: po `/10x-archive` tej zmiany trzeba zaktualizować roadmap.md — oba (`photo-process-reload-recovery`, `review-page-nav-entry`) mark as `done` z notą „superseded by shelf-photo-pipeline-ui". Plus opcjonalny dodatek do roadmap: nowy proposed slice „vision-run-history-compare" jako follow-up gdy user zażyczy sobie UI do porównań runów (faktyczne UI poza scope MVP, ale schemat wspiera).
- **Browser `window.confirm` dla re-run confirm** to celowy YAGNI — jeśli user zgłosi UX gap (np. „chcę widzieć cost prediction przed klikiem") → osobny micro-slice z dedicated dialog component.
- **`photos.status` jako cache najnowszego succeeded run** — żyje obok `vision_runs.status` jako redundancja. Świadomy trade-off backward-compat z DTO konsumentami z S-04; cleanup w follow-up refactorze.
- **PROMPT_VERSION**: w `vision_runs` jest kolumna `prompt_version`, ale w Phase 2 §2 zostawiam const stringa lub `null`. Jeśli `src/lib/vision/prompt.ts` ma już version marker — użyj go; jeśli nie, dodaj `export const PROMPT_VERSION = 'v1'` przy okazji.

## References

- Change folder: `context/changes/shelf-photo-pipeline-ui/`
- Wpływ na roadmap: `context/foundation/roadmap.md` (S-14, S-15 supersedowane)
- Pattern DB trigger: `supabase/migrations/0003_handle_new_user.sql`, `supabase/migrations/0004_shelves_constraints.sql`
- Pattern API endpoint + envelope: `src/pages/api/photos/[id].ts`, `src/lib/http/response.ts`
- Pattern React island + refetch: `src/components/ShelvesIsland.tsx`
- F-02 envelope rules: `CLAUDE.md § API endpoints`
- DB defense-in-depth rules: `CLAUDE.md § Supabase`, `lessons.md § Load-bearing convention detail`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB foundations — vision_runs table + RLS + trigger + backfill

#### Automated

- [x] 1.1 Migration aplikuje się czysto przeciwko świeżej DB (`npx supabase db push` lub lokalny shadow `psql -f`) — 4d40633
- [x] 1.2 Typecheck pass: `npm run typecheck` — 4d40633
- [x] 1.3 Lint pass: `npm run lint` — 4d40633
- [x] 1.4 Vitest pass: `npm run test` — 4d40633
- [x] 1.5 `database.types.ts` zawiera typ `vision_runs` Tables row — 4d40633

#### Manual

- [x] 1.6 Supabase Studio: `select * from vision_runs` zwraca ≥1 wiersz per istniejący photo z detekcjami — 4d40633
- [x] 1.7 `select count(*) from detections where vision_run_id is null` = 0 — 4d40633
- [x] 1.8 Dwukrotny `insert into vision_runs` z `status='running'` dla tego samego photo: drugi rzuca P0001 — 4d40633
- [x] 1.9 RLS isolation: user A nie widzi `vision_runs` user'a B w Studio (anon JWT A) — 4d40633

### Phase 2: API — versioned /process, run-scoped /match, list-by-shelf endpoint, CONFLICT code

#### Automated

- [x] 2.1 Typecheck pass: `npm run typecheck` — 99c8410
- [x] 2.2 Lint pass: `npm run lint` — 99c8410
- [x] 2.3 Vitest pass: `npm run test` (z nowymi/zaktualizowanymi testami process / match / shelves photos) — 99c8410
- [x] 2.4 Test `process.test.ts`: P0001 mock → 409 CONFLICT z envelope — 99c8410
- [x] 2.5 Test `match.test.ts`: operuje tylko na detections z najnowszego succeeded run — 99c8410

#### Manual

- [x] 2.6 `curl POST /process` dwa razy pod rząd: drugi zwraca 409 CONFLICT z Polish message — 99c8410
- [x] 2.7 Po sukcesie `/process`: w Studio nowy wiersz `vision_runs` succeeded + detections z `vision_run_id` — 99c8410
- [x] 2.8 Ponowny `/process` po >1min: nowy run, stare detections zachowane, `select latest succeeded` zwraca nowe — 99c8410
- [x] 2.9 `curl GET /api/shelves/<id>/photos` zwraca listę z poprawnym stage + ważne signed URL thumbnaila — 99c8410
- [x] 2.10 `src/lib/vision/AGENTS.md` zaktualizowany — bullet „Idempotencja" zastąpiony nowym „Wersjonowanie vision" + concurrency trigger note — 99c8410

### Phase 3: UI — /shelves/[id] page + PhotoListIsland + augmented DetectionReview + nawigacja

#### Automated

- [x] 3.1 Typecheck pass: `npm run typecheck` — 46ed831
- [x] 3.2 Lint pass: `npm run lint` — 46ed831
- [x] 3.3 Vitest pass: `npm run test` (z nowym `PhotoListIsland.test.tsx`) — 46ed831
- [x] 3.4 Astro build pass: `npm run build` — 46ed831

#### Manual

- [x] 3.5 `/shelves` pokazuje link „Zobacz zdjęcia →" na każdej półce — 46ed831
- [x] 3.6 `/shelves/[id]` pokazuje listę zdjęć z miniaturkami i stage badge — 46ed831
- [x] 3.7 „Run vision" na uploaded photo → po sukcesie wiersz pokazuje vision_done (refetch) — 46ed831
- [x] 3.8 „Re-run vision" pokazuje confirm; po OK → nowy run, w Studio widać 2 succeeded + obie generacje detections — 46ed831
- [x] 3.9 Double-click „Run vision" w 1s → drugi dostaje toast 409 — 46ed831
- [x] 3.10 `/photos/[id]` ma badge vision_run metadanych + akcje Ponów vision/match — 46ed831
- [x] 3.11 Photo z tylko failed runs pokazuje stage uploaded + akcja Uruchom vision — 46ed831
- [x] 3.12 Mobile responsive sanity check (<640px) — lista zdjęć nadal czytelna — 46ed831
