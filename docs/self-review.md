# Self-review — BookShelf Catalog × wymogi certyfikacji 10xDevs 3.0

**Data:** 2026-06-28 · **Produkcja:** https://bookshelf.dariusz-danowski-559.workers.dev · **Repo:** https://github.com/dariuszdanowski/bookshelf

Przegląd projektu pod sześć twardych wymogów certyfikacji (lekcja 4.2 preworka). Każdy wiersz prowadzi do dowodu w kodzie, testach lub CI — recenzent znajduje weryfikację w ≤1 klik.

## Wymóg 1 — Mechanizm kontroli dostępu

**Realizacja:** Supabase Auth (email + hasło) + Row Level Security na każdej tabeli + middleware guard na każdej trasie.

| Dowód | Gdzie |
|---|---|
| Polityki RLS `user_id = auth.uid()` dla 8 tabel domenowych | [`supabase/migrations/0002_rls_policies.sql`](../supabase/migrations/0002_rls_policies.sql) |
| Triggery defense-in-depth (auto-bootstrap profilu, niesuwalna półka systemowa) | [`supabase/migrations/0003_handle_new_user.sql`](../supabase/migrations/0003_handle_new_user.sql), [`0004_shelves_constraints.sql`](../supabase/migrations/0004_shelves_constraints.sql) |
| Auth guard: 401 przed fetchem zasobu, redirect na `/login` dla stron | [`src/middleware.ts`](../src/middleware.ts) + [`src/lib/middleware/handler.ts`](../src/lib/middleware/handler.ts) |
| Endpointy auth (signup/login/logout) | [`src/pages/api/auth/`](../src/pages/api/auth/) |
| Privacy-first: 404 dla cudzych zasobów (nie 403), klient RLS-respecting (anon key + JWT z cookies, bez service-role) | [`src/lib/http/response.ts`](../src/lib/http/response.ts), [`src/lib/db/supabase.server.ts`](../src/lib/db/supabase.server.ts) |
| **Dowód automatyczny izolacji**: testy integracyjne na realnej DB — user B nie widzi/nie mutuje danych A — uruchamiane w każdym runie CI | [`tests/integration/`](../tests/integration/) + job `e2e` w [`ci.yml`](../.github/workflows/ci.yml) |

## Wymóg 2 — Zarządzanie danymi (CRUD)

**Realizacja:** pełny CRUD na danych wynikających z domeny (nie sztuczna lista):

