---
date: 2026-05-27T14:39:07+0200
researcher: Claude Opus 4.7 (10x-research)
git_commit: 210ed7e37a50b9e5450205f70986e4af8d5bdb37
branch: change/shelf-photo-vision-detection
repository: dariuszdanowski/bookshelf
topic: "S-03 vision detection — Anthropic SDK 0.99, model choice, CF Workers limits, image pipeline, retry/Zod, integration points"
tags: [research, vision, anthropic-sdk, cloudflare-workers, supabase-storage, s-03]
status: complete
last_updated: 2026-05-27
last_updated_by: Claude Opus 4.7 (10x-research)
---

# Research: S-03 Upload zdjęcia półki + detekcja grzbietów (vision)

**Date**: 2026-05-27T14:39:07+0200
**Branch**: change/shelf-photo-vision-detection
**Git Commit**: 210ed7e
**Repository**: dariuszdanowski/bookshelf

## Research Question

Jak zaimplementować S-03 wzorcowo: Anthropic vision API (@anthropic-ai/sdk 0.99) — składnia, model choice (Sonnet vs Opus) dla recall na polskich grzbietach + koszt/latencja, Cloudflare Workers 30s limit dla vision call + retry, image preprocessing/resize, Zod retry-on-parse-fail z thinking budget, polish OCR edge cases, idempotentna persystencja detekcji.

## Summary

**Architektura jest mniej ryzykowna niż zakładał plan-implementacji.md.** Kluczowe ustalenie: **CF Workers „30s" to limit CPU time, nie wall-clock.** Oczekiwanie na `fetch` (wywołanie LLM) NIE liczy się do CPU. Vision call ~10s to ~milisekundy CPU. Wall-clock dla HTTP requests jest **nieograniczony**, dopóki klient jest podłączony. → **Synchroniczny `POST /api/photos/[id]/process` jest wykonalny dla MVP** (jedno zdjęcie); Cloudflare Queues to dopiero post-MVP optymalizacja, nie wymóg.

