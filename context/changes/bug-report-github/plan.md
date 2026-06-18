# Bug Report → GitHub Issues Plan implementacji

## Przegląd

Dodanie formularza zgłaszania błędów dostępnego dla zalogowanych użytkowników: przycisk w headerze (obok Help) otwiera modal z tytułem i opisem → POST `/api/feedback` → GitHub Issues REST API tworzy issue w repozytorium. Token dostępu jako Worker secret `GITHUB_TOKEN`.

## Analiza stanu obecnego

- Brak jakiegokolwiek mechanizmu feedback/bug-report w aplikacji.
- Header w `src/layouts/Layout.astro:146-174` ma prawą stronę z ThemeToggle, EnvBadge i Help pill — gotowe miejsce na drugi przycisk.
- Wzorzec endpointu: `locals.user` (auth check) → Zod parse → external fetch → `apiResponse`/`apiError` — dobrze udokumentowany w `src/lib/http/response.ts` i `src/pages/api/account/keys/index.ts`.
- `src/env.d.ts:17-26` — tutaj dodajemy `GITHUB_TOKEN` do `Cloudflare.Env`.
- Modal pattern z `useBodyScrollLock`, Escape/backdrop close — wzorzec z `ConfirmDialog.tsx` (prosty) lub `BookModal.tsx` (z formularzem).

## Pożądany stan końcowy

Zalogowany użytkownik klika „Zgłoś błąd" w headerze → modal z polami Tytuł + Opis + URL (auto-fill) → submit tworzy GitHub Issue w `dariuszdanowski/bookshelf` z etykietą `bug` → modal zamknięty po sukcesie.

### Kluczowe odkrycia:

- Trigger button umieszczamy WEWNĄTRZ `BugReportModal.tsx` (island renderuje i button, i modal) — eliminuje potrzebę event bridge między Astro i React. Layout dodaje `<BugReportModal client:load />`.
- `env.GITHUB_TOKEN` via `import { env } from 'cloudflare:workers'` — taki sam wzorzec jak `ANTHROPIC_API_KEY` w process.ts.
- GitHub Issues API endpoint: `POST https://api.github.com/repos/dariuszdanowski/bookshelf/issues` — hardkodowany, zero extra env-vars.
- E2E mock przez `page.route('**/api/feedback', ...)` — mock całego endpointu z perspektywy przeglądarki (server-side fetch do GitHub nie jest przechwytywany przez Playwright; wzorzec identyczny z resztą E2E: `**/api/**`, nie zewnętrzny URL).

## Czego NIE robimy

- Anonimowe zgłoszenia (brak auth → 401)
- Przesyłanie screenshotów/attachmentów
- Rate limiting w DB — GitHub token ma 5 000 req/h (fine-grained)
- Customowe labels per kategorię (np. "enhancement", "question")
- Email usera w treści issue (repo może być publiczne)
- Konfigurowalny repo owner/name przez env — hardcode wystarczy

## Podejście do implementacji

Trzy fazy: (1) backend + env wiring, (2) frontend modal + header trigger, (3) E2E test z mock GitHub API.

---

## Faza 1: Backend — `/api/feedback` + env

### Przegląd

Nowy endpoint POST + dodanie `GITHUB_TOKEN` do typów + placeholder w `.dev.vars`.

### Wymagane zmiany:

#### 1. Typ GITHUB_TOKEN w env

**Plik**: `src/env.d.ts`

**Cel**: Dodać `GITHUB_TOKEN` do `Cloudflare.Env` — typecheck wymusi że Worker secret jest obecny, bez tego `env.GITHUB_TOKEN` dostanie błąd TS.

**Kontrakt**: Dodaj `GITHUB_TOKEN: string;` po linii `USER_KEYS_ENCRYPTION_KEY: string;` (linia 23) w bloku `interface Env`.

#### 2. Placeholder w .dev.vars

**Plik**: `.dev.vars`

**Cel**: Lokalny dev musi mieć placeholder — bez niego `env.GITHUB_TOKEN` będzie `undefined` i endpoint zwróci 503.

**Kontrakt**: Dopisać `GITHUB_TOKEN=github_pat_REPLACE_WITH_REAL_TOKEN` na końcu pliku. Komentarz że produkcja wymaga `npx wrangler secret put GITHUB_TOKEN`.

#### 3. Zod schema dla feedbacku

**Plik**: `src/lib/feedback/schema.ts` (nowy plik)

**Cel**: Centralna Zod schema dla `POST /api/feedback` — oddzielna od endpointu dla testowalności.