| Zasób | Endpointy | Slice |
|---|---|---|
| Półki (+ systemowa „Zakupione") | [`src/pages/api/shelves/`](../src/pages/api/shelves/) — GET/POST/PATCH/DELETE | S-02 |
| Książki katalogu (+ przenoszenie z historią lokalizacji, wyszukiwarka) | [`src/pages/api/books/`](../src/pages/api/books/) | S-05, S-07, S-08 |
| Zdjęcia półek (upload, lista per półka, edycja metadanych, delete z cascade) | [`src/pages/api/photos/`](../src/pages/api/photos/) | S-03, S-29 |
| Detekcje (confirm/reject/correct/refine/rematch, edycja bbox) | [`src/pages/api/detections/`](../src/pages/api/detections/) | S-04, S-05 |
| Profil + klucze BYOK (szyfrowane at rest, add/test/delete) | [`src/pages/api/account/`](../src/pages/api/account/) | S-31, S-32 |

UI: React islands ([`src/components/`](../src/components/)) na stronach Astro SSR ([`src/pages/`](../src/pages/)).

## Wymóg 3 — Logika biznesowa

**W jednym zdaniu:** użytkownik fotografuje półkę, system rozpoznaje grzbiety vision-LLM-em, matchuje z Google Books/OpenLibrary, wykrywa duplikaty względem katalogu, rankinguje propozycje progami pewności i rejestruje korekty użytkownika jako telemetrię jakości.

| Decyzja domenowa | Implementacja |
|---|---|
| Detekcja grzbietów (Zod-walidowany output, retry-with-thinking, koszt/latencja na rekordzie) | [`src/lib/vision/`](../src/lib/vision/) |
| Scoring matchu: `0.65×titleSim + 0.30×authorSim + 0.05×isbnBonus` | [`src/lib/matching/score.ts`](../src/lib/matching/score.ts) |
| Progi rankingu: ≥0.75 pre-zaznaczone / 0.55–0.75 do potwierdzenia / <0.55 ręcznie | [`src/lib/matching/findCandidates.ts`](../src/lib/matching/findCandidates.ts) |
| Deduplikacja: exact ISBN-13 + fuzzy tytuł+autor | [`src/lib/matching/dedupe.ts`](../src/lib/matching/dedupe.ts) |
| Polityka refine (progi pewności, klasyfikacja jakości cropa, budżet wywołań) | [`src/lib/matching/fallbackPolicy.ts`](../src/lib/matching/fallbackPolicy.ts) |
| Telemetria korekt (`correction_type`) | tabela `corrections`, zapis w [`src/pages/api/detections/[id]/correct.ts`](../src/pages/api/detections/) |
| BYOK enforcement: pipeline vision wymaga klucza usera, abstrakcja `VisionProvider` (Anthropic/OpenAI/OpenRouter/compatible) | S-33, [`src/lib/vision/`](../src/lib/vision/) |

## Wymóg 4 — Artefakty M1–M3

| Artefakt | Gdzie |
|---|---|
| PRD produktu + schemat danych | [`docs/prd.md`](prd.md), [`context/foundation/prd.md`](../context/foundation/prd.md) |
| Plan implementacji (kalendarz M1–M3, DoD) | [`docs/plan-implementacji.md`](plan-implementacji.md) |
| Tech-stack decision + infrastruktura (scored platform comparison) | [`context/foundation/tech-stack.md`](../context/foundation/tech-stack.md), [`context/foundation/infrastructure.md`](../context/foundation/infrastructure.md) |
| Roadmapa slice'ów (49 done / 4 proposed, north star S-05) | [`context/foundation/roadmap.md`](../context/foundation/roadmap.md) |
| Plan testów (mapa ryzyk, fazowany rollout, cookbook) | [`context/foundation/test-plan.md`](../context/foundation/test-plan.md) |
| Kontekst dla AI: reguły pracy agenta + per-area rules | [`CLAUDE.md`](../CLAUDE.md), [`AGENTS.md`](../AGENTS.md), [`src/lib/vision/AGENTS.md`](../src/lib/vision/AGENTS.md) |
| Lekcje (recurring rules) + health-check (re-genowany audyt) | [`context/foundation/lessons.md`](../context/foundation/lessons.md), [`context/foundation/health-check.md`](../context/foundation/health-check.md) |
| **73 zarchiwizowane change'y** pełnego cyklu plan → implement → impl-review → archive | [`context/archive/`](../context/archive/) |

## Wymóg 5 — Test E2E

**Realizacja:** 46 plików spec Playwright, golden path `upload → detect → confirm → catalog` z mockiem vision przez `page.route` (zero kosztu LLM w automatach).

| Dowód | Gdzie |
|---|---|
| Golden path Flow A | [`tests/e2e/upload-flow.spec.ts`](../tests/e2e/upload-flow.spec.ts), [`proposal-accept-to-catalog.spec.ts`](../tests/e2e/proposal-accept-to-catalog.spec.ts) |
| Auth, shelves, katalog, BYOK, koszty — pełna lista 46 specs | [`tests/e2e/`](../tests/e2e/) |
| Współdzielona sesja `storageState` (1 signup/run), projekty setup/cleanup | [`playwright.config.ts`](../playwright.config.ts) |
| E2E w CI na każdym PR (efemeryczna lokalna Supabase = darmowa walidacja migracji) | job `e2e` w [`ci.yml`](../.github/workflows/ci.yml) |
| Ostatni pełny run lokalny: **149 passed / 2 skipped** | CI green na main |

## Wymóg 6 — CI/CD

**Realizacja:** GitHub Actions — pipeline buduje, testuje i deployuje na publiczny URL.

| Etap | Dowód |
|---|---|
| CI (PR + main): `npm audit` → lint → typecheck → **1058 unit** → build + job e2e: integracja RLS + **Playwright E2E** | [`ci.yml`](../.github/workflows/ci.yml), [historia runów](https://github.com/dariuszdanowski/bookshelf/actions) |
| Deploy (main): build → **migrate-first** `supabase db push` → `wrangler deploy` → **post-deploy smoke** `/api/health` | [`deploy.yml`](../.github/workflows/deploy.yml) |
| Publiczny deployment | https://bookshelf.dariusz-danowski-559.workers.dev (health: [`/api/health`](https://bookshelf.dariusz-danowski-559.workers.dev/api/health)) |
| Continuous dependency scanning | [`dependabot.yml`](../.github/dependabot.yml) + krok `npm audit --audit-level=high` w CI |

## Ponad minimum — warstwy jakości (M3)

Trzy komplementarne warstwy feedbacku dla agenta i człowieka:

1. **Edit-time** — PostToolUse hook ([`.claude/hooks/post-edit-lint.cjs`](../.claude/hooks/post-edit-lint.cjs)): ESLint --fix po każdej edycji pliku przez agenta (M3L3)
2. **Commit-time** — Lefthook ([`lefthook.yml`](../lefthook.yml)): pre-commit `eslint --fix` + `prettier --write` na staged, pre-push `astro check` (M3L3)
3. **PR-time** — pełny CI gate (lint/typecheck/unit/integration/E2E/build/audit)

Plus audyt skuteczności suite'y: **mutation testing** (Stryker, M3L2) na module `src/lib/matching/` — score **76.87%** (baseline 63.07%, +25 testów granicznych po analizie przeżyć); wynik i świadomie zaakceptowane przeżycia udokumentowane w [`test-plan.md` §6.6](../context/foundation/test-plan.md). Uruchamianie: `npm run test:mutation`.

Reguły E2E (seed test, getByRole, wait-for-state, izolacja) — sekcja M3L4 w [`CLAUDE.md`](../CLAUDE.md).

## Demo dla recenzenta

- **URL:** https://bookshelf.dariusz-danowski-559.workers.dev
- **Konto demo:** `demo@demo.com` / hasło na żądanie · **4 półki** (Zakupione + 3 nazwane) · **7 zdjęć** (6 processed, śr. 16 detekcji/zdjęcie) · **46 realnych książek** z ISBN (polskie i zagraniczne, m.in. King, Grisham, Olech)
- Szybki tour: `/shelves` (półki + zakładka Zdjęcia) → `/upload` (Flow A) → `/photos/[id]` (review detekcji z overlay bbox) → `/library` (wyszukiwarka + filtry + tryby widoku) → `/account` (statystyki kosztów vision, klucze BYOK)

## Anty-wzorce lekcji 4.2 — kontrola

- ~~Pusty CRUD bez decyzji domenowej~~ → 5 decyzji domenowych (wymóg 3), telemetria korekt zamyka pętlę jakości
- ~~Za duże MVP~~ → roadmapa cięta na 39 slice'ów, 13 świadomie odłożonych; sekcja „Świadomie poza MVP" w [`docs/prd.md`](prd.md) §12
- ~~Wysoki próg zero-to-one~~ → pierwszy działający przepływ (S-01→S-05) dowieziony w 2 tygodnie M1/M2
