# S-33: BYOK Pipeline Enforcement — Plan Brief

> Full plan: `context/changes/byok-pipeline/plan.md`

## What & Why

Pipeline vision (upload zdjęcia → detekcje grzbietów i refine cropa) wywołuje Anthropic API
używając globalnego klucza z Worker Secrets — bez wiedzy usera i bez możliwości kontroli kosztu.
S-33 wymusza BYOK: każde wywołanie vision wymaga aktywnego klucza z `user_api_keys` (S-32).
Brak klucza → 403 z CTA do `/account`. User płaci swoim kluczem, system nie płaci nic.

## Starting Point

S-32 dał kompletną infrastrukturę kluczy: tabela `user_api_keys` (AES-GCM, partial unique index
`is_active`), CRUD endpointy, sekcja kluczy w AccountIsland. Pipeline vision (`client.ts`,
`process.ts`, `refine.ts`) nadal hardkoduje `env?.ANTHROPIC_API_KEY` — żadne z tych plików
nie wie o istnieniu `user_api_keys`.

## Desired End State

- Bez aktywnego klucza: `POST /photos/[id]/process` i `POST /detections/[id]/refine` zwracają
  403 `NO_API_KEY`; PhotoUploader pokazuje empty state z linkiem do `/account`.
- Z aktywnym kluczem: pipeline działa identycznie jak dotychczas (Anthropic), lub przez nową
  ścieżkę OpenAI-compatible fetch (openai/openrouter/openai_compatible).
- `ANTHROPIC_API_KEY` z env pozostaje w secrets dla dev/emergency, ale pipeline go nie używa.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|------------------|--------|
| Admin fallback | Hard require dla WSZYSTKICH | Czyste BYOK enforcement; fallback łatwo dodać w S-26 gdy is_admin istnieje | Plan |
| VisionProvider abstraction | Anthropic SDK (full) + OpenAI-compat fetch (no dep) | CF Workers bundle size; fetch wystarczy dla /v1/chat/completions | Plan |
| Refine endpoint guard | Ta sama bramka co process (ai_enabled + NO_API_KEY) | Spójność; refine też płatny, brak guard'u = luka | Plan |
| PhotoUploader key check | Eager na mount (GET /api/account/keys) | Lepszy UX: user widzi brak klucza przed uploadem, nie po błędzie 403 | Plan |
| Koszt non-Anthropic | costUsd = 0 (system nie płaci za klucz usera) | Pricing external; user_api_keys = user's key = user's cost | Plan |
| Migracja DB | Brak | user_api_keys gotowy od S-32 | Research |
| Model default | anthropic → claude-sonnet-4-6; openai-compat → gpt-4o-mini | Sensowne defaulty gdy user_api_keys.model = null | Plan |

## Scope

**In scope:**
- `src/lib/http/response.ts` — nowy kod `NO_API_KEY`
- `src/lib/vision/client.ts` — VisionProviderConfig type + refaktor obu funkcji
- `src/lib/keys/getActiveProviderConfig.ts` — nowy helper (fetch + decrypt aktywnego klucza)
- `src/pages/api/photos/[id]/process.ts` — key lookup step
- `src/pages/api/detections/[id]/refine.ts` — ai_enabled guard + key lookup
- `src/components/PhotoUploader.tsx` — eager key check na mount + empty state
- Unit testy dla nowych ścieżek (NO_API_KEY, OpenAI-compat)
- E2E test: empty state → CTA → /account
- `src/lib/vision/AGENTS.md` — dokumentacja VisionProvider pattern

**Out of scope:**
- Zmiany w AccountIsland (S-32 gotowy)
- Migracja DB
- Tracking kosztu dla non-Anthropic providerów
- is_admin fallback (S-26)
- Extended thinking dla OpenAI-compatible

## Architecture / Approach

```
PhotoUploader (mount)
  → GET /api/account/keys
  → hasActiveKey? show upload : show CTA to /account

POST /api/photos/[id]/process
  → auth (401) → ai_enabled (403) → getActiveProviderConfig (403 NO_API_KEY)
  → detectSpines(input, config)
      → provider='anthropic' → Anthropic SDK (istniejąca ścieżka, user's apiKey)
      → provider='openai'|... → fetch /v1/chat/completions (new path, costUsd=0)

POST /api/detections/[id]/refine (NEW guards)
  → auth → ai_enabled → getActiveProviderConfig
  → detectSingleSpineFromCrop(input, config) [same dispatch]
```

`getActiveProviderConfig(supabase, userId)`:
- `supabase.from('user_api_keys').select(...).eq('is_active', true).maybeSingle()`
- `decryptWithEnvKey(row.encrypted_key)` → zwraca `VisionProviderConfig | null`

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. VisionProvider abstraction | `client.ts` + error code — wewnętrzny refaktor | Istniejące unit testy vision wymagają update (nowe sygnatury) |
| 2. Key lookup + endpoints | process + refine z BYOK enforcement | Błąd w decryption path blokuje vision dla wszystkich userów |
| 3. PhotoUploader empty state | UX: user wie o braku klucza przed uploadem | Dodatkowy request na mount (pomijalne) |
| 4. Tests + AGENTS.md | Jakość: unit + E2E pokrycie nowych ścieżek | E2E mock setup dla key check |

**Prerequisites:** S-32 done (user_api_keys, crypto, endpointy kluczy) ✓
**Estimated effort:** ~2-3 sesje, 4 fazy

## Open Risks & Assumptions

- `user_api_keys.model = null` dla non-Anthropic → default `gpt-4o-mini` może nie istnieć u
  wszystkich providerów (OpenRouter ma własny model namespace); user może zobaczyć 400 od provider'a
- OpenAI-compatible vision quality (JSON schema adherence, Polish OCR) — nieprzetestowane na
  realnych zdjęciach; błędy parse → `correction_type='parse_failure'` (istniejący mechanizm)
- `refine.ts` brak guard'u `ai_enabled` był pominięty w S-32 — dodajemy teraz, nie breaking

## Success Criteria (Summary)

- Bez aktywnego klucza → 403 `NO_API_KEY` z `{ account_url: '/account' }` na obu endpointach
- Z aktywnym kluczem Anthropic → upload + review + refine działa identycznie jak przed S-33
- PhotoUploader empty state widoczny bez klucza, normalny uploader z kluczem