**Kontrakt**:
```typescript
export const FeedbackSchema = z.object({
  title: z.string().min(1, 'Tytuł jest wymagany').max(200, 'Maksymalnie 200 znaków'),
  description: z.string().min(1, 'Opis jest wymagany').max(2000, 'Maksymalnie 2000 znaków'),
  url: z.string().max(500).optional(),
});
export type FeedbackInput = z.infer<typeof FeedbackSchema>;
```

#### 4. Endpoint POST /api/feedback

**Plik**: `src/pages/api/feedback.ts` (nowy plik)

**Cel**: Przyjmuje tytuł/opis/URL od zalogowanego usera, formatuje markdown body, wywołuje GitHub Issues API, zwraca numer i URL created issue.

**Kontrakt**:
- `export const prerender = false`
- Auth check: `!locals.user` → 401 `UNAUTHENTICATED`
- Env check: `!env.GITHUB_TOKEN` → 503 z kodem `INTERNAL_ERROR` + message `'GitHub integration not configured'`
- Zod parse `FeedbackSchema.safeParse(body)` → 400 `VALIDATION_ERROR` + `flatten()` na błędzie
- GitHub fetch: `POST https://api.github.com/repos/dariuszdanowski/bookshelf/issues` z headerami:
  - `Authorization: Bearer <token>`
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2022-11-28`
- Issue body: markdown z sekcjami `## Opis`, opcjonalnie `## URL`, `## Zgłoszone przez\nUser ID: <id>`, `## Data\n<ISO>`
- Issue title: `Bug: <user title>`
- Labels: `["bug"]`
- GitHub response `!ok` → 500 `INTERNAL_ERROR`
- Sukces → `apiResponse({ data: { issueNumber, issueUrl }, status: 201 })`

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`

#### Weryfikacja ręczna:

- `curl -X POST http://localhost:4321/api/feedback` z body i sesją → 201 + numer issue w GitHub
- Brak tokenu → 503 z czytelnym komunikatem
- Niezalogowany → 401

---

## Faza 2: Frontend — BugReportModal + trigger w headerze

### Przegląd

React island renderuje przycisk + modal. Layout.astro dodaje island do prawej strony headera. Modal zbiera tytuł/opis/URL, wywołuje `/api/feedback`, pokazuje sukces lub błąd.

### Wymagane zmiany:

#### 1. BugReportModal.tsx

**Plik**: `src/components/BugReportModal.tsx` (nowy plik)

**Cel**: Self-contained React island: trigger button + dialog modal z formularzem. Na submit — POST do `/api/feedback`, zamknięcie po sukcesie, inline error na porażce.

**Kontrakt**:
- Props: brak (island bezstanowy — pobiera `window.location.href` na mounted)
- State: `open`, `submitting`, `error`, `success`
- Trigger button: styl podobny do Help pill ale czerwono-ceglasty (amber lub rose), `data-testid="bug-report-trigger"`
- Dialog: `<dialog>` native (ten sam wzorzec co lightbox w `help.astro`) LUB fixed overlay z `useBodyScrollLock` — wzorzec z `ConfirmDialog.tsx`
- Pola: `title` (input, required, max 200), `description` (textarea, required, max 2000, min-h `h-28`), `url` (input, prefilled z `window.location.href`, edytowalny)
- Submit: `fetch('/api/feedback', { method: 'POST', body: JSON.stringify({...}) })`; `submitting=true` podczas; na 201 → `success=true` + zachowaj `issueNumber`/`issueUrl` z odpowiedzi → wyświetl "Zgłoszenie #N →" jako klikalny link przez 2.5s → auto-close; na błędzie → `error=message`
- Escape + backdrop close (taki sam wzorzec jak CostAnalysisModal)
- `data-testid="bug-report-modal"`, `data-testid="bug-report-form"`, `data-testid="bug-report-submit"`

#### 2. Layout.astro — island w headerze

**Plik**: `src/layouts/Layout.astro`

**Cel**: Osadzić BugReportModal jako `client:load` island w prawej stronie headera — tylko dla zalogowanego usera (unikamy wyświetlania przycisku na stronie logowania).

**Kontrakt**:
- Import: `import BugReportModal from '../components/BugReportModal';` w frontmatter
- Wstawić `{user && <BugReportModal client:load />}` po Help link (po linii 173), wewnątrz `<div class="ml-auto flex ...">` (linia 146)
- Brak nowych propów — island sam pobiera URL

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

#### Weryfikacja ręczna:

