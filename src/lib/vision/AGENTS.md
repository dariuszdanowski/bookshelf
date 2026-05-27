# Vision module — reguły dla agenta

Konwencje domenowe dla `src/lib/vision/` (detekcja grzbietów książek). Reguły ogólne projektu → root `CLAUDE.md`. Ten plik trzyma reguły specyficzne dla vision obok kodu (S-03).

- **Single-source prompt**: system-prompt żyje WYŁĄCZNIE w `prompt.ts` (`VISION_SYSTEM_PROMPT`). Nie inline'ować w `client.ts` ani w endpoincie.
- **Paleta zamrożona**: `SPINE_COLORS` (12 kolorów) w `prompt.ts` jest **load-bearing** — `DetectionSchema.spine_color` to `z.enum(SPINE_COLORS).nullable()`, a S-08 filtruje po `detections.spine_color`. Zmiana palety = migracja danych. Nie dodawać/usuwać kolorów bez świadomej decyzji.
- **Output zawsze przez Zod**: każdy output vision przez `DetectionSchema.safeParse`. Nigdy nie ufać surowemu JSON z modelu.
- **Retry-once-with-thinking**: pierwszy `safeParse` fail (ZodError) → retry RAZ z `thinking: { type:'enabled', budget_tokens: 1536 }`. Drugi fail → zwróć `{ ok:false, reason:'parse_failure' }`; endpoint zapisuje `corrections(correction_type='parse_failure')` + `photos.status='failed'` i przerywa łańcuch dla tego zdjęcia.
- **Model**: `claude-sonnet-4-6` (MVP). Eskalacja do Opus = świadomy post-MVP follow-up (roadmap Q5), NIE w M1.
- **Koszt**: liczyć z `message.usage` (`input_tokens`/`output_tokens`) × cennik Sonnet (`$3/1M in`, `$15/1M out`); zapis na `photos.vision_cost_usd` + `vision_latency_ms` + `vision_model`. (Per-user dzienny cap odłożony — nie ma `profiles.daily_vision_budget_usd`.)
- **Image block**: `{ type:'image', source:{ type:'base64', media_type, data } }`, obraz PRZED tekstem w `content`. `max_tokens: 4096` (pełna półka = długi JSON; za mało → truncated → ZodError). Resize jest **client-side** (canvas) — `sharp` niedostępny w CF Workers; tu przyjmujemy gotowy base64.
- **Env**: `ANTHROPIC_API_KEY` server-only, wzorzec `env?.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY` (jak `supabase.server.ts`). Nigdy do browser bundle.
- **Idempotencja**: detekcje persistowane przez endpoint PRZED matchingiem; re-process = delete-then-insert per `photo_id` (nie duplikować).
- **Testy**: unit (Vitest) z mockowanym SDK — happy / retry / parse_failure. Real vision tylko manual smoke (drogi + flaky, nie w CI).
