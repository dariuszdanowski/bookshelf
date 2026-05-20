---
project: bookshelf
researched_at: 2026-05-20
recommended_platform: cloudflare-workers
runner_up: railway
context_type: mvp
tech_stack:
  language: typescript
  framework: astro-6
  runtime: node-22
  adapter: '@astrojs/cloudflare@13.5.0'
  bundler: wrangler@4.93.0
---

## Recommendation

**Deploy na Cloudflare Workers (z Workers Assets), nie Cloudflare Pages.** Wybór jest empirycznie zaaranżowany przez tech-stack: `@astrojs/cloudflare` v13 (zainstalowany w M0 bootstrap) wycofał wsparcie dla Cloudflare Pages — Workers to **jedyna** ścieżka deploy'u dla tego adaptera w 2026.

Platforma zwyciężyła w scoringu **5/5 Pass** na agent-friendly criteria (wrangler v4 CLI z pełnym deploy/rollback/tail/secret/deployments loop, fully-managed serverless, `llms.txt` + GitHub markdown source dla docs, deterministic `wrangler deploy` z stable exit codes, multiple oficjalnych MCP serverów dla docs/Workers/observability). PRD-side weights: small scale, low qps, PL/EU users, after-hours solo developer z $0-20/mo budget — Workers Free 100k req/day pokrywa katalog 1000-książek pojedynczego użytkownika; paid plan $5/mo (30s CPU) jest sensownym defaultem dla Vision pipeline'u, nie premium upcharge.

Runner-up: **Railway** (`@astrojs/node` swap + Nixpacks auto-detect, ~$5-13/mo, EU region historical). Trzeci wybór: **Fly.io** (~$1-5/mo Frankfurt always-on, ale Dockerfile rework większy niż Railway).

## Platform Comparison

### Scoring matrix (Pass / Partial / Fail per kryterium)

| Platforma | CLI-first | Managed/serverless | Agent-readable docs | Stable deploy API | MCP / integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | ✅ wrangler v4 full | ✅ fully managed | ✅ `llms.txt` + GitHub | ✅ deterministic | ✅ docs/Workers/observability | **5 Pass** |
| **Railway** | ✅ railway CLI + CI token | ✅ Nixpacks PaaS | 🟡 `.md` URLs, brak llms.txt | ✅ `railway up --ci` | 🟡 MCP beta "WIP" | 3 Pass + 2 Partial |
| **Vercel** | ✅ stable | ✅ serverless | 🟡 markdown, brak llms.txt | ✅ stable | 🟡 MCP beta od 2025-08 | 3 Pass + 2 Partial |
| **Render** | 🟡 cieńsze niż wrangler | ✅ Web Service | 🟡 brak llms.txt | ✅ Blueprint + hooks | ✅ MCP GA od 2025-08 | 3 Pass + 2 Partial |
| **Netlify** | 🟡 brak first-class rollback | ✅ serverless | ✅ `llms.txt` | 🟡 rollback przez UI/API | ✅ MCP dokumentowane | 3 Pass + 2 Partial |
| **Fly.io** | ✅ flyctl full | 🟡 managed VMs + Dockerfile | 🟡 brak llms.txt | ✅ scriptable | 🟡 MCP experimental | 2 Pass + 3 Partial |

### Soft weights z interview

- **Q1 (no persistent conns)** — hard filter nie wyklucza serverless. Brak penalizacji.
- **Q2 (minimum cost)** — Vercel Pro $20/mo i Netlify Pro $19/mo to floor dla EU regionu na tych platformach. Cięte. Cloudflare/Railway/Fly.io/Render mieszczą się w budżecie $0-20/mo.
- **Q3 (no platform familiarity)** — brak tie-breaker w stronę incumbent'a. Ale Cloudflare ma incumbent advantage bo `@astrojs/cloudflare` zainstalowany.
- **Q4 (single region PL/EU)** — Vercel Hobby region locked (no fra1), Netlify Starter region locked us-east-2 (PA tier-locked). Cloudflare global edge auto-includes Frankfurt. Fly.io `fra` GA, Railway europe-west4 historical, Render Frankfurt confirmed.
- **Q5 (external providers OK — Supabase external)** — wszystkie platformy tied.

### Additional disqualifier

