# Deploy Plan — BookShelf Catalog

**Project:** bookshelf
**Stack pin:** Astro 6.3.5 + React 19 + TypeScript + Tailwind 4 / `@astrojs/cloudflare` v13.5.2 / wrangler 4.93.0 / Node 22.12.0
**Platform:** Cloudflare Workers (with Workers Assets — NIE Pages; `@astrojs/cloudflare` v13 dropped Pages)
**Last verified:** 2026-05-23 (gap #1-#4 closed same day)
**compatibility_date:** 2026-05-12
**Source artifacts:** [context/foundation/infrastructure.md](../foundation/infrastructure.md) (operations, risk register R1–R7), [context/foundation/tech-stack.md](../foundation/tech-stack.md) (stack rationale)

## Context

Pierwszy deploy MVP został wykonany 2026-05-23 zgodnie z rekomendacją `/10x-infra-research` (cloudflare-workers, 5/5 Pass na agent-friendly criteria). Ten dokument jest **ground truth** dla downstream skills (milestone planning, M1/M1L5 lessons) — opisuje co już działa na produkcji oraz co pozostało do "complete first-deployment story". NIE duplikuje operational story ani risk register z `infrastructure.md` — referuje je.

## Baseline — co już jest wdrożone

| Fakt | Wartość |
|---|---|
| Worker name | `bookshelf` |
| Production URL | `https://bookshelf.dariusz-danowski-559.workers.dev` |
| Current Version ID | `bb78b47f-9f98-4a3e-b62f-b4cc921aa681` |
| KV namespace (auto-provisioned) | `bookshelf-session` / id `cf3e742338104fbcac935a80afdb5f22` |
| Bindings | `env.SESSION` (KV), `env.IMAGES`, `env.ASSETS` |
| Observability | Enabled (dash.cloudflare.com → Workers → bookshelf → Logs) |
| Local CF credentials | `.dev.vars` zawiera `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (gitignored, linia 151) |
| Build cmd zweryfikowany | `npm run build` → `dist/` (~7s, 1049.71 KiB total upload, 226.63 KiB gzipped) |
| Deploy cmd zweryfikowany | `npx wrangler deploy` (z env vars z `.dev.vars` w sesji PowerShell) |
| Smoke test #15434 (R1) | ✅ GET `/` → HTTP 200, valid HTML, brak `[object Object]` |
| Astro middleware obecne | NIE — `src/middleware.ts` jeszcze nie utworzony (planowany w M1) |
| Supabase project linked | ✅ `foqpoqdbicgsrbkcuckc` / `bookshelf` / West Europe (London) |
| Supabase schema applied | ✅ migracje `0001_initial_schema.sql` + `0002_rls_policies.sql` na remote — 8 tabel z RLS, weryfikacja REST API `GET /rest/v1/shelves` → 200 `[]` |
| Workers Secrets bound | ✅ 4 sekrety na `bookshelf`: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (`wrangler secret list` confirmed) |

Stack pinning + bindings są w `wrangler.jsonc` (commit `f5b9347`). Adapter używa `@astrojs/cloudflare/entrypoints/server` jako `main` (modern v13 default — różni się od starszego `./dist/_worker.js/index.js` z infrastructure.md step 2, ale jest poprawne).

## Verification protocol — re-confirm baseline after context reset

Trzy komendy do sprawdzenia czy baseline nadal aktualny (uruchom po długiej przerwie albo gdy `last verified` > 30 dni):

```powershell
# Załaduj credentials z .dev.vars do sesji
Get-Content .dev.vars | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { Set-Item -Path "Env:$($matches[1])" -Value $matches[2] } }

# 1. URL żyje?
curl.exe -sI https://bookshelf.dariusz-danowski-559.workers.dev   # expect: HTTP/2 200
# Jeśli DNS fail / 404 → worker został usunięty, re-run: npm run build; npx wrangler deploy

# 2. Deployment history obecna?
npx wrangler deployments list --name bookshelf                    # expect: ≥1 entry
# Jeśli pusto → re-run: npx wrangler deploy

