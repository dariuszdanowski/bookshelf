# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# BookShelf Catalog — kontekst dla agenta

## Czym jest projekt

Aplikacja webowa do katalogowania książek na podstawie zdjęć półek. Użytkownik fotografuje półkę, system rozpoznaje tytuły przez vision-LLM, matchuje je z bazą zewnętrzną (Google Books / OpenLibrary), wykrywa duplikaty względem istniejącego katalogu i proponuje wpisy z lokalizacją (półka, pozycja); użytkownik akceptuje / odrzuca / koryguje, a system rejestruje korekty do telemetrii.

**Projekt zaliczeniowy 10xDevs 3.0** (start kursu 18.05.2026, 1. termin oddania 5.07.2026).

## Logika biznesowa w jednym zdaniu

Vision-detekcja → matching scoring → deduplikacja → ranking propozycji → potwierdzenie użytkownika → telemetria korekt.

Pięć decyzji domenowych: (1) detekcja z obrazu, (2) scoring matchu z bazą zewnętrzną, (3) deduplikacja vs istniejący katalog, (4) ranking propozycji, (5) telemetria akceptacji.

## Stack

| Warstwa | Wybór |
|---|---|
| Meta-framework | Astro 6 (SSR) |
| UI | React 19 (islands) |
| Typy | TypeScript strict |
| Style | Tailwind 4 |
| Backend | Astro endpoints (`src/pages/api/`) |
| Auth | Supabase Auth (email/password + opcjonalnie Google OAuth) |
| DB | Supabase Postgres + RLS |
| Storage | Supabase Storage (bucket `photos/`) |
| Vision LLM | Claude Sonnet 4.6 (multimodal) — bezpośrednio przez Anthropic API |
| Walidacja LLM I/O | Zod schemas |
| Book metadata | Google Books API (primary) + OpenLibrary (fallback) |
| Deployment | Cloudflare Pages |
| Test framework | Vitest (unit) + Playwright (E2E) |
| CI | GitHub Actions |

**Match z kursowym stackiem: 8/8.**

## Komendy

Wymagania: **Node.js ≥ 22.12.0** (`engines.node` w `package.json`).

| Komenda | Co robi |
|---|---|
| `npm run dev` | Dev server na `http://localhost:4321/` z HMR |
| `npm run build` | Produkcyjny build (`dist/`) pod Cloudflare Pages |
| `npm run preview` | Preview produkcyjnego buildu lokalnie (wrangler) |
| `npm run typecheck` | `astro check` — typy w `.astro` + `.ts/.tsx` (substytut `tsc --noEmit`) |
| `npm run test` | Vitest run (jsdom, `tests/unit/**`) |
| `npm run test:watch` | Vitest w trybie watch |
| `npm run test:coverage` | Vitest run + raport pokrycia v8 (`coverage/`) |
| `npm run test:e2e` | Playwright run (`tests/e2e/**`); wymaga jednorazowego `npx playwright install --with-deps` |
| `npm run lint` | ESLint na całym repo (flat config, ESLint v9) |
| `npm run lint:fix` | ESLint z autofixem |
| `npm run format` | Prettier `--write .` (plugin Astro + Tailwind) |
| `npm run format:check` | Prettier `--check .` |
| `npm run astro -- add <integration>` | Dodanie integracji (np. `mdx`, `sitemap`) |
| `npm run generate-types` | Regeneracja `worker-configuration.d.ts` z bindings Cloudflare (po zmianie `wrangler.jsonc`) |

> **Pojedynczy test (Vitest):** `npx vitest run tests/unit/health.test.ts` (po ścieżce) lub `npx vitest -t "fragment nazwy"` (po nazwie).
> **Pojedynczy spec (Playwright):** `npx playwright test tests/e2e/smoke.spec.ts` lub `npx playwright test -g "fragment"`. Wymaga uprzedniego `npx playwright install --with-deps` (~600 MB binariów przeglądarki — **nie** wciągane przez zwykłe `npm install`).

## Cloudflare adapter — specyfika