**Netlify Starter 10s function timeout** to hard fail dla Vision pipeline'u: Claude Sonnet 4.6 vision call dla zdjęcia półki bywa 5-15s, czasem dłużej. Pro 26s też borderline. Dropped niezależnie od ceny.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wygrywa 5/5 Pass na criteria + incumbent advantage (zainstalowany `@astrojs/cloudflare` v13). `wrangler` v4 oferuje pełen agent-driven loop: `wrangler deploy` (deterministic), `wrangler rollback`, `wrangler tail` (live log), `wrangler deployments list`, `wrangler secret put`. `llms.txt` na `developers.cloudflare.com/workers/llms.txt` + `Accept: text/markdown` header na każdej stronie docs = agent może załadować specyfikację runtime bez HTML scraping. Trzy oficjalne MCP servery (docs.mcp.cloudflare.com, observability.mcp.cloudflare.com — beta status 2026-05-20). Free tier 100k req/day więcej niż BookShelf potrzebuje; paid $5/mo lifts CPU z 10ms na 30s = niezbędne dla Vision pipeline'u.

#### 2. Railway

Closest no-rework runner-up jeśli Cloudflare okaże się ślepym zaułkiem. `@astrojs/node` + Nixpacks auto-detect = bez Dockerfile. CLI mature (`railway up --ci`, env vars, logs, redeploy). Hobby $5/mo + ~$3-8/mo usage = realistic $5-13/mo, no sleep. EU region (Amsterdam europe-west4) historical — confirmuj na `docs.railway.com/reference/regions` przed lock-in. MCP oficjalny ale beta "work in progress". Astro 6 official Railway deploy guide istnieje.

#### 3. Fly.io

Najtańszy persistent z 3 shortlist (~$1-5/mo Frankfurt shared-cpu-1x always-on). Wymaga `@astrojs/node` + Dockerfile = istotny rework od obecnego scaffoldu. `flyctl` dojrzały, kompletny loop deploy/rollback/scale/secrets/logs/regions. MCP experimental (flyctl ≥ 0.3.125). Free tier sunset 2024-10-07 dla nowych orgs — pay-as-you-go od dnia jeden. Bierz jeśli kiedyś budżet stanie się ścianą, potrzebujesz persistent process / WebSockets / background jobs, albo kontrola Dockerfile staje się wartością (nie ograniczeniem).

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Astro middleware bug #15434 (open, status 2026-05-20)** — `@astrojs/cloudflare` v13 + `nodejs_compat` + Astro middleware na SSR pages renderuje `[object Object]` w prod (preview/deploy), dev path działa. BookShelf eksplicytnie planuje `src/middleware.ts` jako auth guard. Bug bezpośrednio na critical path.
2. **10ms CPU na Free tier nie wystarczy dla Vision pipeline'u** — `/api/photos/[id]/process` (Anthropic + Zod parse + Supabase write) prawie na pewno przekroczy. Paid $5/mo (30s CPU) musi być default, nie afterthought. Z $0/mo do $5/mo per project = $60/rok przy 1 projekcie.
3. **Pages → Workers migration churn touching 4 files** — `tech-stack.md`, `CLAUDE.md`, `plan-implementacji.md`, `README.md` wszystkie mówią "Cloudflare Pages". Wymaga merytorycznej aktualizacji przed M1L5 CI workflow design.
4. **Wrangler v4 local-mode default dla KV/D1/R2** — bez `--remote` flag mutacje idą do `.wrangler/state/`, nie produkcji. Mniej ryzykowne dla BookShelfa (Supabase = oddzielny DB), ale land mine jeśli kiedyś dorzucisz Cloudflare KV jako cache.
5. **CPU budget vs vision retry** — 30s paid CPU liczy wall-time CPU. Retry z extended_thinking (z `CLAUDE.md > Vision LLM` rule) = 2× Anthropic. Pesymistycznie: 2 × 10-15s + Supabase + Zod = blisko 30s. Cienki margines.

### Pre-Mortem — How This Could Fail

