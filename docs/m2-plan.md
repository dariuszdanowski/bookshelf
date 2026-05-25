# Plan realizacji modułu M2 — BookShelf Catalog

**Data:** 2026-05-24
**Cel:** zrealizować lekcje M2L1–M2L5 i zamknąć milestone M2 (DoD z [plan-implementacji.md](plan-implementacji.md)) do **14.06.2026**.
**Status wejścia:** PRD, tech-stack, infrastructure i plan-implementacji gotowe. M1 zamknął Sprint Zero (CI + deploy). Pozostałe slice'y M1 (schema + upload + vision) — pierwsze realne wejście dla pętli M2L2.

## 1. Co M2 wnosi (skrót)

Moduł 2 to **proces od PRD do PR**: roadmap → change → plan → research → implement → review, z opcjonalną paralelizacją przez worktrees.

| Lekcja | Skille | Artefakt | Funkcja |
|---|---|---|---|
| M2L1 | `/10x-roadmap` | `context/foundation/roadmap.md` | Vertical slices + zależności + north star |
| M2L2 | `/10x-new`, `/10x-plan`, `/10x-plan-review`, `/10x-implement` | `context/changes/<id>/{change.md, plan.md, plan-brief.md}` | Cykl plan → fazowa implementacja → commit |
| M2L3 | `/10x-impl-review`, `/10x-lesson` | `context/changes/<id>/impl-review-report.md`, aktualizacja `lessons.md` | Quality gate: kod vs plan, triage findings |
| M2L4 | `/10x-research`, Exa.ai MCP, Context7 MCP, `/10x-frame` (ratunek) | `context/changes/<id>/research.md` + plan osadzony w źródłach | Trudne slice'y (vision, matching) z aktualną wiedzą zewnętrzną |
| M2L5 | `git worktree`, `/goal` | Równoległe worktrees, oddzielne PR-y | Skala: 2+ niezależne slice'y naraz |

**Kumulacja:** na koniec M2 mamy działający flow zdjęcie → katalog + transparentny proces, w którym każdy slice jest zaplanowany, wdrażany w fazach, recenzowany i commitowany osobno.

## 2. Stan wejściowy (zweryfikowane)

| Artefakt | Status |
|---|---|
| [context/foundation/prd.md](../context/foundation/prd.md) | gotowy |
| [context/foundation/tech-stack.md](../context/foundation/tech-stack.md) | gotowy |
| [context/foundation/infrastructure.md](../context/foundation/infrastructure.md) | gotowy |
| [docs/prd.md](prd.md) | gotowy (PRD modułu, schemat danych, prompty) |
| [docs/plan-implementacji.md](plan-implementacji.md) | gotowy (kalendarz + DoD per milestone) |
| Sprint Zero (CI + deploy + AGENTS.md) | done w commitach `7a3d8c3`, `22cfef6` |

**Ważne rozróżnienie:** `docs/plan-implementacji.md` (kalendarz milestonów) ≠ `context/foundation/roadmap.md` (vertical slices z zależnościami). To są **artefakty komplementarne**, nie konkurencyjne — `/10x-plan` oczekuje roadmapy, audytor 10xDevs spojrzy na oba.

## 3. Plan w 4 fazach

### Faza 1 — Inicjacja M2 (25–26.05, ~3h)

**Cel:** wygenerować roadmapę pokrywającą resztę M1 + całe M2 jako verticals.

1. `/10x-roadmap` — interview (north star, top blocker, cel MVP), audit repo, generacja `roadmap.md`.
2. Reconcile statusów slice'ów z [plan-implementacji.md](plan-implementacji.md): `done` (Sprint Zero), `ready` (schema, upload), `proposed` (vision, matching, library).
3. Sanity check: każdy fundament F-NN ma `Unlocks: S-NN`, slice'y M2 pokrywają FR z PRD § 5–8.

**DoD:** `context/foundation/roadmap.md` istnieje, ≥1 slice `ready`, north star = "MVP gotowy + deployed do 19.06.2026".

### Faza 2 — Pierwsze pętle M2L2 + M2L3 na slice'ach M1 (27.05–31.05, ~12h)

**Cel:** zamknąć M1 (schema + upload + vision) używając pełnego chainu M2.

Dla każdego slice'a: `/10x-new` → `/10x-plan` → `/10x-plan-review` → `/10x-implement phase N` → `/10x-impl-review`.

| Slice | Change-id | Risky areas |
|---|---|---|
| Supabase schema + RLS + typed clients | `m1-schema-rls` | RLS policy test, privacy-first 404 |
| Photo upload → Storage + signed URL | `m1-photo-upload` | Cloudflare runtime (`Astro.locals.runtime.env`), `Cache-Control: private, no-store` |
| Login/logout + auth callback + middleware | `m1-auth-flow` | Współpraca RLS ↔ sesja SSR |