- Output `server` z `@astrojs/cloudflare` — endpointy w `src/pages/api/**.ts` działają jak Workers, nie Node.
- **Brak `process.env`** w runtime. Secrety czytaj z `Astro.locals.runtime.env` (server-side); zmienne `PUBLIC_*` są inlinowane przez Vite na build-time.
- `worker-configuration.d.ts` jest generowany (`npm run generate-types`) — nie edytuj ręcznie i nie commituj zmian wynikających z lokalnego dev runu, jeśli nie zmieniałeś `wrangler.jsonc`.
- Lokalny dev używa Vite (nie miniflare) — niektóre Workers-only API (np. `caches.default`) trzeba testować dopiero przez `npm run preview`.

## Architektura — schemat

```
Browser (React 19 islands) ─→ Astro SSR (Cloudflare Pages)
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
       Supabase Auth         Supabase Postgres      Supabase Storage
       (JWT + sesja)         (z RLS na user_id)     (zdjęcia półek)
                                   │
                                   ▼
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
       Anthropic API          Google Books API        OpenLibrary API
       (Sonnet 4.6 vision)    (primary metadata)      (fallback)
```

## Model danych (Postgres)

8 tabel z RLS na `user_id = auth.uid()`:

- `profiles` (id FK auth.users, display_name)
- `shelves` (user_id, name, location, position_index)
- `photos` (user_id, shelf_id, storage_path, status, vision_cost_usd, vision_latency_ms)
- `detections` (photo_id, position_index, raw_title, raw_author, vision_confidence, status)
- `book_candidates` (detection_id, source, external_id, title, authors, isbn_*, match_score, rank)
- `books` (user_id, isbn_*, title, authors, source, source_external_id) — confirmed catalog
- `shelf_entries` (book_id, shelf_id, position_index, photo_id, detection_id, is_current)
- `corrections` (user_id, detection_id, original_raw_title, corrected_title, correction_type)