> Sześć miesięcy temu MVP wstrzelił się na Cloudflare Workers zgodnie z infrastructure.md. Pierwsze 4 tygodnie były gładkie — auth, shelves CRUD, photo upload działały. Problem zaczął się przy `/api/photos/[id]/process` w tygodniu 5 M1: agent buildował endpoint zgodnie z CLAUDE.md, ale nie zauważył, że `nodejs_compat` + `src/middleware.ts` + Astro 6 + adapter v13 wpadało w bug #15434 — auth guard renderował `[object Object]` w produkcji, ale dev (vite + miniflare) działał. Stracono tydzień na diagnozę (lokalny code path inny niż production workerd). Workaround: middleware przeniesione do `src/lib/auth/middleware.ts` jako server-side helper wywoływany ze stron, bez Astro middleware hook. Zadziałało, ale konsekwencja: każdy nowy endpoint wymaga manualnego importu auth helpera (brak centralnego guard'a), pierwsza nieautoryzowana ścieżka leakneła w `/api/photos/upload` w demo dla recenzji 10xDevs. Dodatkowo: pod koniec M2, Anthropic vision call zaczął sporadycznie throttlować — paid plan Workers dał 30s CPU, ale Anthropic timeout to 60s; trzy razy `/api/photos/[id]/process` zwracał 524 (CF timeout) pomimo poprawnego JWT i ważnego zdjęcia. Naprawiono dopiero po przejściu na background pattern via Cloudflare Queue (osobny binding + $5/mo more). Pivot do Railway rozważano w M2, ale rework cost przewyższył timeline M3 demo.

### Unknown Unknowns

- **Astro #15434 jest open w momencie ship-decyzji** — dev (vite) vs prod (workerd) divergence sprawia, że bug pojawi się dopiero po pierwszym deploy'u, nie w `npm run dev`. Trudno preempt'ywnie wykryć bez `npm run preview` + smoke test produkcyjny.
- **Cloudflare panel domyślnie sugeruje "Pages with Astro framework preset"** — wrong path dla `@astrojs/cloudflare` v13. 90% tutoriali "deploy Astro to Cloudflare Pages" (2023-2025) prowadzi w ślepy zaułek. Agent czytający docs.cloudflare.com może wskazać `wrangler pages deploy`, które dla v13 setupu nie zadziała.
- **Wrangler v4 local-mode default for KV/D1/R2** zmienia model mentalny "wrangler == prod". Brak loudly-feedback'u "this went local"; pierwsza KV mutacja w lokalnej sesji nie tknie produkcyjnego KV namespace.
- **`compatibility_date >= 2024-09-23` wymagane dla Supabase SSR** — starsza data = stary runtime = brak `crypto.subtle` i podobne hidden bugi. Łatwe pominięcie jeśli `wrangler init` użyje starszego template'u.
- **Vendor incentive misalignment**: Cloudflare aktywnie pushuje Workers nad Pages (Pages still works, dev-velocity tam stagnuje). Free 100k req/day hojny, ale paid $5/mo per project — multi-project skala liniowa. BookShelf jako 1 z N projektów = $5×N/mo.

## Operational Story

