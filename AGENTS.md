# Repository Guidelines

BookShelf Catalog — cataloging app: shelf photo → vision-LLM detects titles → match against Google Books/OpenLibrary → user confirms. Stack: Astro 6 SSR + React 19 islands + TypeScript strict + Tailwind 4 + Cloudflare Workers (`@astrojs/cloudflare` v13) + Supabase (Postgres + RLS + Storage) + Anthropic Claude Sonnet 4.6.

## Hard rules (do not break)

- **RLS on every table.** `user_id = auth.uid()` policy from day one; never ship a migration without one. Pattern: `@supabase/migrations/0002_rls_policies.sql`.
- **API error shape is fixed.** Success: `{ data }`. Failure: `{ error: { code, message } }` with `code` in `SCREAMING_SNAKE_CASE`. Always set `Cache-Control: private, no-store`. Return `404` for both "not found" and "owned by another user" — never reveal existence. Check `401` before resource fetch. `export const prerender = false` on every dynamic endpoint.
- **No `any` in TypeScript.** Use `unknown` + narrowing. Every external I/O (LLM, API, form) goes through a Zod schema with `z.infer<>` types.
- **Vision retry exactly once.** On Zod parse fail, retry with `thinking: { type: 'enabled' }`. Second fail → insert `corrections` row (`correction_type: 'parse_failure'`) and abort. No Opus escalation in M1.
- **Deploy Workers, not Pages.** `npx wrangler deploy`, never `wrangler pages deploy`. CI uses `cloudflare/wrangler-action@v4`, not `cloudflare/pages-action` (`@astrojs/cloudflare` v13 dropped Pages).
- **ESLint pinned at v9.** `eslint-plugin-react@7.x` peer is `eslint <=^9`. Do not bump ESLint without swapping the React plugin.

## Project structure

`src/pages/` Astro pages + `/api/` endpoints; `src/components/` React islands; `src/lib/{vision,books,matching,db,auth}/` domain; `src/middleware.ts` auth guard; `supabase/migrations/`; `tests/{unit,e2e}/`; `context/foundation/` hand-offs; `docs/`. Server pages `.astro`; interactive `.tsx` with `client:load`/`client:visible`.

## Commands

- `npm run dev` — Astro dev server (Vite, not workerd) at `:4321`
- `npm run build && npx wrangler deploy` — production deploy
- `npm run typecheck` — `astro check`
- `npm run test` / `npm run test:e2e` — Vitest / Playwright (first e2e run: `npx playwright install --with-deps`)
- `npm run lint` / `npm run format` — ESLint v9 flat config / Prettier
- `npm run generate-types` — regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc`

## Conventions

Matching score thresholds: `≥0.75` auto-checked in UI; `0.55-0.75` user confirms; `<0.55` manual entry + `corrections` row. Typed Supabase clients at `src/lib/db/supabase.{server,browser}.ts` — server client is RLS-respecting (anon key + user JWT from cookies), **not** service-role. Service-role is not a default data path and lives outside `src/lib/db/` — only narrow privileged routes if/when they arise. Single vision-prompt source: `src/lib/vision/prompt.ts`. Lint/format config: `@eslint.config.mjs`, `@.prettierrc.json`.

## Commits & PRs

History mixes Polish prose with light Conventional Commits prefixes (`fix(scope):`, `infra:`, `docs:`, `chore:`). PRs target `main` (branch-per-change: `change/<id>`). `.github/workflows/` wired: `ci.yml` (job `verify`: lint + typecheck + vitest + build; job `e2e`: Playwright on ephemeral local Supabase — on PR/push), `deploy.yml` (build + deploy to CF Workers + post-deploy `/api/health` smoke on push to main). Run `npm run lint && npm run typecheck && npm run test` locally before pushing.

## Deeper context

`@CLAUDE.md` (full rule set), `@docs/prd.md` (schema + scoring formulas), `@docs/plan-implementacji.md` (milestone calendar), `@context/foundation/infrastructure.md` (deploy operations + risk register), `@context/deployment/deploy-plan.md` (current deploy state).
