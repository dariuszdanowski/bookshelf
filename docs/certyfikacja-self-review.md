# Self-review pod 6 wymogów certyfikacji 10xDevs 3.0

**Data:** 2026-06-04
**Projekt:** BookShelf Catalog — katalogowanie domowej biblioteki ze zdjęć półek (vision-LLM)
**Stack:** Astro 6 (SSR) + React 19 (islands) + TypeScript strict + Tailwind 4 + Supabase (Auth + Postgres + Storage + RLS) + Cloudflare Workers
**Werdykt:** wszystkie 6 twardych wymogów (lekcja 4.2) spełnione. Poniżej dowód per wymóg + ścieżka weryfikacji dla recenzenta.

---

## Wymóg 1 — Mechanizm kontroli dostępu ✅

**Realizacja:** Supabase Auth (email + hasło) + Row Level Security per-user na każdej z 8 tabel (`user_id = auth.uid()` lub join przez parent).

**Dowód w kodzie:**
- Auth flow: `src/pages/api/auth/{login,signup,logout}.ts`, strony `src/pages/{login,signup}.astro`
- Guard ścieżek: `src/middleware.ts` (thin wrapper) + `src/lib/middleware/handler.ts` (core — whitelist public paths, redirect/401 dla protected, `getUser()`)
- Klienci RLS-respecting: `src/lib/db/supabase.server.ts` (`@supabase/ssr`, anon key + JWT z cookies, request-scoped) i `supabase.browser.ts` — **bez service-role w ścieżce danych**
- Polityki: `supabase/migrations/0002_rls_policies.sql` (per-user policies na wszystkich tabelach)

**Privacy-first design:** 404 (nie 403) dla cudzego zasobu i dla zniekształconego UUID (`parseUuidParam`); 401 przed fetchem zasobu (niezalogowany nie enumeruje). Single source of truth: `src/lib/http/response.ts`.

**Weryfikacja:** `tests/integration/rls.test.ts` dowodzi, że user B nie widzi danych usera A na realnym Supabase (oba kształty polityk). Slice S-01 (`context/archive/2026-05-26-email-password-auth/`).

---

## Wymóg 2 — Zarządzanie danymi (CRUD domenowy) ✅

**Realizacja:** pełny CRUD na danych wynikających z domeny (nie sztuczna lista): półki, książki, wpisy na półkach, zdjęcia.

**Dowód w kodzie:**
- Półki: `src/pages/api/shelves/index.ts` (GET list + POST) + `[id].ts` (PATCH + DELETE), auto-półka „Zakupione" (trigger `handle_new_user`)
- Książki: `src/pages/api/books/` (akceptacja → katalog, edycja, `[id]/move.ts` — przeniesienie z historią lokalizacji)
- Zdjęcia: `src/pages/api/photos/[id].ts` (DELETE z cascade + PATCH shelf_id) — slice S-29
- Detekcje/propozycje: `src/pages/api/detections/[id]/` (confirm/reject/correct/rematch)

**Decyzje domenowe wbudowane w CRUD:** inwariant „książka na dokładnie jednej półce", niesuwalna systemowa „Zakupione" (DB trigger), wersjonowana historia lokalizacji (`is_current`).

**Weryfikacja:** slice'y S-02, S-05, S-06, S-07, S-29 (archiwum). Testy: `tests/unit/pages/api/shelves/`, `tests/unit/pages/api/books/`, `tests/e2e/{shelves,photos-crud,move-book}.spec.ts`.

---

## Wymóg 3 — Logika biznesowa ✅

**Logika w jednym zdaniu (test lekcji 4.2):**
> Użytkownik fotografuje półkę, vision-LLM wykrywa tytuły grzbietów, system matchuje je z bazą publiczną (Google Books / OpenLibrary), wykrywa duplikaty względem istniejącego katalogu, rankuje propozycje wg pewności i rejestruje korekty do telemetrii jakości.

