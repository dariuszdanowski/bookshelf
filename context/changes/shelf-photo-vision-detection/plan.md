# S-03 Upload zdjęcia półki + detekcja grzbietów (vision) — Implementation Plan

## Overview

Użytkownik wgrywa zdjęcie półki (drag-drop / wybór z dysku), przeglądarka zmniejsza je (≤1568px JPEG) i wrzuca bezpośrednio do prywatnego bucketa Supabase Storage; backend rekorduje wiersz `photos`, a endpoint `process` synchronicznie woła Claude Sonnet 4.6 (vision), waliduje output Zodem, persistuje `detections` idempotentnie i zapisuje koszt/latencję. UI pokazuje progres i listę surowych detekcji (tytuł/autor/pewność/kolor). Matching i akceptacja to S-04/S-05.

## Current State Analysis

- Schema `photos` + `detections` + `corrections('parse_failure')` istnieje (`0001_initial_schema.sql:26-58,123`); RLS dla `photos`/`detections` gotowe (`0002_rls_policies.sql`).
- `@anthropic-ai/sdk@^0.99.0` zainstalowany, `ANTHROPIC_API_KEY` zadeklarowany w `src/env.d.ts`, ale **zero** kodu go używa.
- `src/lib/{db,http,auth,shelves,middleware}` istnieją; `src/lib/vision/`, `src/lib/photos/`, `src/pages/api/photos/` — **nie istnieją**.
- Storage bucket **nie istnieje** (`supabase/config.toml:109-119` ma zakomentowany template); zero kodu `.upload()`/multipart w `src/`.
- F-02 envelope + SQLSTATE mapping (`src/lib/http/response.ts`, `src/pages/api/shelves/*`) — wzorzec do naśladowania; `ApiErrorCode.RATE_LIMITED` gotowy, nieużyty.
- `Skeleton.tsx` (S-12) gotowy jako progress substrate.

Pełna analiza: `context/changes/shelf-photo-vision-detection/research.md`.

## Desired End State

Zalogowany użytkownik wchodzi na `/upload`, wybiera istniejącą półkę, przeciąga zdjęcie → widzi progress (upload → przetwarzanie) → po ~10s listę rozpoznanych grzbietów (tytuł, autor jeśli wykryty, pewność, badge dominującego koloru). `photos.status='processed'`, `detections` zapisane, `vision_cost_usd`/`vision_latency_ms`/`vision_model`/`detected_count` wypełnione. Przy błędzie vision: status `failed` + komunikat + przycisk „Spróbuj ponownie" (idempotentny). Re-trigger przetwarzania nie duplikuje detekcji.

### Key Discoveries:

- **CF Workers 30s = limit CPU, nie wall-clock**; `await fetch` (LLM) nie liczy się do CPU → synchroniczny `process` endpoint jest OK dla MVP (`research.md §3`).
- **`sharp` niedostępny w Workers** → resize wyłącznie client-side (canvas) (`research.md §4`).
- Anthropic image block: `{ type:'image', source:{ type:'base64', media_type, data } }`; `thinking:{type:'enabled',budget_tokens}`; obraz PRZED tekstem; `usage.{input,output}_tokens` → koszt (`research.md §1`).
- RLS dla `photos`/`detections` już są; Storage RLS to osobny mechanizm (policies na `storage.objects`).

## What We're NOT Doing

- Matching z bazą zewnętrzną, kandydaci, dedupe, accept/reject/correct → **S-04/S-05**.
- Per-user dzienny cost-cap (`profiles.daily_vision_budget_usd`) → odłożone; zapisujemy tylko koszt/latencję na `photos`.
- Eskalacja Sonnet→Opus (Q5) → post-MVP.
- Batch upload wielu zdjęć, kadrowanie w UI, własny per-user rate-limit (tylko mapowanie upstream 429/529).
- Cloudflare Queues / async job model → post-MVP (sync wystarcza).
- Ręczna edycja surowych detekcji → S-05.
- Cleanup osieroconych obiektów Storage (browser upload OK, ale `POST /api/photos` padnie / user zamknie tab) → zaakceptowany MVP risk (leak Storage); cleanup job post-MVP. (F5 plan-review)

## Implementation Approach

