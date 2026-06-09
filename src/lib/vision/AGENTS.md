# Vision module — reguły dla agenta

Konwencje domenowe dla `src/lib/vision/` (detekcja grzbietów książek). Reguły ogólne projektu → root `CLAUDE.md`. Ten plik trzyma reguły specyficzne dla vision obok kodu (S-03).

- **Single-source prompt**: system-prompt żyje WYŁĄCZNIE w `prompt.ts` (`VISION_SYSTEM_PROMPT`). Nie inline'ować w `client.ts` ani w endpoincie.
- **identity-first (v7)**: `VISION_SYSTEM_PROMPT` zwraca tylko `{position, title, author, confidence, spine_color}` — **bez bbox, bez orientation**. Decyzja S-40/S-43: bbox z promptu jest wrodzenie zawodny (zmierzono); identity-only czyta ≥ równie dobrze i jest 30–46% tańszy. `PROMPT_VERSION = 'v7'`.
- **bbox = narzędzie naprawcze on-demand**: bbox pochodzi wyłącznie z ręcznego rysowania przez usera (endpoint `POST /api/photos/[id]/detections` z `bbox` w body). Nie jest wymagany do match/dedup/confirm — te operacje działają wyłącznie na `raw_title`/`raw_author`. Historyczne detekcje v6 (z bboxami) renderują się normalnie; nowe runy v7 dają `bbox null`.
- **KPI**: title-recall + precyzja + czas review. **Nie** IoU (bbox-precision nie jest mierzonym KPI od S-43).
- **Paleta zamrożona**: `SPINE_COLORS` (12 kolorów) w `prompt.ts` jest **load-bearing** — `DetectionSchema.spine_color` to `z.enum(SPINE_COLORS).nullable()`, a S-08 filtruje po `detections.spine_color`. Zmiana palety = migracja danych. Nie dodawać/usuwać kolorów bez świadomej decyzji.
- **Output zawsze przez Zod**: każdy output vision przez `DetectionSchema.safeParse`. Nigdy nie ufać surowemu JSON z modelu.
- **Retry-once-with-thinking**: pierwszy `safeParse` fail (ZodError) → retry RAZ z `thinking: { type:'enabled', budget_tokens: 1536 }`. Drugi fail → zwróć `{ ok:false, reason:'parse_failure' }`; endpoint zapisuje `corrections(correction_type='parse_failure')` + `photos.status='failed'` i przerywa łańcuch dla tego zdjęcia.
- **Model**: `claude-sonnet-4-6` (MVP). Eskalacja do Opus = świadomy post-MVP follow-up (roadmap Q5), NIE w M1.
- **Koszt**: liczyć z `message.usage` (`input_tokens`/`output_tokens`) × cennik Sonnet (`$3/1M in`, `$15/1M out`); zapis na `photos.vision_cost_usd` + `vision_latency_ms` + `vision_model`. (Per-user dzienny cap odłożony — nie ma `profiles.daily_vision_budget_usd`.)
- **Image block**: `{ type:'image', source:{ type:'base64', media_type, data } }`, obraz PRZED tekstem w `content`. `max_tokens: 4096` (pełna półka = długi JSON; za mało → truncated → ZodError). Resize jest **client-side** (canvas) — `sharp` niedostępny w CF Workers; tu przyjmujemy gotowy base64.
- **Env**: `ANTHROPIC_API_KEY` server-only, wzorzec `env?.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY` (jak `supabase.server.ts`). Nigdy do browser bundle.
- **Wersjonowanie vision**: każde wywołanie `/process` tworzy nowy wiersz `vision_runs` (status: running → succeeded/failed); detekcje są zapisywane z `vision_run_id` FK. Nigdy nie kasujemy historycznych detekcji z poprzednich runów — `DELETE FROM detections WHERE photo_id` jest zakazane. UI default pokazuje detekcje z najnowszego succeeded run.
- **Trigger concurrency**: `vision_runs_prevent_concurrent` blokuje INSERT `vision_runs(status=running)` gdy istnieje running run < 5 min dla tego samego `photo_id`; endpoint mapuje errcode `P0001` → 409 CONFLICT z wiadomością z trigger'a verbatim.
- **Testy**: unit (Vitest) z mockowanym SDK — happy / retry / parse_failure / identity-response-without-bbox. Real vision tylko manual smoke (drogi + flaky, nie w CI).

## Provider abstraction (S-33)

- **Sygnatury wymagają `VisionProviderConfig`**: `detectSpines(input, config)` i `detectSingleSpineFromCrop(input, config)` — nigdy nie czytaj `env.ANTHROPIC_API_KEY` bezpośrednio w `client.ts`. Klucz zawsze pochodzi z parametru `config`.
- **Anthropic path** (`config.provider === 'anthropic'`): Anthropic SDK + retry-once-with-thinking (jak dotychczas); `config.model ?? 'claude-sonnet-4-6'`; klucz z `config.apiKey`.
- **OpenAI-compatible path** (wszystkie inne providery): `fetch POST {config.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`; single-attempt, brak retry-z-thinking; `costUsd: 0` (system nie płaci za klucz usera); `config.model ?? 'gpt-4o-mini'`.
- **Klucz pobierany w endpointach, nie w `client.ts`**: `getActiveProviderConfig(supabase, userId)` (z `src/lib/keys/getActiveProviderConfig.ts`) jest wywoływany w `process.ts` i `refine.ts` przed wywołaniem vision. `client.ts` jest pure — nie sięga do bazy ani do `env`.