**Pięć decyzji domenowych** (nie „rekord leży w bazie"):
1. **Detekcja** — `src/lib/vision/` (prompt single-source `prompt.ts`, output walidowany Zod `DetectionSchema`, retry-with-thinking przy parse-fail, persystencja przed matchingiem)
2. **Scoring matchu** — `src/lib/matching/score.ts` (`0.65·titleSim + 0.30·authorSim + 0.05·isbnBonus`, progi 0.75/0.55)
3. **Deduplikacja** — `src/lib/matching/dedupe.ts` (ISBN exact + fuzzy tytuł+autor względem katalogu usera)
4. **Ranking propozycji** — kandydaci uporządkowani wg `match_score`, pre-zaznaczenie ≥0.75
5. **Telemetria korekt** — tabela `corrections`, każda korekta/odrzucenie jako sygnał jakości

**Dowód w kodzie:** `src/lib/{vision,matching,books}/`, `src/pages/api/photos/[id]/{process,match}.ts`. Slice'y S-03, S-04, S-05.

**Weryfikacja:** `tests/unit/lib/matching/` (score/dedupe/isbn), `tests/unit/lib/vision/`, `tests/unit/lib/books/`.

---

## Wymóg 4 — Artefakty M1-M3 ✅

**Realizacja:** komplet artefaktów procesu, nie tylko kod.

| Artefakt | Lokalizacja |
|---|---|
| PRD (modułu + foundation) | `docs/prd.md`, `context/foundation/prd.md` |
| Plan implementacji + kalendarz milestonów | `docs/plan-implementacji.md` |
| Roadmapa (37 slice'ów, graf zależności, streams) | `context/foundation/roadmap.md` |
| Reguły dla agenta AI | `CLAUDE.md`, `AGENTS.md`, per-area `src/lib/vision/AGENTS.md` |
| Lessons (12 reguł nawracających) | `context/foundation/lessons.md` |
| Health-check (audyt zależności/CI/testów) | `context/foundation/health-check.md` |
| Tech-stack + infrastruktura | `context/foundation/{tech-stack,infrastructure}.md` |
| **Test-plan (strategia testów, risk-based)** | `context/foundation/test-plan.md` |
| Archiwum slice'ów (plan + impl-review per zmiana) | `context/archive/*/` |

**Proces M1→M3 widoczny:** każdy slice przeszedł cykl `/10x-plan` → `/10x-plan-review` → `/10x-implement` → `/10x-impl-review` → `/10x-archive`, z atomic commit per faza i PR per change (branch-per-change workflow).

---

## Wymóg 5 — Test E2E ✅ (znacznie ponad minimum)

**Minimum: 1 test E2E. Stan: 20 plików E2E + 62 unit + 3 integration.**

**Dowód:**
- E2E (Playwright, chromium): `tests/e2e/*.spec.ts` — 20 spec'ów pokrywających golden paths: auth, shelves CRUD, upload→detect→confirm pipeline, accept-to-catalog, catalog search, move-book, photos-crud, account, overlay
- Kluczowy flow (wymóg „użytkownik może wykonać najważniejszą akcję"): `tests/e2e/proposal-accept-to-catalog.spec.ts` — pełny Flow A (zdjęcie → propozycje → akceptacja → katalog) z **mockowanym** vision (`page.route`)
- Unit: 62 pliki (matching, dedupe, isbn, vision parsing, endpointy + F-02 envelope)
- Integration: `tests/integration/` (RLS isolation + triggery — real DB)

**Guardrail kosztu:** vision/LLM NIGDY nie wołany realnie w automatach (Anthropic API = pieniądze) — zawsze mock. Strategia: `context/foundation/test-plan.md`.

**Znana luka (udokumentowana w test-plan §3 Phase 1):** integration RLS testy są `describe.skip` bez env i nie odpalają się dziś w CI (walidowane ręcznie post-merge). Faza 1 rolloutu podpina je do istniejącego joba `e2e` (lokalna Supabase już tam stoi).

**Weryfikacja:** `npm run test` (unit), `npm run test:e2e` (E2E), `npm run test:integration` (real DB, wymaga env).

---

## Wymóg 6 — CI/CD ✅

**Realizacja:** GitHub Actions — pełny pipeline buduje i testuje, deployuje na Cloudflare Workers z weryfikacją liveness.

**Dowód w kodzie:**
- `.github/workflows/ci.yml`: `npm ci → wrangler types → lint → typecheck → test → build`, plus osobny job `e2e` (efemeryczna lokalna Supabase przez `supabase start` = darmowa walidacja migracji + chromium + Playwright)
- `.github/workflows/deploy.yml`: build (PUBLIC_* z GitHub Secrets) → `supabase db push` (migrate-first) → `cloudflare/wrangler-action@v4 deploy` → **post-deploy smoke** (`curl --fail-with-body /api/health` + walidacja body)
- Deployment: produkcyjny URL na Cloudflare Workers (`output: 'server'`, `@astrojs/cloudflare`)

**Weryfikacja:** historia Actions w repo; `context/foundation/health-check.md` (pełny audyt pipeline'u).

---

## Podsumowanie

| # | Wymóg | Stan | Główny dowód |
|---|-------|------|--------------|
| 1 | Kontrola dostępu | ✅ | Supabase Auth + RLS 8 tabel + middleware guard |
| 2 | CRUD domenowy | ✅ | półki/książki/zdjęcia/detekcje, inwarianty domenowe |
| 3 | Logika biznesowa | ✅ | vision→match→dedup→ranking→telemetria (5 decyzji) |
| 4 | Artefakty M1-M3 | ✅ | PRD, plan, roadmapa, lessons, test-plan, archiwum |
| 5 | Test E2E | ✅ | 20 E2E + 62 unit + 3 integration (min. = 1) |
| 6 | CI/CD | ✅ | ci.yml + deploy.yml + post-deploy smoke |

**Otwarte przed oddaniem (polish, nie blokery certyfikacji):**
1. README — screenshoty (`docs/screenshots/01..06`) jeszcze nie dostarczone (linki w README są, pliki do złapania z działającej apki — manual).
2. Demo content: 3 półki, ~30 prawdziwych książek (manual, do nagrania demo).
3. (Opcjonalnie) test-plan Phase 1: podpiąć integration RLS do CI — czyni guardrail prywatności dowiedlnym automatycznie.