Vertical slice w 4 fazach: (1) czysty domain module vision (testowalny w izolacji), (2) Storage + record endpoint, (3) pipeline endpoint, (4) UI + e2e. Worker pozostaje cienki: nie dotyka bajtów obrazu przy uploadzie (browser→Storage bezpośrednio), a w `process` tylko pobiera z Storage → base64 → LLM → Zod → DB. RLS-respecting wszędzie (anon-key + Storage RLS, bez service-role).

## Critical Implementation Details

- **Idempotencja `process`**: przed insertem detekcji usuń istniejące dla `photo_id` (delete-then-insert), żeby re-trigger nie duplikował; status `photos` przechodzi `uploaded`→`processing`→`processed`|`failed`. Re-process z `failed`/`processed` dozwolony (reset do `processing`).
- **Retry-with-thinking**: pierwszy `DetectionSchema.safeParse` fail → drugie `messages.create` z `thinking:{type:'enabled',budget_tokens:1536}`; drugi fail → INSERT `corrections(correction_type='parse_failure')` + `photos.status='failed'` + abort.
- **Storage path**: klucz obiektu `{auth.uid()}/{uuid}.jpg` — pierwszy segment = uid, bo Storage RLS policy filtruje po `(storage.foldername(name))[1] = auth.uid()::text`.
- **Browser Storage auth (zweryfikuj NAJPIERW — F1 plan-review)**: `supabase.browser.ts` to anon-key + sesja z cookies; nigdy nie był używany do Storage. PRZED resztą Phase 2 zrób spike: potwierdź w dev (przeglądarka), że browser client niesie JWT usera dla `storage.from('shelf-photos').upload()` (cookies `@supabase/ssr` muszą być czytelne dla JS, nie httpOnly). Jeśli NIE — fallback: server-issued signed upload URL (`storage.createSignedUploadUrl` przez RLS-scoped server client w nowym `POST /api/photos/upload-url`), browser PUT-uje na URL. Reszta architektury bez zmian.
- **Migracja Storage** (`0005`): `supabase db push` **po merge** do main (branch rule); w branchu testy używają mocków, real Storage/vision smoke = manual post-merge.

## Phase 1: Vision domain module

### Overview
Czysty, testowalny moduł `src/lib/vision/` + Zod schematy `src/lib/photos/`. Zero DB/UI/sieci w testach (SDK mockowany).

### Changes Required:

#### 1. Paleta + prompt (single source)
**File**: `src/lib/vision/prompt.ts`
**Intent**: Jedyne źródło system-promptu (z PRD §9) + stała `SPINE_COLORS` (12 kolorów). Prompt instruuje zwrot JSON array, „nie zgaduj", confidence<0.7 dla zasłoniętych, polski tekst po polsku, `spine_color` ∈ palety lub null.
**Contract**: `export const SPINE_COLORS = ['czerwony','pomarańczowy','żółty','zielony','niebieski','granatowy','fioletowy','różowy','brązowy','czarny','biały','szary'] as const;` + `export const VISION_SYSTEM_PROMPT: string`.

#### 2. DetectionSchema
**File**: `src/lib/vision/schema.ts`
**Intent**: Zod walidacja outputu vision; `spine_color` jako enum palety (zamrożenie Q2, load-bearing dla S-08).
**Contract**: `DetectionSchema = z.array(z.object({ position: z.number().int().positive(), title: z.string().min(1).max(300), author: z.string().max(200).nullable(), confidence: z.number().min(0).max(1), spine_color: z.enum(SPINE_COLORS).nullable() }))`; `type Detection = z.infer<...>`.

#### 3. Vision client
**File**: `src/lib/vision/client.ts`
**Intent**: Wrapper na `@anthropic-ai/sdk`: buduje wiadomość (image-then-text), woła `messages.create` (model `claude-sonnet-4-6`, max_tokens 4096), parsuje text→JSON→`DetectionSchema`, retry raz z `thinking` przy ZodError, liczy koszt z `usage`. Czyta `ANTHROPIC_API_KEY` wzorcem `env?.X ?? import.meta.env.X`.
**Contract**: `detectSpines(input: { base64: string; mediaType: 'image/jpeg'|'image/png'|'image/webp' }): Promise<VisionResult>` gdzie `VisionResult = { ok: true; detections: Detection[]; model: string; costUsd: number; latencyMs: number } | { ok: false; reason: 'parse_failure'; latencyMs: number }`. Anthropic API errors (429/529/inne) propagują jako typed error do mapowania w endpoincie. Stałe cen Sonnet: `$3/1M in, $15/1M out`.

