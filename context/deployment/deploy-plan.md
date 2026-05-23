# Deploy Plan — BookShelf Catalog

**Project:** bookshelf
**Stack pin:** Astro 6.3.5 + React 19 + TypeScript + Tailwind 4 / `@astrojs/cloudflare` v13.5.2 / wrangler 4.93.0 / Node 22.12.0
**Platform:** Cloudflare Workers (with Workers Assets — NIE Pages; `@astrojs/cloudflare` v13 dropped Pages)
**Last verified:** 2026-05-23 (gap #1-#4 closed same day; full live-state re-verification 2026-05-23 — URL→200, version `bb78b47f`, KV `cf3e7423`, 4 secrets, Supabase migrations 0001/0002 remote — wszystko zgodne z Baseline)
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
| 7 | ✅ DONE 2026-05-23 — `.github/workflows/ci.yml` (lint + typecheck + vitest + build, na PR/push do main) | agent-auto | — | Pierwszy PR triggeruje pipeline; status = green | M1L5 | — |
| 8 | ✅ DONE 2026-05-23 — `.github/workflows/deploy.yml` (build + `cloudflare/wrangler-action@v3` na push do main) | agent-auto | — | Push do `main` → nowy deployment widoczny w `wrangler deployments list` | M1L5 | — |
| 9 | GitHub Secrets — `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` dla deploy.yml | human-only | Repo Settings → Secrets and variables → Actions → New repository secret: skopiuj 2 wartości z `.dev.vars` | Pierwszy push do main → deploy.yml success (Actions tab → workflow run zielony) | M1L5 | — |
| 10 | CPU 30s telemetry baseline (vision pipeline) | agent-auto (po M1) | Mierzyć `photos.vision_latency_ms` od pierwszego prawdziwego `/api/photos/[id]/process` | Alert threshold: 25s avg → trigger pivota do Cloudflare Queues | M2+ | R3 (L-M, H), R5 (L, H) |

Sekwencjonowanie: gap 1 może być kiedykolwiek; **2 → 3 → 4 musi być w tej kolejności** (init przed migrations przed secrets); 6 jest gate'em przed pełną integracją Vision w M1; 7-9 to spójna paczka M1L5; 10 to post-deploy obserwacja, nie krok wdrożenia.

## Setup od zera — konta + lokalnie + chmura

Samowystarczalny quickstart dla kogoś stawiającego projekt od czystego repo. Deep-dive (rationale, risk register, operational story) nadal w `infrastructure.md` / `plan-implementacji.md` — tu jest minimalna ścieżka "działa lokalnie i w chmurze".

### A. Konta do założenia (human-only, jednorazowo)

| Usługa | Gdzie | Co skopiować |
|---|---|---|
| Supabase | `supabase.com` → New project (region West Europe / London, jak obecny `foqpoqdbicgsrbkcuckc`) | Settings → API: `Project URL`, `anon` key, `service_role` key |
| Cloudflare | `dash.cloudflare.com` → konto, potem My Profile → API Tokens → Create Token, template **"Edit Cloudflare Workers"** + dodaj "Account: Pages Read" (dla `deployments list`) | API token + Account ID. **NIE** Global API Key |
| Anthropic | `console.anthropic.com/settings/keys` | `ANTHROPIC_API_KEY` (+ budżet ~$20) |
| Google Books (opc.) | `console.cloud.google.com/apis/credentials` | `GOOGLE_BOOKS_API_KEY` — wyższy rate limit; potrzebne dopiero w M2 (gap #5) |

### B. Lokalnie — uruchomienie aplikacji

```powershell
npm install                       # Node ≥ 22.13.0 (engines.node)
Copy-Item .env.example .env.local # uzupełnij 4 sekrety Supabase/Anthropic (vars opisane w .env.example)
# .dev.vars (gitignored) — credentiale Cloudflare do sesji wrangler/deploy:
#   CLOUDFLARE_API_TOKEN=...
#   CLOUDFLARE_ACCOUNT_ID=...

npm run dev          # → http://localhost:4321 (Vite; NIE workerd)
npm run preview      # albo: npx wrangler dev --remote → workerd lokalnie (smoke test #15434 / R1)
```

> `npm run dev` używa Vite, nie miniflare — Workers-only API (`caches.default` itp.) i bug #15434 weryfikuj dopiero przez `preview` / `wrangler dev --remote`.

### C. Supabase — inicjalizacja (dwie ścieżki)

- **Remote — obecny setup, już zrobiony** (to jest stan produkcyjny):
  ```powershell
  npx supabase login
  npx supabase link --project-ref foqpoqdbicgsrbkcuckc
  npx supabase db push          # aplikuje supabase/migrations/0001 + 0002 na remote
  ```
- **Local stack — opcjonalny, wymaga Dockera** (porty z `supabase/config.toml`: API 54321, DB 54322):
  ```powershell
  npx supabase start            # Postgres + Auth + Storage lokalnie
  npx supabase db reset         # aplikuje migracje na lokalną bazę
  ```
  ⚠ **Firewall korporacyjny** (zob. memory): pobranie obrazów Docker / binarki Supabase CLI z `github.com/releases` padnie na `ETIMEDOUT` — użyj VPN/tunelu albo trzymaj się ścieżki **remote**.

### D. Chmura — deploy

```powershell
npm run build
npx wrangler deploy            # NIE `wrangler pages deploy` (@astrojs/cloudflare v13 wycofał Pages)
# → https://bookshelf.<account>.workers.dev

# Sekrety runtime (× 4) — jednorazowo na produkcyjny worker:
npx wrangler secret put PUBLIC_SUPABASE_URL
npx wrangler secret put PUBLIC_SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

CI/CD: push do `main` → `.github/workflows/deploy.yml` (`cloudflare/wrangler-action@v3`) deployuje automatycznie. Wymaga `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` w **GitHub Secrets** (Repo Settings → Secrets and variables → Actions) — to gap #9, human-only.

## References (nie duplikujemy)

- **Operational story** (preview deploys / secrets rotation / rollback / approval / logs) → `infrastructure.md` § Operational Story
- **Risk register R1–R7** (Astro #15434, stale Pages refs, CPU vs vision retry, panel default suggestion, Anthropic timeout > CF 30s, wrangler local-mode default, multi-project $5×N cost) → `infrastructure.md` § Risk Register
- **Stack rationale** (dlaczego Workers nie Pages, dlaczego $5/mo paid plan default) → `tech-stack.md` + `infrastructure.md` § Recommendation
- **Komendy startowe** (token creation, env vars, first deploy walkthrough) → quickstart inline w § Setup od zera wyżej; pełny walkthrough + rationale w `docs/plan-implementacji.md` § Komendy startowe + `infrastructure.md` § Getting Started

## Out of scope

Następujące **nie są** częścią pierwszego wdrożenia ani tego planu:

- **Custom domain** (`bookshelf.<your-domain>`) — workers.dev URL akceptowalny dla MVP demo. Per-PRD post-MVP.
- **Cloudflare Access / Zero Trust** dla preview URL gatingu — paid feature, post-MVP.
- **Cloudflare Queues / Durable Objects / D1** — paid bindings, planowane jako trigger pivota jeśli R3 (CPU vision retry) odpali. Nie konfigurujemy z wyprzedzeniem.
- **Multi-region failover / HA / SLA** — single-user MVP.
- **✅ DONE 2026-05-23 — stale referencje "Cloudflare Pages"** naprawione (5 wystąpień w 3 plikach: `docs/prd.md:54,254`, `context/foundation/health-check.md:143`, `context/foundation/shape-notes.md:300,317` → "Cloudflare Workers"). Był to documentation drift, nie blocker deploymentu. Pozostałe wzmianki "Pages" w repo (`CLAUDE.md`, `AGENTS.md`, `plan-implementacji.md`, `tech-stack.md`, `infrastructure.md`) są poprawne — mówią "NIE Pages" / wyjaśniają dlaczego nie Pages — i celowo nietknięte.
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
