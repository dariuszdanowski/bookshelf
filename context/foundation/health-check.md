---
project: bookshelf
checked_at: 2026-05-20T00:35:00Z
health_status: healthy
context_type: brownfield
language_family: js
stack_assessment_available: false
checks_run:
  - lockfile
  - dependency_audit
  - outdated_deps
  - test_runner
  - ci_cd
  - configuration
audit_findings:
  critical: 0
  high: 0
  moderate: 10
  low: 0
test_runner_detected: true
ci_provider: null
recommended_fixes: 1
---

## Dependency Health

### Lockfile

```
Status: present (package-lock.json)
Package manager: npm
```

### Security Audit

```
Tool: npm audit --json
Summary: 0 CRITICAL, 0 HIGH, 10 MODERATE, 0 LOW
Direct vs transitive: 3 direct (all MODERATE), 7 transitive (all MODERATE)
```

The previous run's only HIGH advisory (`devalue` GHSA-77vg-94rm-hx3p) was cleared by `npm update` — the parent picked up `devalue ≥ 5.8.1` transitively. No CRITICAL or HIGH findings remain.

#### MODERATE findings (all logged, none actioned)

Two transitive chains pull a moderate `ws` (8.0.0–8.20.0, GHSA-58qx-3vcg-4xpx, uninitialized memory disclosure, CVSS 4.4) plus a `yaml` (2.0.0–2.8.2) advisory through tooling:

- **Cloudflare runtime chain**: `@astrojs/cloudflare` (direct) + `wrangler` (direct) → `@cloudflare/vite-plugin` + `miniflare` → `ws`.
- **Astro language-server chain** (introduced by `@astrojs/check`): `@astrojs/check` (direct) → `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml`.

Both chains hit the same guardrail noted in the previous report: npm's `fixAvailable` for `@astrojs/cloudflare`/`wrangler` still points at OLDER majors (12.6.13 / 3.107.3) — `npm audit fix --force` would downgrade the Cloudflare adapter and break Astro 6 pairing. The yaml-language-server chain is dev-only tooling (`astro check`); the `ws` chain is build/dev tooling that doesn't ship to runtime. Treat as "wait on upstream", revisit when `ws ≥ 8.20.1` and `yaml ≥ 2.8.3` land transitively.

### Outdated Dependencies

```
Packages with major version gaps: 0
```

3 packages have available updates, all already evaluated and deferred:

- `@anthropic-ai/sdk` 0.95.2 → 0.97.1 (minor — `npm update` will pick up next run; nothing in code depends on a specific minor yet)
- `eslint` 9.39.4 → 10.4.0 (major) — **deliberately pinned at v9** because `eslint-plugin-react@7.x` declares `peer eslint: "<= ^9"`. Move to v10 once `eslint-plugin-react@8` ships with v10 peer support, or swap React lint coverage to `@eslint-react/eslint-plugin`.
- `@eslint/js` 9.39.4 → 10.0.1 (major) — same pin as `eslint`.

## Test Suite

```
Test runner: Vitest 4.1.6 + Playwright 1.60.0
Tests found: 2 unit (tests/unit/health.test.ts) + 1 e2e (tests/e2e/smoke.spec.ts)
Test execution: Vitest 2/2 passing; Playwright lists but does not run (browser binaries not installed)
```

Configuration:

```
vitest.config.ts        — jsdom env, setup at tests/unit/setup.ts, v8 coverage
playwright.config.ts    — chromium project, webServer wires `npm run dev` on :4321
tests/unit/setup.ts     — imports @testing-library/jest-dom/vitest
```

Outstanding manual step the user should run once: `npx playwright install --with-deps` (~600 MB browser binaries; deliberately skipped from the agent-applied fixes to avoid network/firewall hazards). Until then `npm run test:e2e` will fail at "browser not installed".

## CI/CD

```
Provider: not detected
Configuration: .github/workflows/ exists (only .gitkeep)
```