**Pułapka projektowa:** w `plan.md` każdego API-slice'a wymuś konwencję z [CLAUDE.md § "API endpoints"](../CLAUDE.md) — `apiResponse`/`apiError` helper, `404` zamiast `403`, `401` przed resource fetch, `export const prerender = false`. To **enforcement-by-code** z DoD M1; `/10x-plan` ma to złapać, `/10x-impl-review` zweryfikować.

### Faza 3 — Slice'y M2 z researchem (01.06–10.06, ~10h)

**Cel:** vision + matching + UI review — slice'y wymagające `/10x-research` i external knowledge.

| Slice | Research? | Źródła |
|---|---|---|
| Vision pipeline (prompt + Zod + retry + parse_failure) | TAK — `/10x-research` (idempotencja) + Context7 (`@anthropic-ai/sdk`, thinking mode) | docs Anthropic API |
| Matching scoring (titleSim, authorSim, isbnBonus) | TAK — Exa.ai dla algorytmów (Levenshtein vs Jaro-Winkler vs token-set), Context7 dla bibliotek | walidacja formuły z PRD § 10 w docsach |
| Google Books + OpenLibrary klienci | Słabo — Context7 wystarczy | rate limits, cache w `book_candidates` |
| Deduplikacja vs istniejący katalog | TAK — `/10x-research` `books` + indeksów | PRD § 11 |
| DetectionReview UI (React island) + accept/reject/correct | Nie | wzorce React 19 islands |
| `/library` z search + filtry | Nie | Astro SSR + form |

**Pułapka projektowa:** Exa.ai MCP / Context7 MCP wymagają pobierania serwerów z `github.com/releases` — **firewall korporacyjny blokuje** (zapisane w memory). Fallback: `WebFetch` + `WebSearch` ręcznie w sesji z `/10x-research`, ewentualnie MCP po VPN-window.

### Faza 4 — Paralelizacja + szlif (11.06–14.06, ~5h)

**Cel:** zademonstrować M2L5 (worktrees), zamknąć DoD M2.

1. Wybierz **dwa niezależne slice'y** (np. `m2-telemetria-corrections` ↔ `m2-library-filtry` — różne pliki, brak wspólnego kontraktu).
2. `git worktree add ../bookshelf-telemetria -b feat/telemetria` + drugi worktree (port 4322 dla drugiego dev-servera, żeby nie kolidowały).
3. Tryb mieszany: w jednym `/10x-implement` interaktywnie, w drugim `/goal` z warunkiem "wszystkie fazy z plan.md ukończone".
4. Dwa PR-y, dwa `/10x-impl-review`, merge sekwencyjnie.
5. Każda nietrywialna lekcja → `/10x-lesson` do [context/foundation/lessons.md](../context/foundation/lessons.md) (DoD M1 wymaga już pierwszego: `src/lib/http/response.ts`).

## 4. Komendy startowe (jutro, 25.05)

```
/10x-roadmap
# po wygenerowaniu i przeglądzie:
/10x-new                          # change-id: m1-schema-rls
/10x-plan
/10x-plan-review
/10x-implement                    # phase 1
/10x-impl-review
```

## 5. Ryzyka i adresacja

| Ryzyko | Adresacja |
|---|---|
| Roadmap rozjedzie się z [plan-implementacji.md](plan-implementacji.md) | Cotygodniowa synchronizacja statusów ręcznie |
| Firewall blokuje MCP do Exa/Context7 | `WebFetch` + `WebSearch` jako fallback w `/10x-research`, ew. VPN-window dla MCP install |
| Context drift w długiej sesji vision-pipeline | Krótkie sesje per faza, commit + `## Progress`, nowy chat na każdą fazę |
| `/10x-implement` odkrywa unknowns w trakcie | Stop, wróć do planu — nie naprawiaj kodu promptami (lekcja M2L2) |
| Worktrees walczą o port 4321 / Supabase | `npm run dev -- --port 4322` w drugim, lub osobny Supabase project (drożej) |
| Vision API koszt rośnie przy iteracji | Cap `profiles.daily_vision_budget_usd` (PRD § 13 pkt 3) działa od pierwszego promptu — nie wyłączaj „na testy" |

## 6. Wynik końcowy M2 (14.06)

- `context/foundation/roadmap.md` z ≥80% slice'ów `done` lub `ready-to-merge`
- 6–8 folderów `context/changes/<id>/` z planami, research (gdzie potrzebne) i review-reportami
- Działający `/library` z accept/reject/correct flow (DoD M2 z [plan-implementacji.md](plan-implementacji.md))
- 1× slice dowieziony paralelnie w worktrees (demo M2L5)
- `lessons.md` z 3–5 wpisami z faktycznych potknięć

## 7. Automatyzacja vs krok-po-kroku

> Pytanie autora: „Czy/jak wykonać te prace automatycznie?"

**Rekomendacja: hybryda, z naciskiem na krok-po-kroku przy decyzjach i implementacji.**