- **Preview deploys**: każdy PR → GitHub Action z `cloudflare/wrangler-action@v3` (NIE `cloudflare/pages-action`!) → `wrangler versions upload` tworzy preview deployment z unikalnym URL `<version>-bookshelf.<account>.workers.dev`. Wymaga `CLOUDFLARE_API_TOKEN` w GitHub Secrets. Bez Cloudflare Access (paid feature) preview URL jest publicznie dostępny — zaakceptuj to lub dodaj basic auth w middleware preview branch.
- **Secrets**: `wrangler secret put <NAME>` ⇒ Workers Secrets (per-environment). Lokalnie: `.dev.vars` plik (ignorowany przez git). GitHub Actions: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` w GitHub Secrets. Rotation: `wrangler secret put <NAME>` (overwrite); rotacja `ANTHROPIC_API_KEY` wymaga rotacji w obu miejscach: GH Secrets (CI deploy) + Workers Secrets (runtime).
- **Rollback**: `wrangler deployments list` → wybierz deployment ID → `wrangler rollback --message "<reason>" <DEPLOYMENT_ID>`. Time-to-revert ~30s. **Caveat**: Supabase migrations NIE rollback'ują automatycznie — schema drift między rollback'ned Workers a aktualnym Postgres jest możliwy. Dla każdej zmiany schematu (migracja w `supabase/migrations/`) — zaplanuj migration plan + rollback path ZANIM zrobisz deploy.
- **Approval**: human-only przed pierwszym deploy do production worker; agent może deploy'ować preview unattended (PR-triggered) i tail logi (`wrangler tail`). Rotacja `SUPABASE_SERVICE_ROLE_KEY` ⇒ panel-only przez Supabase dashboard (drugi vendor). Drop'nięcie `bookshelf` Worker ⇒ panel-only Cloudflare dashboard.
- **Logs**: agent czyta przez `wrangler tail [--format=json]` (live stream) lub `wrangler deployments list` → log per deployment przez Cloudflare dashboard API. MCP server `observability.mcp.cloudflare.com/mcp` (beta, OAuth) eksportuje structured tools dla logs/metrics. CLI default jest tańszy kontekstowo.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Astro #15434 (middleware + nodejs_compat → `[object Object]` w prod, dev działa) uderzy w `src/middleware.ts` auth guard | Devil's advocate / Unknown unknowns | M | H | Smoke test produkcyjny po pierwszym deploy ZANIM Vision integracja: deploy basic auth-guarded shelves CRUD, sprawdź czy strony rendują poprawnie. Jeśli #15434 trafi — middleware-as-helper workaround (`src/lib/auth/guard.ts` importowane per-page) zamiast Astro middleware hook. Śledź status bug'a na `github.com/withastro/astro/issues/15434`. |
| 4 pliki w repo mają stale "Cloudflare Pages" (tech-stack.md, CLAUDE.md, plan-implementacji.md, README.md) — kierują agentów/przyszłe Ciebie w `wrangler pages deploy` (404 dla v13) | Devil's advocate / Research finding | H | M | Atomic edit: każdy z 4 plików — zamień "Cloudflare Pages" na "Cloudflare Workers" + flag w git commit message "infra: Pages → Workers per @astrojs/cloudflare v13". Robić ZANIM M1L5 CI workflow design. |
| CPU 30s wall-time wyczerpie się przy Vision retry (2× Anthropic call + Zod + Supabase) | Devil's advocate / Pre-mortem | L-M | H | Per `CLAUDE.md > Vision LLM` rule retry jest `raz`, nie pętla. Mierz koszt CPU per `/api/photos/[id]/process` od pierwszego prawdziwego wywołania (telemetria w `photos.vision_latency_ms`). Próg alarm: 25s avg → przenieś process do Cloudflare Queues + Workers background. |
| Cloudflare panel domyślnie sugeruje "Pages with Astro framework preset" przy connect-repo — łatwo pomyłkowo wybrać | Unknown unknowns | M | M | Pierwszy deploy WYŁĄCZNIE przez `wrangler deploy` z CLI (nie panel). Po pierwszym deployment workers.dev URL działa — panel pokaże Worker, nie Pages. Dokumentuj w plan-implementacji.md > komendy startowe M1. |
| Anthropic API timeout (60s) > Cloudflare CPU (30s) — vision call może zwrócić 524 nawet przy poprawnym requeście | Pre-mortem | L | H | Przed M2 — zaplanuj background pattern (Cloudflare Queues + Worker) jako fallback. Trigger: pierwszy 524 z `/api/photos/[id]/process` w prod. Materiał na osobną lekcję `/10x-lesson`. |
| Wrangler v4 local-mode default dla KV/D1/R2 → mutacje idą do `.wrangler/state/` zamiast prod, bez głośnego feedback'u | Devil's advocate / Unknown unknowns | L (MVP), H (post-MVP cache) | M | Dziś niewykorzystywane (Supabase = oddzielny DB). Jeśli kiedyś dorzucisz Cloudflare KV jako cache dla Google Books — dodaj `--remote` do każdej KV command + zrób `wrangler kv:key list --remote` jako sanity check po mutation. |
| Cloudflare paid $5/mo per project skali liniowo — multi-project = $5×N/mo, łatwo nie zauważyć eskalacji | Unknown unknowns | M (długoterminowo) | L | BookShelf to dziś 1 z 1 projektów. Re-evaluuj jeśli liczba Workers w tym account przekroczy 3. |
| Railway/Fly.io przejście post-MVP wymaga `@astrojs/node` swap + ewentualnie Dockerfile — non-trivial rework | Research finding | L | M | Trzymaj `src/lib/db/`, `src/lib/vision/`, `src/lib/matching/` framework-agnostic (TypeScript, brak Cloudflare-specific imports). Tylko `src/middleware.ts` i `wrangler.jsonc` są Cloudflare-bound. To czyni runner-up swap jednodniową robotą, nie tygodniową. |

## Getting Started

Komendy zweryfikowane dla obecnego pinned stacku (Astro 6.3.5, `@astrojs/cloudflare` 13.5.2, wrangler 4.93.0, Node 22.12.0). Skróty 10x-cli'owe zamiast generic tutorials.

1. **Stwórz Cloudflare API token** (panel.cloudflare.com → My Profile → API Tokens → Create Token). Use template "Edit Cloudflare Workers" + add "Account: Pages Read" (dla deployments list). Skopiuj token + ACCOUNT_ID. Zapisz w `.dev.vars` lokalnie i GitHub Secrets jako `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. **NIE używaj** Global API Key.

