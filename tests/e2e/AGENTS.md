# Konwencje E2E (Playwright)

Reguły pisania i utrzymania testów E2E w tym projekcie. Zwięzła, projektowa wersja — `CLAUDE.md § Testy` trzyma reguły procesu (E2E w pętli weryfikacji, E2E przed PR, koszt-guardrail), a tu są konwencje samego kodu testów.

## Lokatory i asercje

- Lokator podstawowy: `getByRole` / `getByLabel` / `getByText`. `getByTestId` tylko gdy atrybuty dostępności są dwuznaczne. **Nigdy** selektory CSS / XPath / oparte na strukturze DOM — pękają przy refaktorze layoutu.
- Asercja sprawdza **wynik biznesowy** scenariusza, nie szczegóły implementacji. Pytanie kontrolne do każdej asercji: czy ten test padłby, gdyby ryzyko z `test-plan.md` się zmaterializowało? Jeśli nie — asercja jest dekoracyjna.
- Nazwij test po ryzyku: `test('dane książki przeżywają reload', …)`, nie `test('test 1', …)`.

## Izolacja i stabilność

- Każdy test uruchamialny niezależnie — **żadnego współdzielonego stanu** między testami (Playwright biega równolegle, losowa kolejność).
- **Nigdy** `page.waitForTimeout()`. Czekaj na konkretny stan: `toBeVisible()`, `waitForURL()`, `waitForResponse('**/api/...')`.
- Dane testowe z unikalnym sufiksem (np. timestamp) → brak kolizji w równoległych runach. Sprzątanie per test / `afterEach` / `afterAll` — drugi run nie może wpaść w unique-constraint.
- Auth przez **`storageState`** (jeden signup/run, projekt `setup` w `playwright.config.ts`) — nie loguj przez UI w pojedynczych testach. Wyjątek: dedykowane scenariusze login/signup.

## Granice real vs mock

- **E2E ≠ zero mockowania.** Wewnętrzne granice (auth, routing, baza, RLS) **zostają prawdziwe** — tam siedzi ryzyko integracyjne. Mockuj tylko drogie/niedeterministyczne zewnętrzne API.
- **Vision/match/external ZAWSZE mockowane** browser-side przez `page.route` — realny vision = fizyczne pieniądze (zob. `CLAUDE.md § Testy` koszt-guardrail). Zero kosztu LLM w automatach.

## Pięć antywzorców — sprawdź każdy wygenerowany test

1. **Halucynowana asercja** — składniowo OK, semantycznie pusta (sprawdza tytuł strony zamiast że dane przetrwały reload).
2. **Kruchy selektor** — `div.card > div:nth-child(3) > button` zamiast `getByRole('button', { name: 'Usuń' })`.
3. **Współdzielony stan** — test B zakłada, że test A poszedł pierwszy → flaky przy równoległości.
4. **`waitForTimeout` zamiast czekania na stan** — przechodzi lokalnie, flake w CI.
5. **Brak sprzątania** — drugi run wpada w unique-constraint.

Re-prompt po nazwie antywzorca: nie „popraw test", tylko nazwij wadę, wyjaśnij czemu nie chroni ryzyka, podaj wzorzec docelowy.

## Vision w E2E

DOM/snapshot (drzewo dostępności) jest domyślny dla weryfikacji funkcjonalnej. Tryb wizyjny tylko dla ryzyk czysto wizualnych (layout/z-index/animacja) — kosztuje i halucynuje, nie default. Do regresji pikseli preferuj deterministyczne `toMatchSnapshot`.

## Pliki

- `playwright.config.ts` — `storageState`, projekty `setup`/`cleanup`, `webServer` na :4321.
- `tests/e2e/.auth/` — zapisany stan sesji (gitignored).
- `context/foundation/test-plan.md` — mapa ryzyk; testy E2E tracą się do jej wierszy.