#### 4. Photo/Detection DTO + input schema
**File**: `src/lib/photos/schema.ts`
**Intent**: Schemat wejścia record-endpointu + DTO odpowiedzi.
**Contract**: `RecordPhotoSchema = z.object({ shelf_id: z.uuid(), storage_path: z.string().min(1) })`; `type PhotoDTO` (id, shelf_id, status, detected_count, error_message, vision_cost_usd, vision_latency_ms, created_at); `type DetectionDTO` (position_index, raw_title, raw_author, vision_confidence, spine_color).

### Success Criteria:
#### Automated Verification:
- Unit `DetectionSchema`: valid array passes; bad confidence/empty title/invalid spine_color rejected: `npm test`
- Unit `client.detectSpines` z mockowanym SDK: happy path zwraca detekcje + koszt; pierwszy parse fail → retry z `thinking`; drugi fail → `{ok:false, reason:'parse_failure'}`: `npm test`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
#### Manual Verification:
- (brak — czysty moduł, weryfikowany testami)

**Implementation Note**: Po Phase 1 pauza na potwierdzenie zielonych testów przed Phase 2.

---

## Phase 2: Storage bucket + record endpoint

### Overview
Bucket + Storage RLS (migracja, push po merge) i endpoint rejestrujący wiersz `photos` po browser-uploadzie + odczyt statusu.

### Changes Required:

#### 1. Storage migration
**File**: `supabase/migrations/0005_storage_shelf_photos.sql`
**Intent**: Utwórz prywatny bucket `shelf-photos` + RLS policies na `storage.objects` ograniczające insert/select/delete do prefiksu `{auth.uid()}/`.
**Contract**: `insert into storage.buckets (id,name,public) values ('shelf-photos','shelf-photos',false)`; policies `for {select,insert,delete} to authenticated using/with check (bucket_id='shelf-photos' and (storage.foldername(name))[1] = auth.uid()::text)`.

#### 2. Record endpoint
**File**: `src/pages/api/photos/index.ts`
**Intent**: `POST` waliduje `RecordPhotoSchema`, wstawia wiersz `photos` (user_id z `locals.user`, status 'uploaded'), zwraca `PhotoDTO`. `prerender=false`.
**Contract**: SQLSTATE mapping wg CLAUDE.md; `23503` (shelf_id FK / RLS scope) → 404 `NOT_FOUND`. Sukces → 201 `{data:{photo}}`. **Walidacja `storage_path`** (F4 plan-review): musi zaczynać się od `${locals.user.id}/` → inaczej 400 `VALIDATION_ERROR` (defense-in-depth, fail fast zamiast 500 przy `process`).

#### 3. Status endpoint
**File**: `src/pages/api/photos/[id].ts`
**Intent**: `GET` zwraca `PhotoDTO` + (gdy processed) listę `DetectionDTO`. `parseUuidParam`; PGRST116→404. Uzasadnienie (F3 plan-review): page-reload persistence — po odświeżeniu UI pokazuje status/detekcje ostatniego zdjęcia i zasila stan retry; tani endpoint, zostaje.
**Contract**: `{data:{photo, detections?}}`.

### Success Criteria:
#### Automated Verification:
- Unit endpoint `POST /api/photos` (mock supabase): valid → 201 + DTO; bad body → 400; FK 23503 → 404: `npm test`
- Unit `GET /api/photos/[id]`: bad UUID → 404; not found → 404; ok → DTO: `npm test`
- Typecheck + lint: `npm run typecheck && npm run lint`
#### Manual Verification:
- (spike, F1) Browser supabase client niesie sesję usera dla `storage.upload()` — zweryfikowane w dev (przeglądarka, RLS akceptuje) LUB wpięty fallback signed-URL
- (po merge + `supabase db push`) bucket `shelf-photos` istnieje w Studio; upload jako user A nie jest widoczny dla usera B (Storage RLS)

