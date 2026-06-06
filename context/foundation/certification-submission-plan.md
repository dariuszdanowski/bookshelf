# Plan oddania projektu — certyfikacja 10xDevs 3.0 (komplet, z opcjonalnymi)

_Wygenerowano: 2026-06-06. Cel: zgłoszenie w 1. terminie (5.07.2026, bufor 29 dni)._
_Decyzja usera: oddajemy WSZYSTKIE elementy, także opcjonalne i nieobowiązkowe._

## Stan wyjściowy (health-check 2026-06-06, HEAD `998f9d9`)

Wszystkie 6 twardych wymogów certyfikacji **spełnione** (dowody w `health-check.md` § Certyfikacja).
Otwarte pozycje = elementy submission-level + opcjonalne artefakty per-lekcja M3 + higiena:

| # | Element | Typ | Źródło |
|---|---|---|---|
| 1 | Dependency sweep (14 patch/minor + tesseract 6→7) | higiena | health-check fix #2 |
| 2 | Dependabot + `npm audit` step w CI | opcjonalne (health-check #3, M2) | health-check, jedyne niezrealizowane zalecenie |
| 3 | Lefthook pre-commit | opcjonalne (artefakt M3L3) | m3-integration-plan item 5 |
| 4 | Stryker mutation testing (1 moduł) | opcjonalne (artefakt M3L2) | m3-integration-plan item 6 |
| 5 | `docs/self-review.md` pod 6 wymogów | obowiązkowe (M3 DoD) | plan-implementacji.md |
| 6 | Demo content: 3 półki, ~30 książek | obowiązkowe (M3 DoD), **user-only** | plan-implementacji.md |
| 7 | Sprzątnięcie `tmp-ux-shots/` | higiena | health-check fix #3 |

## Decyzje — zawetuj wyjątki

| Fork | Decyzja | Uzasadnienie |
|---|---|---|
| Lefthook vs Husky+lint-staged | **Lefthook** (fallback Husky) | Lekcja M3L3 wymienia Lefthook wprost; binarki dystrybuowane przez npm (platform packages), więc firewall github-releases nie powinien blokować. Jeśli postinstall jednak padnie na ETIMEDOUT → fallback Husky (pure JS) z adnotacją w self-review. |
| Zakres Stryker | **tylko `src/lib/matching/`** | Czyste funkcje (score/dedupe/isbn) = idealne pod mutation testing, najszybszy sygnał; pełny projekt = godziny runtime bez wartości. Zgodne z m3-integration-plan („Stryker na jednym module"). |
| Stryker w CI? | **NIE** — lokalny `npm run test:mutation` | Mutation run jest wolny i nie strzeże regresji solo-dev; wynik (score) dokumentujemy w `test-plan.md` §6 + self-review. |
| Dependabot config | weekly, npm, **grouped** minor/patch | Jeden zbiorczy PR tygodniowo zamiast szumu per-paczka. |
| `npm audit` step w CI | `--audit-level=high` (fail tylko HIGH+) | 5 znanych MODERATE (wait-on-upstream) nie może blokować pipeline'u. |
| tesseract.js 6→7 | **bump w sweepie** | Używany tylko w `scripts/ocr-benchmark.mjs` (tooling, nie runtime) — zero ryzyka prod; sanity = uruchomienie skryptu na próbce lub smoke importu. |
| Pre-commit zakres | lint+format staged; pre-push: typecheck | Lekko dla solo-dev; pełne gates zostają w CI. NIE dublujemy PostToolUse hooka (on działa edit-time, lefthook commit-time — to komplementarne warstwy do pokazania w self-review). |
| Self-review lokalizacja | `docs/self-review.md` | Obok prd.md / plan-implementacji.md — artefakt oddania, commitowany. |

## Pakiety pracy (kolejność wykonania)

Każdy pakiet = osobny branch `change/<id>` → PR → merge (workflow z CLAUDE.md). Pakiety P1–P4 niezależne merytorycznie, ale wykonywane sekwencyjnie (unikamy konfliktów w `package.json`/`ci.yml`).

### P1 — `change/cert-deps-and-scanning` (~45 min + CI)

1. `npm update` (14 patch/minor) + explicit `@anthropic-ai/sdk@0.101` (0.x caret) + `tesseract.js@7` (sanity: `scripts/ocr-benchmark.mjs` importuje się / przebiega na próbce)
2. `.github/dependabot.yml` — weekly, npm ecosystem, grouped updates
3. `ci.yml` — step `npm audit --audit-level=high` (po `npm ci`, non-blocking dla MODERATE)
4. Commit `chore: usuń tmp-ux-shots` (artefakt sesyjny; osobny commit)
5. Gate: pełny CI (verify + e2e) zielony; deploy smoke po merge

**DoD**: `npm outdated` pokazuje tylko 2 deliberate eslint pins; CI ma krok security; dependabot aktywny.

### P2 — `change/cert-lefthook` (~30–45 min)

1. `npm i -D lefthook` — **uwaga firewall**: jeśli instalacja binarki padnie (ETIMEDOUT na github releases), fallback `husky` + `lint-staged`
2. `lefthook.yml`: pre-commit → `eslint --fix` + `prettier --write` na staged (`{staged_files}`), pre-push → `npm run typecheck`
3. Weryfikacja: commit testowy z celowym błędem lint → hook blokuje/naprawia
4. Krótka adnotacja w README (sekcja dev) — NIE w CLAUDE.md (length-watch)

**DoD**: hook działa na Windows (PowerShell env!); CI bez zmian; udokumentowane jako artefakt M3L3.

### P3 — `change/cert-stryker-matching` (~1–1.5h)

1. Context7: zweryfikować wsparcie `@stryker-mutator/vitest-runner` dla Vitest 4 (świeży major) — jeśli brak, runner `command` jako fallback
2. `npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner`; `stryker.config.json` z `mutate: ["src/lib/matching/**/*.ts"]`
3. Script `test:mutation`; pierwszy run → mutation score
4. Jeśli przeżywają mutanty wskazujące realne luki: dopisać testy zabijające (bounded — top 5, nie polowanie na 100%)
5. Wynik (score przed/po, lista świadomie zaakceptowanych mutantów) → `context/foundation/test-plan.md` §6 (cookbook) + wpis do self-review

**DoD**: `npm run test:mutation` przebiega; score udokumentowany; raport HTML w `.gitignore`.

### P4 — `change/cert-self-review` (~45 min)

1. `docs/self-review.md` — tabela 6 wymogów → dowody klikalnymi ścieżkami: pliki kodu, testy, run CI (link), prod URL, screenshoty; sekcja artefaktów M1–M3 (prd, roadmap, test-plan, lessons, 33 archive'y, CLAUDE/AGENTS.md, hooki, lefthook, stryker)
2. README: link do self-review + szybka weryfikacja aktualności quick-start
3. Korekta `health-check.md` § Certyfikacja: odhaczenie pozycji zamkniętych w P1–P3

**DoD**: dokument kompletny — recenzent znajduje dowód każdego wymogu w ≤1 klik.

### P5 — Demo content (USER-ONLY, ~1–2h, po merge P1–P4)

Checklist dla usera (agent NIE wykonuje — manual verification + realny koszt vision):

- [ ] Konto demo na prodzie (email dostępny dla recenzenta lub dane w zgłoszeniu)
- [ ] 3 półki z nazwami/lokalizacjami (np. „Salon — regał A", „Sypialnia", „Zakupione" jest automatyczna)
- [ ] 2–3 realne zdjęcia półek przez pełny pipeline (vision na własnym kluczu BYOK — świadomy koszt ~$0.0x/zdjęcie)
- [ ] ~30 książek łącznie (akceptacje + kilka korekt → telemetria corrections ma dane)
- [ ] 1–2 książki przeniesione między półkami (historia lokalizacji widoczna)
- [ ] Wyszukiwarka: sprawdzić full-text + filtr koloru + „nie masz tej książki"
- [ ] Screenshoty w README odzwierciedlają stan demo (odświeżyć jeśli UI się zmienił od 06.2026)

### P6 — Zgłoszenie (user)

- [ ] Self-review przeczytany świeżym okiem
- [ ] Formularz zgłoszeniowy 10xDevs (Circle) — repo URL, prod URL, konto demo
- [ ] Termin: do **5.07.2026** (feedback do 19.07)

## Harmonogram i nakład

| Pakiet | Kto | Czas | Sugerowany termin |
|---|---|---|---|
| P1 deps+scanning | agent | ~45 min | tydzień 1 (do 13.06) |
| P2 lefthook | agent | ~30–45 min | tydzień 1 |
| P3 stryker | agent | ~1–1.5h | tydzień 1–2 |
| P4 self-review | agent | ~45 min | tydzień 2 (do 20.06) |
| P5 demo content | **user** | ~1–2h | tydzień 2–3 |
| P6 zgłoszenie | **user** | ~30 min | do 28.06 (tydzień zapasu) |

Razem: ~3.5–4.5h pracy agenta + ~2.5h usera. Bufor do 5.07: szeroki.

## Ryzyka

| Ryzyko | Mitygacja |
|---|---|
| Firewall blokuje binarkę lefthook | Fallback Husky+lint-staged (pure npm); decyzja w P2 kroku 1 |
| Stryker nie wspiera Vitest 4 | Context7 check PRZED instalacją; fallback command-runner albo adnotacja w self-review „wykonane na module X z runnerem Y" |
| tesseract.js 7 łamie benchmark script | Script-only — w najgorszym razie pin zostaje na 6 z adnotacją (nie blokuje niczego) |
| Sweep łamie E2E (np. astro minor) | Pełny CI gate w PR; rollback per-paczka |
| Demo na prodzie generuje koszt vision | User-only, BYOK, świadoma akceptacja; 2–3 zdjęcia ≈ centy |