# 3. KV namespace obecny?
npx wrangler kv namespace list                                    # expect: bookshelf-session z id cf3e7423...
# Jeśli brak → KV usunięty; @astrojs/cloudflare re-provision'uje przy następnym deploy
```

Staleness rule: jeśli `last verified` > 30 dni od daty bieżącej, **najpierw** odpal te trzy, dopiero potem ufaj plikowi.

## Remaining work — gap table

Grupowanie po milestone (M1 / M1L5 / M3) — milestone planners konsumują per-lekcja. `R*` = numer ryzyka w `infrastructure.md` risk register.

| # | Gap | Executor | Command / Action | Verification | Milestone | Risk-ref |
|---|---|---|---|---|---|---|
| 1 | ✅ DONE 2026-05-23 — `worker-configuration.d.ts` w `.gitignore` (linia 152) | agent-auto | — | `git status` clean | housekeeping | — |
| 2 | ✅ DONE 2026-05-23 — Supabase init + link (`foqpoqdbicgsrbkcuckc`, West Europe) | agent-with-approval | — | `npx supabase migration list` pokazuje linked state | M1 | — |
| 3 | ✅ DONE 2026-05-23 — Migracje `0001_initial_schema.sql` + `0002_rls_policies.sql` na remote | agent-auto | — | `migration list`: Local 0001/0002 = Remote 0001/0002; REST API `GET /rest/v1/shelves` → 200 `[]` | M1 | — |
| 4 | ✅ DONE 2026-05-23 — 4 runtime secrets na Workers prod | agent-with-approval | — | `npx wrangler secret list` → 4 wpisy | M1 | — |
| 5 | `GOOGLE_BOOKS_API_KEY` (opcjonalny, dla wyższego limitu) | human-only | Załóż klucz w Google Cloud Console → `npx wrangler secret put GOOGLE_BOOKS_API_KEY` | jw. | M2 (gdy matching pipeline online) | — |
| 6 | Astro middleware bug smoke test ZANIM `src/middleware.ts` powstanie | agent-with-approval | Po dodaniu middleware: `npm run build` + `npx wrangler deploy` + `curl https://bookshelf...workers.dev/shelves` (auth-guarded route) | Response zawiera tekst, nie `[object Object]`. Jeśli bug trafi — middleware-as-helper workaround (`src/lib/auth/guard.ts` per-page) | M1 (przed Vision integracją) | R1 (M, H) |
| 7 | `.github/workflows/ci.yml` (lint + typecheck + vitest + playwright) | agent-auto | Scaffold zgodnie ze CLAUDE.md sekcja "CI" — wszystkie scripty już są w `package.json` | Pierwszy PR triggeruje pipeline; status = green | M1L5 | — |
| 8 | `.github/workflows/deploy.yml` (build + `cloudflare/wrangler-action@v3`, **NIE** `cloudflare/pages-action`) | agent-auto | YAML per `infrastructure.md` Operational Story → preview deploys | Push do `main` → nowy deployment widoczny w `wrangler deployments list` | M1L5 | — |
| 9 | GitHub Secrets — CF credentials + runtime secrets dla CI deploy | human-only | Settings → Secrets and variables → Actions: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, oraz **kopia** runtime secrets (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` etc.) jeśli deploy ma robić `wrangler secret put` z CI | Repo secrets count ≥ 6; pierwszy CI deploy success | M1L5 | — |
| 10 | CPU 30s telemetry baseline (vision pipeline) | agent-auto (po M1) | Mierzyć `photos.vision_latency_ms` od pierwszego prawdziwego `/api/photos/[id]/process` | Alert threshold: 25s avg → trigger pivota do Cloudflare Queues | M2+ | R3 (L-M, H), R5 (L, H) |

Sekwencjonowanie: gap 1 może być kiedykolwiek; **2 → 3 → 4 musi być w tej kolejności** (init przed migrations przed secrets); 6 jest gate'em przed pełną integracją Vision w M1; 7-9 to spójna paczka M1L5; 10 to post-deploy obserwacja, nie krok wdrożenia.

## References (nie duplikujemy)

- **Operational story** (preview deploys / secrets rotation / rollback / approval / logs) → `infrastructure.md` § Operational Story
- **Risk register R1–R7** (Astro #15434, stale Pages refs, CPU vs vision retry, panel default suggestion, Anthropic timeout > CF 30s, wrangler local-mode default, multi-project $5×N cost) → `infrastructure.md` § Risk Register
- **Stack rationale** (dlaczego Workers nie Pages, dlaczego $5/mo paid plan default) → `tech-stack.md` + `infrastructure.md` § Recommendation
- **Komendy startowe** (token creation, env vars, first deploy walkthrough) → `docs/plan-implementacji.md` § Komendy startowe + `infrastructure.md` § Getting Started

## Out of scope

Następujące **nie są** częścią pierwszego wdrożenia ani tego planu:

- **Custom domain** (`bookshelf.<your-domain>`) — workers.dev URL akceptowalny dla MVP demo. Per-PRD post-MVP.
- **Cloudflare Access / Zero Trust** dla preview URL gatingu — paid feature, post-MVP.
- **Cloudflare Queues / Durable Objects / D1** — paid bindings, planowane jako trigger pivota jeśli R3 (CPU vision retry) odpali. Nie konfigurujemy z wyprzedzeniem.
- **Multi-region failover / HA / SLA** — single-user MVP.
- **Trzy stale referencje "Cloudflare Pages"** (`context/foundation/health-check.md:143`, `context/foundation/shape-notes.md:300`, `docs/prd.md:254+`) — to documentation drift, NIE blocker deploymentu. Tracked separately; podłączyć do M1L5 commit'a gdy CI YAML i tak będzie ruszać te pliki, albo otworzyć osobny `/10x-new` ticket. **Nie mieszamy z deploy-plan signal** dla downstream consumers.
- **Pages → Workers migration commands** — wykonane w commitach `312d426` i `f5b9347`. Nie powtarzamy.
- **Dockerfile / Fly.io runner-up** — runner-up zachowany w `infrastructure.md` jako exit ramp; nie konfigurujemy z wyprzedzeniem.

## Must-have facts (dla milestone planner'ów konsumujących ten plik po context reset)

Następujące 7 faktów muszą być natychmiast wyciągalne z tego pliku bez odpalania CLI:

1. Production URL: `https://bookshelf.dariusz-danowski-559.workers.dev` (sekcja Baseline)
2. Worker name: `bookshelf` (sekcja Baseline) — target dla wszystkich `wrangler` komend
3. KV namespace name + id: `bookshelf-session` / `cf3e742338104fbcac935a80afdb5f22` (sekcja Baseline) — nie re-provisionować w M1
4. Brakujące Workers Secrets: 4 klucze (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`) — sekcja Remaining work gap #4
5. Local-only credentials w `.dev.vars`: 2 klucze (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) — do kopiowania do GitHub Secrets w M1L5
6. compatibility_date pin: `2026-05-12` (sekcja Header) + adapter `@astrojs/cloudflare` v13.5.2 — przy dependency bumps zachować
7. Build/deploy command pair: `npm run build` + `npx wrangler deploy` — lift verbatim do `.github/workflows/deploy.yml` w M1L5
