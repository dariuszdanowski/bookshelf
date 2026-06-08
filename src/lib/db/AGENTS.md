# Cloudflare adapter — env (server vs browser)

Szczegóły wyniesione z `CLAUDE.md § Cloudflare adapter` (root trzyma tylko TL;DR + regułę repo-wide).

Output `server` z `@astrojs/cloudflare` — endpointy w `src/pages/api/**.ts` działają jak Workers, nie Node. **Brak `process.env`** w runtime.

## Env reading — server vs browser

Dwa różne kanały. Nigdy ich nie miksuj.

- **Server-side** (Astro SSR, middleware, endpointy `src/pages/api/`): czytaj env z `'cloudflare:workers'` virtual module — `import { env } from 'cloudflare:workers'`. Canonical Astro v6+ pattern; `Astro.locals.runtime.env` zostało **usunięte w Astro v6**. Single source of truth: [supabase.server.ts](supabase.server.ts) — `env?.X ?? import.meta.env.X` (runtime first, fallback do build-time dla Vitest / dev compat).
- **Browser-side** (React islands, [supabase.browser.ts](supabase.browser.ts)): czytaj env wyłącznie przez `import.meta.env.PUBLIC_*` — Vite inline'uje wartości na build-time. Browser bundle nie ma access do `cloudflare:workers` (to server-only).

## Env wiring — gdzie ustawiać sekrety

| Kanał | Konfiguracja | Co tam idzie |
| --- | --- | --- |
| **Worker Dashboard Secrets** (runtime, server) | `wrangler secret put NAME` lub Cloudflare Dashboard → Worker → Settings → Variables and Secrets | Wszystkie 4 secrets: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` |
| **GitHub Repository Secrets** (build-time, dla browser bundle) | GitHub → Settings → Secrets and variables → Actions; konsumowane w `.github/workflows/deploy.yml` `env:` block w step Build | TYLKO `PUBLIC_*` (PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY). **Nigdy** `SERVICE_ROLE_KEY` ani `ANTHROPIC_API_KEY` — server-only, browser bundle ich nie dostaje |
| **`.dev.vars`** (Astro dev, lokalnie) | Plain `KEY=value` w `.dev.vars` (gitignored); parsowane przez `@astrojs/cloudflare` adapter | Wszystkie sekrety potrzebne lokalnie — automatycznie wstawiane do Vite `import.meta.env` + `cloudflare:workers` `env` |

## Env matrix — gdzie czego się czyta i jak to setup'ujesz

| Środowisko | Server: skąd `env` | Browser: skąd `import.meta.env.PUBLIC_*` | Setup |
| --- | --- | --- | --- |
| **Prod CF Workers** | `'cloudflare:workers'` virtual module (Worker Dashboard Secrets) | Inlined przez Vite z `env:` w `deploy.yml` (GitHub Repository Secrets) | Worker Secrets via `wrangler secret put` + GitHub Repo Secrets |
| **Astro dev (`npm run dev`)** | `'cloudflare:workers'` env (z `.dev.vars` via @cloudflare/vite-plugin) lub fallback `import.meta.env` (z `.dev.vars` via @astrojs/cloudflare adapter) | `import.meta.env` z `.dev.vars` | Tylko `.dev.vars` |
| **Vitest** | `'cloudflare:workers'` stub w `vitest.config.ts` (`env: {}`) → fallback `import.meta.env`; per-test `vi.mock('cloudflare:workers', () => ({ env: {...} }))` | `import.meta.env` z `.env*` / `vi.stubEnv` | Stub w `vitest.config.ts` plus per-test `vi.mock` / `vi.stubEnv` |

## Typowanie secrets

`Cloudflare.Env` augmentowane w [src/env.d.ts](../../env.d.ts) przez `declare namespace Cloudflare { interface Env { ... } }`. Wrangler typegen (`worker-configuration.d.ts`) NIE wie o runtime secrets — generuje tylko `ASSETS: Fetcher`. Nowe sekrety dorzucaj do tej extension (single source of truth dla typów `env` z `'cloudflare:workers'`).

## Inne

- `worker-configuration.d.ts` jest generowany (`npm run generate-types`) — nie edytuj ręcznie i nie commituj zmian wynikających z lokalnego dev runu, jeśli nie zmieniałeś `wrangler.jsonc`.
- Lokalny dev używa Vite (nie miniflare) — niektóre Workers-only API (np. `caches.default`) trzeba testować dopiero przez `npm run preview`.