Pełny SQL: [docs/prd.md](docs/prd.md#schemat-danych).

## Struktura katalogów

```
bookshelf/
├── src/
│   ├── pages/              # Astro pages + /api/ endpoints
│   ├── components/         # React islands (PhotoUploader, DetectionReview, BookCard...)
│   ├── lib/
│   │   ├── vision/         # klient Anthropic + prompt + Zod schema
│   │   ├── books/          # Google Books + OpenLibrary klienci + reconcile
│   │   ├── matching/       # score, dedupe, isbn
│   │   ├── db/             # Supabase typed clients (server/browser)
│   │   └── auth/           # middleware guard
│   ├── middleware.ts
│   └── env.d.ts
├── supabase/
│   ├── migrations/         # SQL migrations
│   └── seed.sql
├── tests/
│   ├── unit/               # Vitest
│   ├── integration/
│   └── e2e/                # Playwright (z mock vision-response)
├── .github/workflows/
│   ├── ci.yml              # lint + typecheck + tests
│   └── deploy.yml          # build + deploy CF Pages
├── docs/
│   ├── prd.md              # PRD modułu (artefakt M1)
│   └── plan-implementacji.md
├── context/
│   └── foundation/
│       ├── prd.md          # foundation PRD (hand-off /10x-prd → /10x-tech-stack-selector)
│       ├── tech-stack.md   # locked stack pick (hand-off → /10x-bootstrapper, /10x-infra-research)
│       └── health-check.md # raport stanu projektu (re-genowany /10x-health-check)
├── eslint.config.mjs       # ESLint v9 flat config
├── vitest.config.ts        # Vitest config (jsdom + setupFiles)
├── playwright.config.ts    # Playwright config (chromium + webServer)
├── .prettierrc.json
├── .prettierignore
├── .editorconfig
├── CLAUDE.md               # ten plik
└── README.md
```

## Konwencje

### TypeScript
- `strict: true` — nie obniżać
- Brak `any` — używaj `unknown` + narrowing
- Zod schemas dla każdego external I/O (LLM responses, API responses, form inputs)
- Inferowanie typów z Zod: `type Foo = z.infer<typeof FooSchema>`

### Astro / React
- **Server pages** w Astro (`.astro`) — SSR, auth guard, data fetch
- **Interactive views** w React (`.tsx`) — `client:load` / `client:visible` islands
- Granica jasna: jeśli komponent nie ma stanu interakcji, zostaje Astro

### Supabase
- **RLS od pierwszego dnia** — każda tabela ma policy `user_id = auth.uid()`
- Typed client: `supabase.server.ts` (service role, tylko w API endpoints) i `supabase.browser.ts` (anon key)
- Migracje wersjonowane w `supabase/migrations/`

### Vision LLM
- Single source of truth dla promptu: `src/lib/vision/prompt.ts`
- Output **zawsze** walidowany przez Zod (`DetectionSchema`)
- Jeśli model zwróci śmieci → retry z `extended_thinking`, eskalacja do Opus tylko w MVP+
- Każda detekcja persistowana **przed** matchingiem (idempotencja przy retry)

### Matching
- Próg `match_score >= 0.75` = wysoka jakość, pre-zaznaczone w UI
- `0.55 - 0.75` = średnia, user musi potwierdzić
- `< 0.55` = brak matchu, użytkownik wpisuje ręcznie → record w `corrections`

### Testy
- **Vitest** dla unit: matching, dedupe, isbn validation, vision response parsing. Config: `vitest.config.ts` (jsdom env, setup w `tests/unit/setup.ts`, coverage v8).
- **Playwright** dla E2E: jeden golden path (`tests/e2e/upload-flow.spec.ts`) z **mock** vision-response. Config: `playwright.config.ts` (chromium project, `webServer` startuje `npm run dev` na :4321).
- Real vision tylko w manualnym smoke test (nie w CI — flaky + drogi).
- Browser binaries Playwrighta **nie są** wciągane przez `npm install` — pierwszy `npm run test:e2e` na świeżej maszynie wymaga `npx playwright install --with-deps`.

### Lint / format
- **ESLint** w flat config (`eslint.config.mjs`): `@eslint/js` + `typescript-eslint` + `eslint-plugin-react` + `eslint-plugin-react-hooks` + `eslint-plugin-astro` + `eslint-config-prettier`.
- **ESLint pinowany na v9** — `eslint-plugin-react@7.x` deklaruje peer `eslint: <=^9`. Bump do v10 dopiero po release'ie `eslint-plugin-react@8` lub po migracji na `@eslint-react/eslint-plugin`. Nie odpalaj `npm i eslint@latest` bez planu zamiany pluginu.
- **Prettier** z `prettier-plugin-astro` + `prettier-plugin-tailwindcss`. Tailwind plugin sortuje klasy automatycznie — nie układaj ich ręcznie.
- `eslint-config-prettier` musi zostać ostatnim wpisem w `eslint.config.mjs` (wyłącza reguły kolidujące z formaterem).

### CI
- GitHub Actions: lint + typecheck + vitest + playwright + deploy CF Pages
- Sekrety: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN` w GitHub Secrets

## Decyzje świadomie odsunięte (NIE w MVP)

- Mobile app / PWA / camera capture w przeglądarce — desktop upload wystarczy
- Batch upload wielu zdjęć — pętla pojedyncza w MVP
- Skanowanie ISBN czytnikiem kodów kreskowych
- Rekomendacja co przeczytać / podobne książki
- Wypożyczanie / dziennik czytania / oceny
- Eksport CSV/JSON
- Shared shelves między userami
- Integracja z lubimyczytac jako źródło danych (tylko deep-link do strony książki)
- Offline mode / PWA cache
- Image cropping w UI

## Status

Aktualny, regenerowalny obraz stanu projektu (audit zależności + test runner + CI + braki configów): [@context/foundation/health-check.md](context/foundation/health-check.md). Regeneracja: `/10x-health-check`. Sekcja "Struktura katalogów" wyżej opisuje cel, nie obecny stan — wiele podkatalogów `src/lib/`, `supabase/migrations/`, `.github/workflows/` to jeszcze puste foldery.

## Najbliższe kroki

Aktualny milestone: **M1 — schema + upload + vision (deadline 31.05.2026)**. Pełny kalendarz milestonów, ryzyka i definition-of-done: [@docs/plan-implementacji.md](docs/plan-implementacji.md). Schemat danych do migracji: [@docs/prd.md#schemat-danych](docs/prd.md#schemat-danych).

> ⚠ **Firewall korporacyjny** (zob. memory): `github.com/releases` jest blokowany, więc instalacja Supabase CLI z binarki padnie na ETIMEDOUT. Używać tunelu / VPN albo wersji npm.

## Kontekst zewnętrzny

- Pełna analiza projektu (poza tym repo): `c:\Projekty\10xDevs\analiza-projektu-bookshelf.md`
- Porównanie z innymi kandydatami: `c:\Projekty\10xDevs\porownanie-projektow.md`
- Wymogi certyfikacji 10xDevs 3.0: `c:\Projekty\10xDevs\analiza-projektu-kursowego.md` sekcja 1
- Prework: `c:\Projekty\10xDevs\prework\`

Te pliki **nie są** częścią projektu kursowego (nie commituj ich tu) — to prywatny meta-kontekst decyzyjny.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit — Module 1, Lesson 5

Pick a deployment platform and ship to production with the **infra chain**:

```
(/10x-init  →  /10x-shape  →  /10x-prd  →  /10x-tech-stack-selector  →  /10x-bootstrapper  →  /10x-agents-md  →  /10x-rule-review  →  /10x-lesson)  →  /10x-infra-research  →  Plan Mode deploy
```

The full Module 1 chain ships from Lessons 1–4 (re-included so you can fix any earlier contract mid-flight). `/10x-infra-research` is the lesson's main topic; the deploy step itself uses the host's built-in **Plan Mode** rather than a dedicated skill — the artifact (`context/deployment/deploy-plan.md`) is what carries forward.

### Task Router — Where to start

| Skill | Use it when |
| --- | --- |
| **Infrastructure (lesson focus)** | |
| `/10x-infra-research [path-to-tech-stack-or-prd]` | You have a `context/foundation/tech-stack.md` (and ideally a `prd.md`) and need to pick an MVP deployment platform. The skill loads the stack as a hard constraint, runs a 5-question developer interview (persistent connections, cost sensitivity, existing familiarity, global reach, co-location preference), spawns parallel subagent research across six candidate platforms, scores them Pass/Partial/Fail across the five agent-friendly criteria from `references/agent-friendly-criteria.md`, shortlists the top three, and runs a three-lens anti-bias cross-check on the leader (devil's advocate, pre-mortem, unknown unknowns) before writing `context/foundation/infrastructure.md`. Use AFTER `/10x-tech-stack-selector`, BEFORE `/10x-implement`. |
| **Deploy (host built-in, not a skill)** | |
| Plan Mode deploy | You have `infrastructure.md` + `tech-stack.md` and want a read-only plan reviewed before any mutation hits the platform. Activate the host's plan mode (Claude Code: `Shift+Tab` cycles default → auto-accept → plan; IDE: dedicated button) with the prompt "Wykonajmy pierwsze wdrożenie w oparciu o `@infrastructure.md`, zgodnie ze stackiem z `@tech-stack.md`". Read the plan, demand corrections, approve, then let the agent execute. The approved plan persists at `context/deployment/deploy-plan.md` so the next lesson's milestone planning can reference what's already deployed and which secrets are already wired. |
| **Re-run upstream if needed** | |
| `/10x-init` / `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-rule-review` / `/10x-lesson` / `/10x-stack-assess` / `/10x-health-check` | Bundled so you can patch any earlier contract mid-flight. If the anti-bias cross-check forces a platform swap that pushes a stack-shaped decision (e.g. "this DB doesn't fit any platform we'd accept"), re-run `/10x-tech-stack-selector` to keep `tech-stack.md` and `infrastructure.md` aligned. |

### How the chain hands off

- `/10x-infra-research` reads `context/foundation/tech-stack.md` (language, framework, runtime, database) as **hard constraints** — platforms that can't run the stack are dropped before scoring. It also reads `context/foundation/prd.md` (scale, latency, uptime expectations) as **soft weights** when scoring. Both inputs are optional but strongly recommended; without them the skill proceeds but warns.
- The skill writes `context/foundation/infrastructure.md` as the third foundation contract: frontmatter (`project`, `researched_at`, `recommended_platform`, `runner_up`, `context_type`, `tech_stack`) plus a body covering recommendation, full platform comparison with scoring matrix, anti-bias findings, operational story (preview / secrets / rollback / approval / logs), and a risk register tying every entry back to the lens that surfaced it. On collision the skill prompts: overwrite, save as `infrastructure-v2.md`, or abort.
- Plan Mode reads `infrastructure.md` and `tech-stack.md` together. The agent emits a step-by-step plan covering automated steps it owns, manual setup gates (account creation, secret configuration), exact deploy commands (Pages vs Workers commands are NOT interchangeable on Cloudflare — the plan must specify), and verification steps. The plan is rejected/edited until it's right; only then does Plan Mode exit and execution begin. The approved plan lands at `context/deployment/deploy-plan.md` and is consumed downstream by milestone-planning skills as ground truth for "what's already deployed".

### What the lesson's skills capture (and what they do NOT)

- **`/10x-infra-research` captures**: platform shortlist scored against five agent-friendly criteria (CLI quality, managed/serverless degree, agent-readable docs, stable/scriptable deploy API, MCP or first-class agent integration), three anti-bias outputs on the leader (numbered weaknesses, 150–200-word failure narrative, 3–5 unknown-unknowns), an operational story with one concrete answer per axis (not categories), and a risk register where every row names its source lens (`Devil's advocate` / `Pre-mortem` / `Unknown unknowns` / `Research finding`). Status of every non-GA feature is captured inline (`beta` / `preview` / `region-limited` / `deprecated`) with the date the status was checked.
- **`/10x-infra-research` does NOT** build Docker images or write Dockerfiles, configure CI/CD pipelines, or plan beyond MVP scope (multi-region HA is explicitly out of scope). It does NOT decide for you — the user accepts, swaps to runner-up, or aborts after the cross-check, and that decision is recorded in the output.
- **Plan Mode** captures: an explicit human gate between "agent has a plan" and "agent mutates production". The artifact (`deploy-plan.md`) is the audit trail for "what was supposed to happen" when the live run goes sideways. Plan Mode does NOT replace `/10x-infra-research` (the platform decision must already be made — Plan Mode plans the deploy, it doesn't pick where to deploy).

### The five agent-friendly criteria (and why they're load-bearing)

The criteria that make `/10x-infra-research`'s scoring matrix are not generic "good platform" axes — they're the specific traits that determine whether an agent can operate this platform from a session without you holding its hand:

1. **CLI-first** — every routine operation has a documented command; the agent doesn't need to click in a panel.
2. **Managed / serverless** — fewer moving pieces means fewer ways the agent (or you) breaks something the platform was supposed to handle.
3. **Agent-readable docs** — markdown / `llms.txt` / GitHub-hosted docs the agent can fetch and parse, not JS-rendered marketing pages.
4. **Stable, scriptable deploy API** — predictable exit codes, structured output, no interactive prompts mid-deploy.
5. **MCP server or first-class agent integration** — bonus, not required. CLI alone is fine for MVP; MCP earns its keep when the agent makes dozens of structured queries against live state.

Hard filters apply before scoring (persistent-connection requirement drops Netlify/Vercel serverless-only; tech-stack runtime mismatch drops the platform entirely). Interview answers reweight criteria after — cost sensitivity penalizes expensive base tiers, familiarity breaks ties, global-reach preference favours edge-native platforms, co-location preference favours integrated databases.

### Anti-bias as a decision discipline (not theatre)

Every research conversation with an LLM has a built-in tilt toward whatever the user already signalled. `/10x-infra-research` runs three structured lenses against the leader BEFORE the file is written, not after:

- **Devil's advocate** — *find the weaknesses, hidden costs, and failure modes specific to deploying `<this stack>` on `<this platform>`*. Output is a numbered list of 3–5 specifics, not categories.
- **Pre-mortem** — *six months later, this decision turned out to be a complete disaster; walk through the assumptions and underestimated risks that led there*. Output is a 150–200-word narrative; narratives surface concrete failure shapes that abstract risk lists hide.
- **Unknown unknowns** — *what's true about this combination that the marketing page and docs don't make obvious?* Output is 3–5 non-obvious risks.

After the cross-check the user has three real options: **proceed with the leader and absorb the risks into the register**, **swap to runner-up** (and re-run the cross-check on the new leader), or **swap to third place**. The third option is rare; if it never happens across many runs, the cross-check has degraded into a ritual and should be rewritten.

Two additional techniques (no skill required, raw prompts) belong in the same toolbox: forcing the model to compare three alternatives in a markdown table (structure beats "the same answer in different words"), and role-rotation (the same decision through a frontend dev's, security person's, and cost owner's eyes — surface the cost each role pays and propose alternatives if any of them flinch).

### CLI vs MCP for live-infra operability

After deploy, the agent needs a way to talk to the running platform. Two paths, complementary not competing:

- **CLI** (`wrangler`, `flyctl`, `vercel`, `gh`) — explicit and auditable, output stays in the terminal, safer defaults for irreversible actions (e.g. `netlify deploy` is draft by default; `--prod` must be passed). Best for MVP: minimal setup, low context cost (no tool schemas pre-loaded), and the agent has to know the command (which is where a per-tool skill helps).
- **MCP** — a dedicated server exposing structured tools with schemas (`pages_deployments_list`, etc.). Each connected MCP server adds tool definitions to the context window, so cost compounds across servers. Earns its keep when the agent makes many discovery-style queries against live state (logs, deployment diffs) and structured JSON beats parsing CLI output.

Sensible default: start with CLI, add MCP when you notice a recurring pattern of `--help` traversal the agent has to do to answer a class of questions. Anthropic's own [building-agents-that-reach-production](https://claude.com/blog/building-agents-that-reach-production-systems-with-mcp) framing is "API, CLI, and MCP are three complementary paths" — pick by task, not by hype.

### Production-access boundary (minimal permissions, human-on-irreversibles)

Both CLI and MCP can give the agent direct access to production. The lesson sets a default posture:

- **Tokens are scoped, not master keys.** On Cloudflare: an API token limited to Pages or Workers for one project, no DNS, no Workers Secrets for unrelated projects, no billing. AWS / GCP equivalent: scoped IAM role with `console-only-user` or read-only on production, full access on staging.
- **Tokens live in env vars, not in `.mcp.json` committed to the repo.** The agent picks them up via the MCP server or CLI's env-discovery, not via plaintext in conversation.
- **Destructive actions are human-only.** Drop a database, rotate a primary secret, delete a project — those are panel-by-hand operations, even if the agent suggests them. Manual click costs 30 seconds; cleanup after an automated mistake costs hours.

This is the MVP posture. As the project matures, the natural evolution is staging gets full agent access, production becomes read-only — covered in later modules.

### Foundation paths used by this lesson

- `context/foundation/tech-stack.md` — input (Lesson 2 hand-off, hard constraints)
- `context/foundation/prd.md` — input (Lesson 1 hand-off, soft weights)
- `context/foundation/infrastructure.md` — output (the third foundation contract)
- `context/deployment/deploy-plan.md` — output of Plan Mode deploy (audit trail of "what was supposed to happen")
- `context/foundation/lessons.md` — recurring rules & pitfalls (use `/10x-lesson` from Lesson 4 if you spot a class of agent failure during research or deploy)
- `docs/reference/contract-surfaces.md` — load-bearing names registry

### Universal language

The shipped skill carries no 10xDevs / cohort / certification references. The candidate platform list (Cloudflare, Vercel, Netlify, Fly.io, Railway, Render) is the starting research lens, not a recommendation set — the scoring + interview + cross-check pipeline is what's load-bearing, and a platform absent from the default list can be added by extending the research step. The five agent-friendly criteria are the artifact's true core; `/10x-infra-research` re-reads them from `references/agent-friendly-criteria.md` so they evolve as platforms do.

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