**Implementation Note**: Spike F1 wykonaj NAJPIERW (przed budową endpointu) — determinuje czy architektura uploadu zostaje, czy fallback. Migracja NIE jest pushowana w branchu. Pauza na potwierdzenie zielonych testów.

---

## Phase 3: Process endpoint (vision pipeline)

### Overview
Synchroniczny `POST /api/photos/[id]/process`: Storage→base64→vision→Zod→idempotentny zapis detekcji + metryki.

### Changes Required:

#### 1. Process endpoint
**File**: `src/pages/api/photos/[id].ts` (dodanie `POST`) lub `src/pages/api/photos/[id]/process.ts`
**Intent**: Załaduj `photos` (RLS; PGRST116→404, parseUuidParam→404), ustaw `status='processing'`, pobierz obiekt z `storage.from('shelf-photos').download(storage_path)` → base64, wywołaj `detectSpines`, idempotentnie zapisz detekcje (delete istniejących dla `photo_id` → insert), zaktualizuj `photos` (status 'processed', vision_model, vision_cost_usd, vision_latency_ms, detected_count, processed_at). `parse_failure` → INSERT `corrections('parse_failure')` + status 'failed' + error_message + 400. Anthropic 429/529 → `RATE_LIMITED` (status 'uploaded' z powrotem, by retry był możliwy). Inne → 500 + `console.error` z `{name,code,status}` (err.message, nie raw err).
**Contract**: Sukces → `{data:{photo, detections}}`. Idempotencja: re-process z dowolnego stanu resetuje detekcje. Error logging: `err instanceof Error ? err.message : String(err)`.

### Success Criteria:
#### Automated Verification:
- Unit (mock vision client + supabase): happy path → detekcje zapisane + status processed + koszt; re-process nie duplikuje detekcji (delete-then-insert); `parse_failure` → corrections + status failed + 400; vision client throw 429 → `RATE_LIMITED`; download fail → 500: `npm test`
- Typecheck + lint
#### Manual Verification:
- (po merge) realny smoke: `curl POST /api/photos/<id>/process` na prawdziwym zdjęciu → detekcje + koszt zapisane (weryfikacja `ANTHROPIC_API_KEY` Worker Secret per lessons.md)

**Implementation Note**: Pauza na potwierdzenie zielonych testów.

---

## Phase 4: UI — PhotoUploader + strona + e2e

### Overview
React island z drag-drop, client-side resize, browser→Storage upload, auto-chain process, progress, lista detekcji, retry.

### Changes Required:

#### 1. PhotoUploader island
**File**: `src/components/PhotoUploader.tsx`
**Intent**: Shelf selector (fetch `/api/shelves`), drag-drop + `<input type=file>`, canvas resize do ≤1568px JPEG q85, upload przez `supabase.browser` `storage.from('shelf-photos').upload('${userId}/${uuid}.jpg', blob)`, potem `POST /api/photos` → photoId, potem `POST .../process` (await), stany progress (Skeleton), render `DetectionDTO[]` (tytuł/autor/confidence + badge koloru), stan `failed` **lub stale `processing`** + „Spróbuj ponownie" (re-POST process — idempotentny). (F2 plan-review: 'processing' też musi mieć recovery, bo sync disconnect zostawia ten stan.)
**Contract**: fetch-shape jak w `ShelvesIsland.tsx`; błędy z `{error:{message}}`. Badge koloru mapuje nazwę palety → klasa Tailwind. Polish typographic quotes w JSX → curly-brace form (lessons.md).

#### 2. Upload page
**File**: `src/pages/upload.astro`
**Intent**: Auth guard (middleware), mount `<PhotoUploader client:load />`.
**Contract**: wzorzec `shelves.astro`.

#### 3. Nav entry point
**File**: `src/layouts/Layout.astro` (lub header component)
**Intent**: Link „Skanuj półkę" → `/upload` dla zalogowanego (lessons.md: navigation entry per nowa strona).
**Contract**: warunkowy link przy `Astro.locals.user`.

#### 4. E2E golden path (mock vision)
**File**: `tests/e2e/upload-flow.spec.ts`
**Intent**: login → /upload → wybór półki → upload mock-obrazu → widoczna lista detekcji. Vision **mockowany** (intercept `/api/photos/*/process` lub Anthropic).
**Contract**: jeden happy path, bez assercji jakości vision.