**Rekomendacje kontraktowe (do `/10x-plan`):**
1. **Model: `claude-sonnet-4-6`** (Sonnet 4.6). Printed-text structured extraction ~0.973 vs Opus ~0.993 (gap ~2%), oba 100% parse/schema, latencja ~10s podobna, ale Sonnet **~4× tańszy** (~$0.005 vs ~$0.015/zdjęcie). Opus = eskalacja post-MVP (Q5).
2. **Resize CLIENT-SIDE** (browser canvas) do ≤1568px długiej krawędzi, JPEG q85, **przed** uploadem. Powód: (a) Worker **nie ma `sharp`** (native module, niedostępny w Workers runtime); (b) 1568px ≈ 1568 tokenów ≈ $0.005 (powyżej Anthropic i tak downscale'uje, dodając latencję bez zysku jakości); (c) mniejszy base64 = mniej CPU/pamięci Workera. Zgodne z PRD „no image cropping in UI" (resize ≠ crop).
3. **Storage: bucket `shelf-photos` (private) + Storage RLS** scoping do prefiksu `{auth.uid()}/`, klient **anon-key** (RLS-respecting, BEZ service-role — per CLAUDE.md).
4. **Retry-with-thinking**: Zod `DetectionSchema.safeParse` fail → retry raz z `thinking: { type: 'enabled', budget_tokens: ~1536 }`; drugi fail → `corrections` row `parse_failure` + abort. Persystencja detekcji **przed** matchingiem; re-run idempotentny.
5. **Cost cap (gap)**: `profiles.daily_vision_budget_usd` NIE istnieje w schemacie → **MVP: odłożyć** per-user dzienny cap; zapisywać tylko `photos.vision_cost_usd` + `vision_latency_ms` (kolumny istnieją) dla obserwowalności (FR-039).
6. **Paleta kolorów (Q2)**: zamrozić ~11 nazwanych kolorów jako `z.enum` w `DetectionSchema.spine_color` JUŻ w S-03 (load-bearing — S-08 filtruje po tym; zmiana = migracja danych).

## Detailed Findings

### 1. Anthropic SDK 0.99 — powierzchnia API (Context7 `/anthropics/anthropic-sdk-typescript`)

- Init: `import Anthropic from '@anthropic-ai/sdk'; const client = new Anthropic({ apiKey });`
- `client.messages.create({ max_tokens, messages, model, thinking?, system?, temperature? })`.
- **Image block** (`ImageBlockParam`): `{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg'|'image/png'|'image/gif'|'image/webp', data: <base64> } }`. URL source też istnieje (`type: 'url'`) — ale nasze zdjęcie żyje w prywatnym Supabase Storage, więc base64 z pobranych bajtów.
- **Thinking**: `thinking?: ThinkingConfigParam` → `{ type: 'enabled', budget_tokens: N }`. Użyć w retry path.
- **System + prompt caching**: `system?: string | TextBlockParam[]`; można dać `cache_control: { type: 'ephemeral' }` na bloku system (10× tańszy cache-read). Dla single-photo MVP marginalne, ale tanie do dodania.
- **Koszt**: `message.usage.input_tokens` / `output_tokens` → liczyć `vision_cost_usd`. Endpoint `client.messages.countTokens(...)` do estymacji pre-call (opcjonalnie).
- **Image-then-text**: umieszczać blok image PRZED blokiem text w `content` (Claude działa najlepiej, gdy widzi obraz przed instrukcją).
- **max_tokens**: ustawić wysoko (np. 4096) — pełna półka = długi JSON array; za niski max_tokens → truncated JSON → ZodError.
- **Błędy**: SDK rzuca `Anthropic.APIError` (subklasy: 429 rate limit, 529 `overloaded_error`, 400 `invalid_request_error` np. „image too large" >5MB/>8000px). Mapować 429/529 → nasz `RATE_LIMITED`; backoff+retry raz.

### 2. Model choice — Sonnet 4.6 dla MVP

Benchmark structured-OCR z printed documents (Sakasegawa 2026): `claude-4.6-opus` 0.9931 (10.4s), `claude-4.5-sonnet` 0.9733 (10.0s) — oba 100% parse/schema. Niezależny bench (DEV): „Opus wygrywa wyraźnie tylko na complex multi-step reasoning; dla większości zadań Sonnet w granicy błędu przy ¼ kosztu". Ekstrakcja grzbietów = OCR + strukturyzacja (nie multi-step reasoning) → **Sonnet wystarcza**. PRD reality check (recall 100% / precision ~82% na polskiej półce) potwierdza próg recall ≥70%. Koszt: Sonnet ~$0.0047/zdjęcie @1568px vs Opus 4.7 ~$0.014–0.020 (high-res do 4784 tok). **Decyzja: `claude-sonnet-4-6`**; ID potwierdzić przy implement (adaptacja literalna jeśli się różni). Opus = świadomy post-MVP fallback (roadmap Q5).

### 3. Cloudflare Workers — CPU vs wall-clock (krytyczny de-risk)

Z docs CF + StackOverflow (potwierdzone wieloźródłowo):
- **CPU time** = czas, gdy CPU faktycznie wykonuje kod. **Oczekiwanie na `fetch()` NIE liczy się.** Vision call ~10s ≈ ~ms CPU.
- **Duration (wall-clock)** dla HTTP request = **bez limitu**, dopóki klient podłączony.
- Paid plan: domyślny limit CPU 30s, podnoszalny do 5 min (`limits.cpu_ms` w wrangler.jsonc). **Free plan: 10ms CPU** — tu uwaga: base64 + JSON.parse dużego obrazu to praca CPU; przy free 10ms może być ciasno → **client-side resize** usuwa ten problem (mały base64).
- Ryzyko realne: requesty >30s wall mają wyższą szansę losowego TCP disconnect; przy code-update runtime daje 30s na dokończenie. Mitigacja: client-side resize (mniejszy payload, szybciej) + retry logic.
- **Wniosek**: synchroniczny endpoint OK dla MVP. Plan-implementacji.md risk „30s CPU na vision+retry → Queues" jest **w dużej mierze nieaktualny** — Queues to post-MVP, gdy realnie zajdzie batch / Opus.

### 4. Image pipeline + koszt (Anthropic vision docs via Exa)

- Limity API: ≤5MB/zdjęcie, ≤8000×8000px, formaty JPEG/PNG/GIF/WebP, base64 lub URL.
- Anthropic auto-resize'uje obrazy >1568px długiej krawędzi (Sonnet) — dodaje latencję time-to-first-token bez zysku jakości. **Pre-resize do ≤1568px** zalecane.
- Token cost ≈ `(w×h)/750`; 1568px ≈ 1568 tok ≈ $0.0047 (Sonnet). Obrazy <200px degradują accuracy.
- **Tekst na grzbietach jest mały** → nie downscale'ować zbyt agresywnie (1568px długiej krawędzi to sweet spot dla legibilności + kosztu).
- **`sharp` niedostępny w CF Workers** (native binding) → resize MUSI być client-side (canvas) albo WASM. **Rekomendacja: client-side canvas resize** przed uploadem (najprostsze, zero image-processing w Workerze).
- Best practice: orient (EXIF) → resize 1568px → JPEG q85. Strict JSON parse; ~0.5–2% odpowiedzi nie przechodzi schema nawet przy strict prompt → retry (pokrywa się z naszą regułą retry-once).

### 5. Retry + Zod + idempotencja (CLAUDE.md + PRD + schema)

- `DetectionSchema` (PRD §9) — array obiektów `{position:int+, title:1..300, author:max200|null, confidence:0..1, spine_color?:...}`. **Zmiana: `spine_color` → `z.enum(PALETTE).nullable()`** (zamrożenie Q2).
- Single-source prompt: `src/lib/vision/prompt.ts` (CLAUDE.md). Output ZAWSZE przez `DetectionSchema.safeParse`.
- Retry: pierwszy fail (ZodError) → retry raz z `thinking` budget; drugi fail → INSERT `corrections (correction_type='parse_failure')` + abort łańcucha dla tego zdjęcia. `corrections.correction_type` CHECK już zawiera `'parse_failure'` (migracja 0001:123 — bez nowej migracji).
- **Idempotencja** (FR-013, shape-notes NFR): każda detekcja persistowana PRZED matchingiem; re-trigger `process` nie tworzy duplikatów. Wzorzec: przed insertem usuń istniejące detekcje dla `photo_id` (lub upsert po `(photo_id, position_index)`) + guard status `photos.status` (`uploaded`→`processing`→`processed`/`failed`).

### 6. Integration points (codebase — Explore agent)

Nowy slice jest PIERWSZY w repo dla: multipart/form-data, Supabase Storage upload, external LLM call z Workera, długie requesty, insert do `photos`/`detections`.
- **Endpoint pattern**: `src/pages/api/shelves/index.ts`, `[id].ts` — `APIRoute`, `prerender=false`, `locals.supabase`/`locals.user`, `apiResponse`/`apiError`, SQLSTATE mapping (23505/P0001/PGRST116; **dodać 23503** dla `photos_shelf_id_fkey`).
- **Response helpers**: `src/lib/http/response.ts` — `ApiErrorCode` ma już `RATE_LIMITED` (nieużyty — dla 429/529). `parseUuidParam` dla `[id]`.
- **Supabase server client**: `src/lib/db/supabase.server.ts:36-38` — env przez `cloudflare:workers` z fallbackiem. `ANTHROPIC_API_KEY` czytać tym samym wzorcem (`env?.ANTHROPIC_API_KEY ?? import.meta.env...`); zadeklarowany w `src/env.d.ts`.
- **Typy**: `photos` Insert wymaga `shelf_id`,`storage_path`,`user_id`; `detections` Insert wymaga `photo_id`,`position_index` (`database.types.ts`).
- **Zod**: `src/lib/<feature>/schema.ts` + `z.infer` + ręczne DTO → nowy `src/lib/photos/schema.ts`.
- **React island + page**: `ShelvesIsland.tsx` (fetch + loading + error), `ShelfForm.tsx` (SyntheticEvent React 19), `shelves.astro` (`client:load`, auth guard w middleware), `Skeleton.tsx` gotowy dla progress.
- **Storage**: `supabase/config.toml:109-119` — `[storage] enabled`, bucket block **zakomentowany**. Zero kodu `.upload()`/`FormData` w `src/`. Bucket do utworzenia (config + migracja + Storage RLS).

### 7. Polish OCR edge cases

- Sonnet czyta druk dobrze; diakrytyki PL na drukowanym grzbiecie w zasięgu (recall reality-check OK). Ryzyko: pionowa orientacja tekstu na grzbietach, częściowe zasłonięcia → prompt już instruuje confidence <0.7 dla częściowo zasłoniętych + „nie zgaduj".
- Typograficzne quotes w tytułach (lessons.md): przy renderowaniu w JSX użyć curly-brace expression form. W prompt/JSON to zwykły string — bez problemu.

## Code References

- `supabase/migrations/0001_initial_schema.sql:26-58` — `photos` + `detections` (kolumny które slice zapisuje; `vision_cost_usd`, `vision_latency_ms`, `spine_color`, `vision_confidence`).
- `supabase/migrations/0001_initial_schema.sql:123` — `corrections.correction_type` CHECK zawiera `'parse_failure'`.
- `supabase/migrations/0002_rls_policies.sql` — RLS dla `photos` (direct user_id) + `detections` (EXISTS join) **już są**.
- `src/lib/http/response.ts:11-16` — `ApiErrorCode` (`RATE_LIMITED` gotowy).
- `src/lib/db/supabase.server.ts:36-38` — wzorzec czytania env (kopiować dla ANTHROPIC_API_KEY).
- `src/pages/api/shelves/index.ts`, `[id].ts` — endpoint skeleton + SQLSTATE mapping.
- `supabase/config.toml:109-119` — storage bucket template (zakomentowany).
- `src/components/Skeleton.tsx` — progress UI substrate (S-12).

## Architecture Insights

- **Synchroniczny pipeline jest OK dla MVP** dzięki CPU-vs-wall-clock; nie przedwcześnie optymalizować Queues.
- **Przesuń pracę CPU/obrazu na klienta** (resize w canvas) — Worker zostaje cienki: storage put + LLM fetch + Zod + DB inserts.
- **RLS-respecting wszędzie** — Storage przez anon-key + Storage RLS na prefiks `{uid}/`, bez service-role (per CLAUDE.md).
- **Triple guard** dla parse failures: prompt „nie zgaduj" + Zod safeParse + retry-with-thinking + corrections telemetria.
- **Koszt obserwowalny od dnia 1** (`photos.vision_cost_usd`/`vision_latency_ms`) nawet bez dziennego cap.

## Historical Context (from prior changes)

- `context/archive/2026-05-25-data-and-rls-substrate/plan.md` — Storage bucket `photos/` jawnie **odłożony do S-03** ("§ What We're NOT Doing").
- `context/archive/2026-05-26-api-response-contract/plan.md` — `RATE_LIMITED` enforcement jawnie **odłożony do S-03** (vision pipeline pierwszym realnym konsumentem).
- `context/foundation/lessons.md` — bind S-03: server-side error logging (`err.message`), Cloudflare env reading, Worker Secret smoke (ANTHROPIC_API_KEY!), generated artifacts w CI (jeśli migracja → `npm run db:types`), adaptacje literalne.

## Open Questions (kontraktowe — do rozstrzygnięcia w `/10x-plan`)

1. **Cost cap**: dodać migrację `profiles.daily_vision_budget_usd` + enforcement, czy odłożyć dzienny cap do post-MVP (rekomendacja: odłożyć; zapisywać tylko koszt/latencję na `photos`)?
2. **Paleta kolorów (Q2)**: zatwierdzić konkretną listę ~11 PL kolorów jako `z.enum`. Propozycja: `['czerwony','pomarańczowy','żółty','zielony','niebieski','granatowy','fioletowy','różowy','brązowy','czarny','biały','szary']` — user potwierdza/koryguje przed implement (load-bearing dla S-08).
3. **Model ID**: `claude-sonnet-4-6` — potwierdzić dostępność na koncie przy implement.
4. **Rate limiting**: tylko mapować upstream 429/529 → `RATE_LIMITED` (rekomendacja), czy też własny per-user throttle (odłożyć)?
5. **Upload UX**: drag-drop + wybór z dysku; resize client-side w canvas — potwierdzić że to akceptowalne (nie „crop", więc spójne z PRD non-goals).
6. **Storage retencja**: czy kasować oryginał po przetworzeniu? (MVP: zostawić; retencja post-MVP.)

## Related Research

- (brak wcześniejszych `research.md` — to pierwszy w projekcie.)
