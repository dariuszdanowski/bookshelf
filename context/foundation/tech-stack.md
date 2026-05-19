---
starter_id: 10x-astro-starter
package_manager: npm
project_name: bookshelf
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

Solo after-hours build with a 6-week hard deadline (2026-07-05) shipping a web-app
that turns a shelf photo into a catalog: needs auth + Postgres + file storage +
vision LLM + external book-metadata APIs, all behind one developer. The recommended
default for `(web-app, js)` — Astro 6 + React 19 + TypeScript + Tailwind 4 +
Supabase + Cloudflare Pages — clears all four agent-friendly gates and bundles
exactly the building blocks the PRD's FRs name: Supabase Auth for email+password
multi-user isolation (FR-001/003/004), Supabase Postgres+RLS for the 8-table
catalog model with strict per-user privacy (NFR guardrail), Supabase Storage for
shelf photos (FR-010/013), and Cloudflare Pages for edge deploy under after-hours
budget. Vision+matching live in Astro API routes calling Anthropic Sonnet 4.6
and Google Books / OpenLibrary with Zod-validated I/O. Standard path; deployment
and CI defaults accepted (cloudflare-pages + GitHub Actions + auto-deploy on
merge). The repo is already bootstrapped against this exact stack — this hand-off
documents the locked choice for downstream skills.
