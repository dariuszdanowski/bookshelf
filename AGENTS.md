# Repository Guidelines

BookShelf Catalog — cataloging app: shelf photo → vision-LLM detects titles → match against Google Books/OpenLibrary → user confirms. Stack: Astro 6 SSR + React 19 islands + TypeScript strict + Tailwind 4 + Cloudflare Workers (`@astrojs/cloudflare` v13) + Supabase (Postgres + RLS + Storage) + Anthropic Claude Sonnet 4.6.

## Hard rules (do not break)

- **RLS on every table.** `user_id = auth.uid()` policy from day one; never ship a migration without one. Pattern: `supabase/migrations/0002_rls_policies.sql`.
- **API error shape is fixed.** Success: `{ data }`. Failure: `{ error: { code, message } }` with `code` in `SCREAMING_SNAKE_CASE`. Always set `Cache-Control: private, no-store`. Return `404` for both "not found" and "owned by another user" — never reveal existence. Check `401` before resource fetch. `export const prerender = false` on every dynamic endpoint.
- **No `any` in TypeScript.** Use `unknown` + narrowing. Every external I/O (LLM, API, form) goes through a Zod schema with `z.infer<>` types.
- **Vision retry exactly once.** On Zod parse fail, retry with `thinking: { type: 'enabled' }`. Second fail → insert `corrections` row (`correction_type: 'parse_failure'`) and abort.
- **Deploy Workers, not Pages.** `npx wrangler deploy`, never `wrangler pages deploy`. CI uses `cloudflare/wrangler-action@v4`. `@astrojs/cloudflare` v13 dropped Pages.
- **ESLint pinned at v9.** `eslint-plugin-react@7.x` peer is `eslint <=^9`. Do not bump ESLint without swapping the React plugin.
- **Migration numbering.** Before creating `supabase/migrations/NNNN_*.sql`, check the highest existing number on `main` (`git ls-tree origin/main supabase/migrations/ | sort`), not on the working branch — parallel branches can pick the same number and cause `schema_migrations` duplicate-key errors in CI.
- **UI confirmations use React modal.** Never `window.confirm/alert/prompt` — use the `ConfirmDialog` component (`src/components/ConfirmDialog.tsx`, `testIdPrefix` prop).

## Implemented features (M1–M3)

Full Flow A end-to-end: upload → vision detection → Google Books/OpenLibrary match → dedup → user review (accept/reject/correct) → catalog. Plus:

- Auth (S-01): email + password via Supabase Auth, RLS enforced.
- Shelves CRUD (S-02): create/rename/delete shelves; system "Zakupione" shelf created on signup, undeletable.
- Vision detection (S-03): drag-drop or file-pick upload → Anthropic Sonnet 4.6 multimodal → detections persisted before match.
- Matching (S-04): Google Books (primary) + OpenLibrary (fallback); match score ≥0.75 auto-checked, 0.55–0.75 requires confirmation, <0.55 manual entry. Duplicate detection per user (ISBN + fuzzy title+author).
- Review & catalog (S-05): bulk accept, individual accept/reject/correct, manual entry; shelf view with covers.
- Add purchase flow (S-06): "Zakupione" shelf quick-add (manual or via photo upload pipeline).
- Move books (S-07): move between shelves with versioned location history.
- Catalog search (S-08): full-text (title/author/publisher) + color/shelf/status filters.
- Photo detection overlay (S-18): numbered bbox markers on full image, correlated with detection list.
- Detection list views (S-25): Karty / Lista / Kafelki view modes, persisted in localStorage.
- Manual rematch (S-23-adjacent): per-detection "search by title" button.
- Photo dedup (S-16): SHA-256 computed client-side before upload; `GET /api/photos/check-hash` checks for existing photo; duplicate warning UI with "Open existing / Upload anyway / Cancel".
- Reload recovery (S-14): `sessionStorage` persists `photoId` after DB record; on mount `PhotoUploader` resumes pipeline from correct stage (processing / match-only / redirect).

## Project structure

`src/pages/` Astro pages + `/api/` endpoints; `src/components/` React islands; `src/lib/{vision,books,matching,db,auth,http,photos,shelves}/` domain; `src/middleware.ts` auth guard; `supabase/migrations/` (13 migrations, 0001–0013); `tests/{unit,e2e}/`; `context/foundation/` hand-offs; `docs/`.

Server pages `.astro`; interactive `.tsx` with `client:load`/`client:visible`. Granica jasna: jeśli komponent nie ma stanu interakcji, zostaje Astro.

## Commands

```bash
npm run dev           # Astro dev server (Vite) at :4321
npm run build         # prod build to dist/
npm run preview       # preview prod build locally
npm run typecheck     # astro check (0 errors required)
npm run lint          # ESLint v9 flat config (0 errors required)
npm run format        # Prettier
npm run test          # Vitest unit (565 tests, ~15s)
npm run test:e2e      # Playwright E2E (first run: npx playwright install --with-deps)
npm run generate-types  # regenerate worker-configuration.d.ts after editing wrangler.jsonc
npm run build && npx wrangler deploy  # deploy to Cloudflare Workers
```

## Env setup

| Variable | Where | Purpose |
|---|---|---|
| `PUBLIC_SUPABASE_URL` | `.dev.vars` + CF Worker Secrets + GitHub Repo Secrets | Supabase project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | same | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `.dev.vars` + CF Worker Secrets only | Server-only privileged ops |
| `ANTHROPIC_API_KEY` | `.dev.vars` + CF Worker Secrets only | Claude vision API |

Server-side: `import { env } from 'cloudflare:workers'` (Astro v6+). Browser-side: `import.meta.env.PUBLIC_*`. Never mix.

## Conventions

- Typed Supabase clients: `src/lib/db/supabase.server.ts` (RLS-respecting, anon key + user JWT from cookies) and `supabase.browser.ts`. Service-role is NOT the default data path.
- Single vision-prompt source: `src/lib/vision/prompt.ts`. Spine color palette (12 colors) frozen — changing it requires a DB migration.
- Match score formula: `0.65 × titleSim + 0.30 × authorSim + 0.05 × isbnBonus`.
- SQLSTATE mapping in endpoints: `23505` → 409 `DUPLICATE_PHOTO`/`VALIDATION_ERROR`; `P0001` → 400 `VALIDATION_ERROR`; `PGRST116` → 404; others → 500.

## CI / Deploy

`.github/workflows/ci.yml`: `verify` job (lint + typecheck + vitest + build) runs on every PR; `e2e` job (Playwright + RLS integration on ephemeral local Supabase) is **manual** (`workflow_dispatch`) to save Actions minutes — run it locally (`npm run test:e2e`) and/or via `gh workflow run ci.yml` **before every PR** (see `CLAUDE.md § Testy`). `.github/workflows/deploy.yml`: build + `wrangler deploy` + post-deploy `/api/health` smoke. Run `npm run lint && npm run typecheck && npm run test` locally before pushing.

## Deeper context

`@CLAUDE.md` (full rule set for AI agents), `@docs/prd.md` (schema + scoring formulas), `@docs/plan-implementacji.md` (milestone calendar), `@context/foundation/infrastructure.md` (deploy operations + risk register), `@context/foundation/deploy-plan.md` (current deploy state), `@context/foundation/lessons.md` (recurring rules from past work).