- Przycisk widoczny w headerze po zalogowaniu, niewidoczny na `/login`
- Kliknięcie otwiera modal
- Pole URL prefillowane aktualnym URL
- Submit z poprawnymi danymi → sukces z numerem i linkiem issue → modal zamknięty po ~2.5s
- Submit bez tytułu → walidacja inline (brak wysłania)
- Network error → inline error z komunikatem

---

## Faza 3: E2E test

### Przegląd

Spec Playwright: otwarcie modalu, wypełnienie formularza, mock GitHub API, weryfikacja sukcesu.

### Wymagane zmiany:

#### 1. bug-report.spec.ts

**Plik**: `tests/e2e/bug-report.spec.ts` (nowy plik)

**Cel**: Zweryfikować golden path + podstawowe przypadki brzegowe formularza bug report.

**Kontrakt**:
- `page.route('**/api/feedback', route => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { issueNumber: 42, issueUrl: 'https://github.com/dariuszdanowski/bookshelf/issues/42' } }) }))` — jedyne prawidłowe podejście; github.com URL jest server-side i niedostępny dla Playwright
- Test 1: Nawigacja do `/library` (auth) → `getByTestId('bug-report-trigger')` widoczny → kliknięcie → modal otwarty → wypełnienie pól → submit → modal zamknięty
- Test 2: Walidacja — submit bez tytułu → modal nadal otwarty (brak zamknięcia), pole tytułu z błędem
- Test 3: `/login` page → `bug-report-trigger` niewidoczny (brak auth → island nie renderuje)

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run test:e2e -- --grep "bug-report"` — wszystkie 3 testy zielone

#### Weryfikacja ręczna:

- Pełny `npm run test:e2e` bez regresji w innych specach

---

## Strategia testowania

### Testy jednostkowe:

Nie wymagane — logika Zod schema jest prosta, E2E pokrywa integrację. Gdyby był czas: unit test `FeedbackSchema` w `tests/unit/feedback/schema.test.ts`.

### Testy E2E:

- Golden path (modal → form → submit → sukces) z mock `/api/feedback`
- Walidacja pól po stronie klienta
- Weryfikacja że przycisk jest ukryty bez auth

### Kroki testowania ręcznego (po deploy):

1. Zaloguj się na konto testowe
2. Kliknij „Zgłoś błąd" — modal otwiera się z aktualnym URL
3. Wpisz tytuł „Test" i opis „Testowe zgłoszenie" → Submit
4. Sprawdź github.com/dariuszdanowski/bookshelf/issues — issue nr X powinien istnieć z etykietą `bug`
5. Na `/login` — przycisk niewidoczny

## Uwagi dotyczące migracji

Brak zmian w DB. Worker secret `GITHUB_TOKEN` musi być dodany:
- Prod: `npx wrangler secret put GITHUB_TOKEN` (podaj fine-grained PAT z uprawnieniem `issues: write`)
- Local: `.dev.vars` z placeholderem (lub prawdziwym tokenem do testów ręcznych)

Fine-grained PAT: github.com/settings/tokens → Fine-grained → Repository access: `dariuszdanowski/bookshelf` → Permissions: `Issues: Read and write`.

## Referencje

- Wzorzec endpointu: `src/pages/api/account/keys/index.ts`
- Modal pattern: `src/components/ConfirmDialog.tsx`
- Env typing: `src/env.d.ts:17-26`
- Response helpers: `src/lib/http/response.ts`
- Layout header placement: `src/layouts/Layout.astro:146-174`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Backend

#### Automatyczne

- [x] 1.1 Typecheck przechodzi: `npm run typecheck` — ed69c13
- [x] 1.2 Lint przechodzi: `npm run lint` — ed69c13

#### Ręczne

- [ ] 1.3 POST /api/feedback z sesją → 201 + issue w GitHub
- [ ] 1.4 Brak tokenu → 503 z komunikatem
- [ ] 1.5 Niezalogowany → 401

### Faza 2: Frontend

#### Automatyczne

- [x] 2.1 Typecheck przechodzi: `npm run typecheck` — a8c64a0
- [x] 2.2 Lint przechodzi: `npm run lint` — a8c64a0

#### Ręczne

- [ ] 2.3 Przycisk widoczny po zalogowaniu, ukryty na /login
- [ ] 2.4 Modal otwiera się, URL prefillowany
- [ ] 2.5 Submit sukces → numer i link issue widoczny → modal zamknięty po ~2.5s

### Faza 3: E2E test

#### Automatyczne

- [x] 3.1 `npm run test:e2e -- --grep "bug-report"` — 3 testy zielone
- [ ] 3.2 Pełny `npm run test:e2e` bez regresji