### Success Criteria:
#### Automated Verification:
- Component test `PhotoUploader` (Vitest + Testing Library, mock fetch + supabase.browser): resize wywołany, upload→record→process sekwencja, render detekcji, retry re-triggeruje process: `npm test`
- Playwright golden path (mock vision) zielony lokalnie: `npm run test:e2e`
- Typecheck + lint + build: `npm run typecheck && npm run lint && npm run build`
#### Manual Verification:
- (po merge) realny upload zdjęcia w przeglądarce → progress → lista detekcji; failed→retry działa; nav link widoczny

**Implementation Note**: Po Phase 4 — pełen manual smoke po merge + `supabase db push` + Worker Secret check.

---

## Testing Strategy

### Unit Tests (Vitest):
- `DetectionSchema` edge cases (confidence range, enum spine_color, empty title).
- `client.detectSpines`: happy, retry-with-thinking, parse_failure (SDK mock).
- Endpointy `photos` index/[id]/process (supabase + vision mock): envelope, SQLSTATE, idempotencja, error mapping.
- `PhotoUploader` (mock fetch + supabase.browser): sekwencja upload→record→process, retry.

### Integration Tests:
- Vitest z mockami (real DB integration odroczone do post-merge, analog S-02).

### Manual Testing Steps (po merge + db push):
1. Studio: bucket `shelf-photos` istnieje, prywatny.
2. Upload zdjęcia półki w UI → progress → detekcje + koszt na `photos`.
3. Re-trigger process → brak duplikatów detekcji.
4. Storage RLS: user B nie widzi obiektów usera A.
5. Worker Secret `ANTHROPIC_API_KEY` poprawny (smoke `process`).

## Performance Considerations

- Vision ~10s wall-clock (sync OK; CPU znikomy). Client-side resize ≤1568px tnie koszt (~$0.005/zdjęcie) i latencję.
- `max_tokens 4096` by uniknąć truncated JSON dla pełnej półki.

## Migration Notes

- `0005_storage_shelf_photos.sql` — `supabase db push` PO merge do main (irreversible w prod; branch rule). Brak nowej tabeli public → `db:types` regen niepotrzebny.

## References

- Research: `context/changes/shelf-photo-vision-detection/research.md`
- Wzorzec endpointu: `src/pages/api/shelves/index.ts`, `[id].ts`
- Envelope: `src/lib/http/response.ts`
- Env reading: `src/lib/db/supabase.server.ts:36-38`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Vision domain module
#### Automated
- [ ] 1.1 Unit DetectionSchema (valid/invalid confidence, title, spine_color enum)
- [ ] 1.2 Unit client.detectSpines (happy, retry-with-thinking, parse_failure) z mock SDK
- [ ] 1.3 Typecheck passes
- [ ] 1.4 Lint passes

### Phase 2: Storage bucket + record endpoint
#### Automated
- [ ] 2.1 Unit POST /api/photos (201, 400, 23503→404)
- [ ] 2.2 Unit GET /api/photos/[id] (bad UUID→404, not found→404, ok DTO)
- [ ] 2.3 Typecheck + lint
#### Manual
- [ ] 2.4 (spike F1) browser client niesie sesję dla Storage upload, lub fallback signed-URL wpięty
- [ ] 2.5 (post-merge) bucket istnieje + Storage RLS izoluje userów

### Phase 3: Process endpoint (vision pipeline)
#### Automated
- [ ] 3.1 Unit process: happy (detekcje+koszt+processed)
- [ ] 3.2 Unit process: idempotencja (re-process bez duplikatów)
- [ ] 3.3 Unit process: parse_failure→corrections+failed+400
- [ ] 3.4 Unit process: 429→RATE_LIMITED; download fail→500
- [ ] 3.5 Typecheck + lint
#### Manual
- [ ] 3.6 (post-merge) realny vision smoke + Worker Secret check

### Phase 4: UI — PhotoUploader + strona + e2e
#### Automated
- [ ] 4.1 Component test PhotoUploader (sekwencja upload→record→process, retry)
- [ ] 4.2 Playwright golden path (mock vision) zielony
- [ ] 4.3 Typecheck + lint + build
#### Manual
- [ ] 4.4 (post-merge) realny upload w przeglądarce → progress → detekcje; failed→retry; nav link
