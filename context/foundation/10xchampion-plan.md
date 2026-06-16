# Plan odznaki 10xChampion

**Data:** 2026-06-17  
**Cel:** Uzyskanie odznaki 10xChampion z modułu 5 kursu 10xDevs 3.0  
**Termin zgłoszeń:** ostatni tydzień kursu (formularz pojawi się po premierze modułu 5)  
**Czas potrzebny:** ~1–2 godziny roboty

---

## Czym jest 10xChampion?

Odznaka wyższego poziomu ponad bazowy certyfikat Builder (moduły 1–3). Wymaga zrealizowania **jednego** z dwóch projektów modułu 5. Jest to odznaka opcjonalna, ale warto ją zdobyć, bo projekt do tego niemal gotowy.

Dowód to **zrzuty ekranu** — nie wymaga upubliczniania firmowego/kursowego repo. Wystarczy PoC działający w Twoim kontekście.

---

## Dwie ścieżki — wybierz jedną

| Ścieżka | Lekcje | Co budujesz | Dowody |
|---|---|---|---|
| **A: Pipeline CI code review** | M5L2 + M5L3 | GitHub Actions workflow z Claude jako recenzentem PR | Widok pipeline + logi joba + komentarz LLM na PR |
| **B: Rejestr artefaktów AI** | M5L4 | Paczka npm z skillami/regułami w GitHub Packages | Repo/rejestr + definicja paczki + lista wersji |

---

## REKOMENDACJA: Ścieżka A (Pipeline CI code review)

Powód: projekt jest do niej **już 80% gotowy** — pozostaje dosłownie jeden plik do dodania i jeden testowy PR do odpalenia.

---

## Stan obecny projektu (co już mamy)

| Element | Status | Lokalizacja |
|---|---|---|
| Skill `10x-impl-review-ci` | ✅ zainstalowany | `.claude/skills/10x-impl-review-ci/` |
| Template workflow `impl-review.yml` | ✅ gotowy do adaptacji | `.claude/skills/10x-impl-review-ci/references/workflow-template.yml` |
| `ANTHROPIC_API_KEY` w GitHub Secrets | ✅ już jest (używany przez CI) | GitHub → Settings → Secrets |
| Istniejące workflow CI | ✅ zielony | `.github/workflows/ci.yml` |
| Plany zmian w `context/changes/` | ✅ są 3 aktywne | plan.md per zmiana — to właśnie one są wejściem do review |
| Metodologia plan → implement → impl-review | ✅ cały projekt | każda zmiana ma plan.md |

**Brakuje tylko:** pliku `.github/workflows/impl-review.yml` i jednego testowego PR.

---

## Co dokładnie zrobić — krok po kroku

### Krok 1: Dodaj workflow impl-review do GitHub Actions

Utwórz plik `.github/workflows/impl-review.yml` przez adaptację template'u z `.claude/skills/10x-impl-review-ci/references/workflow-template.yml`.

**Zmiany w stosunku do template'u** (projekt używa `npm`, nie `pnpm`):

```yaml
# Zamień blok setup z pnpm na npm:
# ZAMIAST:
- uses: pnpm/action-setup@v4
- uses: actions/setup-node@v4
  with:
    node-version: "22"
    cache: "pnpm"
- name: Install dependencies
  run: pnpm install --frozen-lockfile

# WSTAW:
- uses: actions/setup-node@v4
  with:
    node-version: "22.13.0"
    cache: "npm"
- name: Install dependencies
  run: npm ci
```

Reszta template'u zostaje bez zmian. Klucz `ANTHROPIC_API_KEY` jest już w secretach.

### Krok 2: Stwórz branch z aktywną zmianą i dodaj label `impl-review`

Najlepiej użyć istniejącego brancha z aktywnym planem. Np. `change/admin-technical-account-flag` ma status `impl_reviewed` — ten by zadziałał. Alternatywnie:

```powershell
# Stwórz testowy PR na istniejącym branchu lub nowym
git checkout -b change/10xchampion-test
# Zrób małą zmianę, np. zaktualizuj health-check
git add context/foundation/health-check.md
git commit -m "chore: update health check for 10xChampion test"
git push origin change/10xchampion-test

# Utwórz PR z labelem impl-review
gh pr create --title "test: 10xChampion impl-review CI trigger" --label "impl-review"
```

**Uwaga:** Label `impl-review` musi istnieć w repozytorium. Utwórz go jeśli go nie ma:
```powershell
gh label create "impl-review" --color "0075ca" --description "Triggers automated impl review"
gh label create "impl-review-override" --color "e4e669" --description "Bypasses REJECTED verdict gate"
```