ℹ Status unchanged from the previous report. CI/CD wiring is covered in the infrastructure and deployment lesson; the local test loop (`npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`) is the gap-filler until then.

## Configuration

### High severity

(none — TypeScript `strict` enforced via `extends: astro/tsconfigs/strict`, `.gitignore` present.)

### Medium severity

(none — ESLint configured via `eslint.config.mjs` flat config; Prettier configured via `.prettierrc.json` + `.prettierignore`.)

### Low severity

- **`.editorconfig`** — still absent. Convenience layer for cross-editor consistency. Fix: drop a minimal `.editorconfig` at repo root if a non-VSCode editor shows up; not blocking.

## Stack Assessment Cross-Reference

No `context/foundation/stack-assessment.md` found. Not strictly necessary — the stack is the `10x-astro-starter` recommended-default, which clears all four agent-friendly gates per the registry. Run `/10x-stack-assess` if you want a written quality-gate analysis for documentation.

## Recommended Fixes

### Fix before agent work (Category A)

#### 1. (Optional) Add `.editorconfig`

**Impact**: Low. If you only edit in VS Code, no impact; if a co-author opens the repo in JetBrains/Vim/Neovim, indentation defaults may drift.
**Severity**: low
**Effort**: quick (< 5 min)
**Fix**: drop `.editorconfig` at repo root:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

(Everything else from the previous report's Category A is now satisfied: lockfile present, no HIGH/CRITICAL audits, test runner installed and passing, TypeScript strict on, ESLint configured, Prettier configured, `npm update` run, devalue HIGH cleared.)

### Addressed in upcoming lessons (Category B)

#### CI/CD pipeline (`.github/workflows/{ci,deploy}.yml`)

**Lesson**: [Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5)
**What you'll do there**: wire GitHub Actions for `npm run lint` + `npm run typecheck` + `npm run test` + `npm run build` + Cloudflare Pages deploy. The scripts are already in place — the lesson plugs them into a workflow file.

#### `AGENTS.md` (agent onboarding doc)

**Lesson**: [Agent Onboarding: Agents.md, AI Rules i feedback loops (M1L4)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l4)
**What you'll do there**: generate `AGENTS.md` for non-Claude-Code agents (Cursor, Copilot, etc.). `CLAUDE.md` is already rich and current.

#### Supabase project init + migrations

**Lesson**: covered as part of M1 walking-skeleton work (PRD references `docs/plan-implementacji.md`).
**What you'll do there**: `supabase init`, `supabase link`, then author the 8-table migration set with RLS per `docs/prd.md`.

#### Manual one-shot: install Playwright browsers

Not a lesson, just a chore: `npx playwright install --with-deps` whenever you're on a connection that can reach `cdn.playwright.dev` (~600 MB download). After that the existing `npm run test:e2e` smoke spec will pass end-to-end.

## Summary

Health status: **healthy**

Strengths: full agent feedback loop in place (Vitest 4 + Playwright 1.60 wired and green, ESLint 9 flat config with TypeScript + React + React-Hooks + Astro rules, Prettier with Astro + Tailwind plugins, TS `strict` enforced, `astro check` confirms 0 errors / 0 warnings on 10 files, `npm run build` ships a clean Cloudflare server bundle in ~11 s). All previous Category A items from the prior report have been closed except for one optional low-severity convenience (`.editorconfig`). Dependency tree is clean of HIGH/CRITICAL advisories; the 10 remaining MODERATE entries are all dev-time tooling chains (`ws`, `yaml`) waiting on upstream and explicitly guard-railed against `npm audit fix --force`.

Next step: nothing blocking. Move on to whatever foundation work is next in your chain — the agent feedback loop is ready. The Category B items (CI/CD wiring, AGENTS.md, Supabase init, Playwright browser binaries) are real but expected at this stage and slot into the lessons / chores already noted.