### 7.1 Co MA sens robić krok po kroku (zdecydowana większość)

| Krok | Dlaczego nie automat |
|---|---|
| `/10x-roadmap` | Interview wymaga **twoich** odpowiedzi (north star, top blocker) — agent może je sobie wymyślić, ale wtedy roadmap nie odzwierciedla rzeczywistych priorytetów. |
| `/10x-plan-review` | Triage „proceed / fix / scope-cut" to ludzka decyzja. Auto-accept planu agenta zaprzecza całemu sensowi shift-left, który M2L2 wprowadza. |
| `/10x-implement` (vision, matching, UI) | Decyzje kontraktowe (kształt `DetectionSchema`, retry budget, ReviewState) muszą przejść przez ciebie. Jeśli agent zgadnie, w fazie 3 będziesz to przepisywał. |
| UI verification w przeglądarce | [CLAUDE.md](../CLAUDE.md) wymaga uruchomienia dev-servera i ręcznego sprawdzenia UI — *„if you can't test the UI, say so explicitly rather than claiming success"*. Agent w tle nie ma jak. |
| `/10x-impl-review` triage findings | Macierz severity × impact i decyzja fix-now/fix-differently/skip/lesson to ludzki osąd, nie regex. |
| Koszt vision API | Bez ludzkiej iteracji łatwo o niezamierzone $$ na Anthropic API. Daily budget cap (PRD § 13) chroni przed katastrofą, ale nie przed marnotrawstwem. |
| Aspekt dydaktyczny | Cel M2 to **nauczenie procesu**. Jeśli zlecisz wszystko jednej sesji, omijasz checkpointy lekcji — certyfikacja 10xDevs sprawdza prowadzenie agenta, nie wyklikanie „do all of it". |

### 7.2 Co MA sens zautomatyzować punktowo

| Krok | Tryb auto | Mechanizm |
|---|---|---|
| `/10x-new` (zakładanie folderu change'a) | full auto | Mechaniczne, jeden mkdir + template — nie ma decyzji. |
| `/10x-plan` (generacja `plan.md`) | auto-z-acceptem | Pozwól wygenerować, ale **zawsze** przeczytaj przed `/10x-implement`. Wąskie gardło to twoje 10 minut review, nie agenta. |
| `/10x-research` (subagenty na repo) | full auto | Sub-agenty paralelnie czytają — typowy use-case Agent tool z Explore. |
| Faza implementacji wewnątrz slice'a (np. „dopisz Zod schema + test") | full auto w obrębie 1 fazy | Z `/10x-implement` wewnątrz jednej fazy z jasnym DoD. Stop po commitcie, ty przeglądasz, decydujesz o fazie 2. |
| Mechaniczne czynności po fazie | full auto | `npm run typecheck && npm run lint && npm run test` — pętla zielona/czerwona. |
| `/goal` na **jednym** slice'u w M2L5 | kontrolowany auto | Wybierz slice z bardzo czytelnym DoD (np. „dodaj endpoint `/api/shelves` zgodny z konwencją + Vitest"), ustaw warunek końcowy, wypuść w worktree. Drugi worktree prowadź interaktywnie. To **dokładnie** to, czego M2L5 uczy. |

### 7.3 Czego NIE automatyzować pod żadnym pozorem

- **Pełny chain `/10x-roadmap` → 8× `/10x-implement` → merge** w jednej długiej sesji. Context rot z M2L4 to nie teoria; po 4–5 fazach jakość spada wykładniczo, agent zaczyna „naprawiać" kontrakty zamiast je realizować.
- **Wsadowa implementacja vision-pipeline + matching** — to są dwa slice'y z najwyższym ryzykiem (recall, koszt API, halucynacje). Tu zwolnij, nie przyspieszaj.
- **Migracje Supabase + RLS w autopilocie**. RLS misconfiguration = wyciek danych. Zawsze przejrzyj policy ręcznie + odpalisz lokalnie `supabase test`.

### 7.4 Pragmatyczna kolejność na jutro (25.05)

1. **Ręcznie i synchronicznie:** `/10x-roadmap` z interview. Czas: 60–90 min. Otwórz, przejrzyj, popraw statusy.
2. **Półautomatycznie:** dla slice'a `m1-schema-rls` — `/10x-new` + `/10x-plan` (auto-gen) → ty czytasz 10 min → `/10x-plan-review` → `/10x-implement phase 1` (auto wewnątrz fazy) → stop → ręczny przegląd commit'a → `/10x-impl-review` → triage.
3. **Iteruj.** Po 1–2 slice'ach poczujesz, gdzie warto skrócić pętlę, a gdzie zwolnić.

**Kotwica:** jeśli kiedykolwiek agent zaczyna „domyślać się" kontraktu w trakcie implementacji — to sygnał, że zsynchronizowałeś automat za bardzo. Wróć krok wstecz, rozszerz plan, kontynuuj.