2. **Wygeneruj `wrangler.jsonc`** (jeśli jeszcze nie ma; ten projekt już ma). Sprawdź że ma:
   ```jsonc
   {
     "$schema": "node_modules/wrangler/config-schema.json",
     "name": "bookshelf",
     "main": "./dist/_worker.js/index.js",
     "compatibility_date": "2025-01-01",
     "compatibility_flags": ["nodejs_compat"],
     "assets": { "directory": "./dist", "binding": "ASSETS" }
   }
   ```
   `compatibility_date >= 2024-09-23` jest wymagany dla Supabase SSR (dostęp do `crypto.subtle`).

3. **Pierwszy deploy z CLI** (przed wpięciem CI, nie przez panel):
   ```powershell
   npm run build
   npx wrangler deploy
   ```
   `npx wrangler deploy` dla `@astrojs/cloudflare` v13 — **NIE** `wrangler pages deploy` (Pages support wycofany w v13). Output: `https://bookshelf.<account>.workers.dev`.

4. **Smoke test #15434** (przed Vision integracją!):
   ```powershell
   # Lokalnie z workerd, nie tylko vite:
   npx wrangler dev --remote
   # Otwórz http://localhost:8787, sprawdź czy strony rendują tekst, nie `[object Object]`.
   # Jeśli stack zawiera już `src/middleware.ts` — sprawdź po przebudowaniu i deployment.
   ```

5. **CI workflow w M1L5** użyje `cloudflare/wrangler-action@v3` (NIE `cloudflare/pages-action`):
   ```yaml
   - uses: cloudflare/wrangler-action@v3
     with:
       apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
       accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
       command: deploy
   ```

## Migration note: Pages → Workers files to update

Czyste sumy linii do edycji w osobnym atomic commit przed M1L5:

- `context/foundation/tech-stack.md` — `hints.deployment_target: cloudflare-pages` → `cloudflare-workers`.
- `CLAUDE.md` — Stack table row `| Deployment | Cloudflare Pages |` → `Cloudflare Workers`.
- `docs/plan-implementacji.md` — komendy startowe step 7 ("CF Pages → Connect to Git, framework preset = Astro") → `wrangler deploy` z CLI.
- `README.md` — Stack table row `| Deployment | Cloudflare Pages |` → `Cloudflare Workers`.

## Out of Scope

Następujące **nie były** ewaluowane w tym research:

- **Docker image configuration** (irrelevant dla Workers; relevant gdyby swap'nąć na Fly.io).
- **CI/CD pipeline setup** — `.github/workflows/{ci,deploy}.yml` planowane w M1L5; ten dokument tylko wskazuje properscope command'ów (`wrangler deploy`, nie `pages deploy`).
- **Multi-region failover / HA / SLA commitments** — single-user MVP, brak dependancji na Cloudflare-wide outage planning.
- **Cloudflare Access / Zero Trust** dla preview URL gatingu — paid feature, post-MVP consideration jeśli demo dla 10xDevs reviewer'ów ma być prywatne.
- **Cloudflare Queues / Durable Objects / D1** — paid bindings dla Vision background pattern jeśli CPU 30s wyczerpie się; ujęte w risk register jako trigger, nie zaplanowane teraz.