### Krok 3: Obserwuj pipeline i zbierz dowody

Po pushu PR z labelem `impl-review`:

1. Idź do **Actions** w GitHub → zakładka `Impl Review`
2. Poczekaj aż job się zakończy (Claude analizuje PR względem planu)
3. Sprawdź PR → Comments — Claude powinien zamieścić komentarz z werdyktem

**Zbierz 3 screenshoty:**

| # | Screenshot | Gdzie zrobić |
|---|---|---|
| 1 | **Widok pipeline** — zakładka Actions, job `impl-review` z co najmniej jednym widocznym jobem (zielonym lub czerwonym) | GitHub → Actions → Impl Review → konkretny run |
| 2 | **Logi joba** — rozwinięty krok "Run impl-review (CI)" z widocznym outputem Claude'a | Ten sam run → kliknij job → rozwiń step |
| 3 | **Komentarz LLM na PR** — komentarz od `claude[bot]` z werdyktem (APPROVED/NEEDS ATTENTION/REJECTED) | PR → Comments |

### Krok 4: Zgłoś odznakę

Przez formularz zgłoszeniowy na platformie (pojawi się w ostatnim tygodniu kursu). Dołącz 3 screenshoty z Kroku 3.

---

## Ścieżka B: Rejestr artefaktów AI (alternatywa)

Jeśli wolisz Ścieżkę B (paczka npm z skillami), wymagane kroki:

1. Pobierz materiały startowe: `npx @przeprogramowani/10x-cli@latest get m5l4`
2. Przejdź przez cykl `/10x-new` → `/10x-research` → `/10x-plan` → `/10x-implement` na bazie pobranych specyfikacji
3. Opublikuj paczkę do GitHub Packages (lub npm)
4. Zrób 3 screenshoty:
   - Repozytorium/rejestr z przepływem (Actions tab z johem publikacji)
   - Definicja paczki (`package.json` z `publishConfig`)
   - Lista wydanych wersji (GitHub Packages → pakiet → wersje)

**Dlaczego NIE polecam tej ścieżki dla tego projektu:**
- Wymaga stworzenia osobnego repo/paczki od zera
- Bardziej pracochłonne (~3–4h vs ~1–2h dla Ścieżki A)
- Ścieżka A jest naturalnym przedłużeniem już istniejącego workflow projektu

---

## Potencjalne problemy i rozwiązania

| Problem | Rozwiązanie |
|---|---|
| `claude-code-action@v1` nie ma dostępu do `ANTHROPIC_API_KEY` | Secret jest już w repo — sprawdź Settings → Secrets → Actions czy `ANTHROPIC_API_KEY` tam jest |
| PR nie ma planu w `context/changes/` | Skill wykryje to i zamieści neutralny komentarz "no plan" zamiast zawiesić — nie błąd, ale nie pokaże review. Użyj PR z aktywną zmianą. |
| Label `impl-review` nie istnieje | `gh label create "impl-review" --color "0075ca"` |
| Pipeline uruchamia się tylko na forked PR | Template ma guard: `head.repo.full_name == github.repository` — PR musi być z brancha w tym samym repo |
| `ANTHROPIC_API_KEY` zużywa tokeny | Jeden run kosztuje ~$0.05–0.20 przy Opus. Zrób jeden testowy run, zrób screenshoty. |

---

## Podsumowanie: co i kiedy

```
Dzisiaj (17.06):
  1. Utwórz `.github/workflows/impl-review.yml` (10 min)
  2. Utwórz labele `impl-review` i `impl-review-override` w GitHub (2 min)

Następny PR (dowolna aktywna zmiana):
  3. Dodaj label `impl-review` do PR (30 sek)
  4. Poczekaj na pipeline (~5–10 min)
  5. Zrób 3 screenshoty (5 min)

Ostatni tydzień kursu:
  6. Zgłoś przez formularz z 3 screenshotami
```

**Łączny nakład:** ~1–2 godziny (głównie czekanie na CI).

---

## Wymagania formalne odznaki (z M5L1, Krok 4)

Dla Ścieżki A (pipeline CI):
- ✅ widok pipeline'u i co najmniej jeden widoczny job
- ✅ logi z pipeline'u albo joba
- ✅ screenshot z działania pipeline'u na PR (komentarz od LLM z review)

Żadne z tych wymagań **nie wymaga publicznego repo** — wystarczy Twoje prywatne repo na GitHubie.

---

*Wygenerowano: 2026-06-17 | Źródła: lekcje M4L1, M5L1–M5L5, .claude/skills/10x-impl-review-ci/*
