# Bug Report → GitHub Issues — Krótki plan

> Pełny plan: `context/changes/bug-report-github/plan.md`

## Co i dlaczego

Użytkownicy nie mają możliwości zgłoszenia błędu w aplikacji — jedyną drogą jest GitHub ręcznie. Dodajemy przycisk „Zgłoś błąd" w headerze (obok Help), który otwiera modal z formularzem tytułu i opisu → POST `/api/feedback` → GitHub Issues API automatycznie tworzy issue z etykietą `bug`.

## Punkt wyjścia

W headerze `Layout.astro` istnieje już Help pill (linia 151–173). Wzorzec endpointu z zewnętrznym API mamy w `api/account/keys/index.ts`. Wzorzec modalu React w `ConfirmDialog.tsx`. Brak jakiegokolwiek feedback/bug-report w codebase.

## Pożądany stan końcowy

Zalogowany użytkownik klika „Zgłoś błąd" → modal → wpisuje tytuł i opis → Submit → issue pojawia się w `github.com/dariuszdanowski/bookshelf/issues` z etykietą `bug` → modal zamknięty z potwierdzeniem.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---------|-------|---------------------|--------|
| Placement | Header (obok Help) | Consistent z istniejącym Help pill, widoczny zawsze | Plan |
| Auth | Tylko zalogowani | Mniej spamu; User ID dostępny automatycznie | Plan |
| Island design | BugReportModal renderuje i button, i modal | Eliminuje event bridge Astro↔React | Plan |
| GitHub token | Worker secret `GITHUB_TOKEN` | Taki sam wzorzec jak `ANTHROPIC_API_KEY` | Plan |
| Repo | Hardcode `dariuszdanowski/bookshelf` | Zero extra env-vars | Plan |
| Email w issue | Nie — tylko User ID | Repo może być publiczne; privacy-first | Plan |
| Rate limiting | Brak własnego | GitHub token: 5000 req/h, brak zmian DB | Plan |

## Zakres

**W zakresie:**
- `POST /api/feedback` endpoint (Zod + GitHub Issues API fetch)
- `src/components/BugReportModal.tsx` (trigger button + dialog)
- `src/layouts/Layout.astro` — island w header
- `src/env.d.ts` — GITHUB_TOKEN w Cloudflare.Env
- `.dev.vars` — placeholder GITHUB_TOKEN
- E2E test (3 scenariusze, mock GitHub API)

**Poza zakresem:**
- Anonimowe zgłoszenia
- Upload screenshotów
- Rate limiting w DB
- Customowe labels/kategorie
- Email usera w issue body

## Architektura / Podejście

```
User (header button click)
  → BugReportModal [React island, client:load]
    → form submit → POST /api/feedback
      → env.GITHUB_TOKEN (Worker secret)
      → fetch github.com/repos/dariuszdanowski/bookshelf/issues
      → returns { issueNumber, issueUrl }
    → modal close + success feedback
```

`FeedbackSchema` (Zod) w `src/lib/feedback/schema.ts` — oddzielny od endpointu dla czystości.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|------|--------------|-----------------|
| 1. Backend | `/api/feedback` + env wiring | Token musi być ustawiony przed testem ręcznym |
| 2. Frontend | Modal + header button | Island hydration w header (client:load) |
| 3. E2E test | 3 scenariusze z mock GitHub API | Route mock dla github.com → playwright |

**Wymagania wstępne:** Fine-grained GitHub PAT z uprawnieniem `Issues: Read and write` dla repo `dariuszdanowski/bookshelf`. Worker secret: `npx wrangler secret put GITHUB_TOKEN`.
**Szacowany nakład pracy:** ~1-2 sesje, 3 fazy.

## Otwarte ryzyka i założenia

- `GITHUB_TOKEN` w `.dev.vars` musi być prawdziwym tokenem do testu ręcznego Fazy 1 — placeholder nie przejdzie
- Fine-grained PAT: wygasa (maks. 1 rok) — trzeba pamiętać o rotacji
- GitHub Issues na publicznym repo: każdy widzi zgłoszenia — OK, zamierzone

## Kryteria sukcesu (podsumowanie)

- Issue pojawia się w github.com/dariuszdanowski/bookshelf/issues po wypełnieniu formularza
- Przycisk widoczny tylko dla zalogowanych użytkowników
- E2E golden path zielony bez realnego GitHub API
