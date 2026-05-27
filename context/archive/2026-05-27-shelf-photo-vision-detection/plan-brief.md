# S-03 Upload zdjęcia półki + detekcja grzbietów — Plan Brief

> Full plan: `context/changes/shelf-photo-vision-detection/plan.md`
> Research: `context/changes/shelf-photo-vision-detection/research.md`

## What & Why

Wgranie jednego zdjęcia półki → vision-LLM (Claude Sonnet 4.6) rozpoznaje grzbiety → lista surowych detekcji (tytuł, autor, pewność, kolor). To rdzeń hipotezy produktu „minuty zamiast godzin ręcznego wpisywania" i prerekwizyt north-star S-05. Najbardziej ryzykowny technicznie slice (recall ≥70%, koszt, latencja).

## Starting Point

Schema `photos`/`detections`/`corrections('parse_failure')` + ich RLS już istnieją. `@anthropic-ai/sdk@0.99` zainstalowany, `ANTHROPIC_API_KEY` zadeklarowany — ale zero kodu vision. Brak `src/lib/vision/`, `/api/photos/`, Storage bucketa. F-02 envelope + SQLSTATE mapping i `Skeleton` (S-12) gotowe do reużycia.

## Desired End State

Zalogowany użytkownik na `/upload` wybiera półkę, przeciąga zdjęcie → progress (upload→przetwarzanie) → po ~10s lista rozpoznanych grzbietów z badge koloru. Koszt+latencja zapisane na `photos`. Błąd vision → status `failed` + „Spróbuj ponownie" (idempotentny). Matching/akceptacja = S-04/S-05.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Model vision | `claude-sonnet-4-6` | ~0.973 vs Opus ~0.993 na druku, ~4× taniej (~$0.005/zdj) | Research |
| Architektura przetwarzania | Synchroniczny endpoint | CF 30s = CPU nie wall-clock; `await fetch` nie liczy się | Research |
| Image preprocessing | Resize client-side (canvas ≤1568px JPEG) | `sharp` niedostępny w Workers; tnie koszt+latencję | Research |
| Upload | Browser→Storage bezpośrednio (anon + Storage RLS) | Worker nie dotyka bajtów; zero multipart | Plan |
| Trigger | Auto-chain upload→process, sync + progress bar | Jedna akcja, najprostszy golden path | Plan |
| Paleta koloru | 12 kolorów jako `z.enum` (zamrożona) | Load-bearing dla filtra S-08 | Plan (user) |
| Cost cap | Odłożony; zapis tylko kosztu/latencji | `profiles.daily_vision_budget_usd` nie istnieje; MVP nie potrzebuje | Plan (user) |
| Retry | Raz z `thinking` przy Zod fail → `parse_failure` + abort | CLAUDE.md vision rule | Research |
| Rate limit | Mapować upstream 429/529 → `RATE_LIMITED` | F-02 odłożył enforcement do S-03 | Research |
| UI scope | Lista surowych detekcji read-only | Czysta granica S-03\|S-04 | Plan (user) |

## Scope

**In scope:** upload (browser→Storage), `photos` record + status endpointy, vision pipeline (Sonnet, Zod, retry, idempotencja), koszt/latencja, UI uploader + lista detekcji + retry, e2e mock.

**Out of scope:** matching/kandydaci/dedupe/accept (S-04/S-05), dzienny cost-cap, Opus eskalacja, batch upload, kadrowanie, Queues, ręczna edycja detekcji.

## Architecture / Approach

Worker cienki. Browser: resize→upload do `shelf-photos/{uid}/{uuid}.jpg`→`POST /api/photos`→`POST /api/photos/[id]/process`. Process: download z Storage→base64→`detectSpines` (Sonnet)→Zod→delete-then-insert `detections`→update metryk. RLS-respecting (anon + Storage RLS). `src/lib/vision/{prompt,schema,client}.ts` single-source.

## Phases at a Glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1. Vision domain module | `src/lib/vision/*` + `photos/schema` (testowalne) | retry/Zod logic poprawność |
| 2. Storage + record endpoint | bucket migracja + `POST/GET /api/photos` | Storage RLS policy (push po merge) |
| 3. Process endpoint | pełny pipeline + idempotencja + metryki | error mapping, idempotencja |
| 4. UI + e2e | PhotoUploader + strona + Playwright mock | client-side resize cross-browser |

**Prerequisites:** S-02 done ✓; `ANTHROPIC_API_KEY` w `.dev.vars` + Worker Secret; `supabase db push` migracji 0005 po merge.
**Estimated effort:** ~3-4 sesje (4 fazy; Sonnet do implementacji).

## Open Risks & Assumptions

- Real Storage + vision weryfikowalne dopiero po merge + `supabase db push` (branch rule) — w branchu mocki.
- `claude-sonnet-4-6` ID do potwierdzenia na koncie przy implement (adaptacja literalna jeśli inny).
- Recall na realnych polskich półkach (reality-check 100%/82%) — fallback Opus jako post-MVP (Q5).
- Client-side canvas resize zależny od przeglądarki (desktop-only MVP — akceptowalne).

## Success Criteria (Summary)

- Upload zdjęcia → lista rozpoznanych grzbietów w UI; koszt/latencja na `photos`.
- Re-trigger przetwarzania nie duplikuje detekcji.
- Storage RLS izoluje zdjęcia per-user; błąd vision → recovery przez retry.
