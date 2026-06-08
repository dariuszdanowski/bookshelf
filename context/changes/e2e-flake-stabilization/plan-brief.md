# S-44 e2e-flake-stabilization — Plan Brief

> Full plan: `context/changes/e2e-flake-stabilization/plan.md`

## What & Why

Pełny `npm run test:e2e` jest niedeterministyczny: trzy specy zielone w izolacji
padają w pełnym przebiegu na współdzielonej sesji. Utwardzamy je w warstwie testów,
by run był powtarzalnie zielony przy `retries: 0` — bez maskowania globalnym retry.

## Starting Point

39 speców Playwright, współdzielona sesja (1 signup/run, storageState), `workers:1`
+ `retries:2` w CI, `npm run dev` jako webServer. Brak centralnych helperów —
wzorce oczekiwań powtarzane inline. Trzy znane flaki: `account.spec` (UserMenu),
`shelves.spec` (create), `dark-mode-contrast.spec` (hover).

## Desired End State

`npm run test:e2e` przechodzi 3× pod rząd lokalnie. Wspólny moduł
`tests/e2e/helpers/interactions.ts` hermetyzuje deterministyczne interakcje,
`tests/e2e/AGENTS.md` dokumentuje wzorzec. Zero zmian w kodzie produkcyjnym.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Warstwa naprawy | Tylko testy, zero prod-kodu | Istniejące `*-loading` testidy + obserwowalne side-effecty wystarczają jako sygnały gotowości |
| Lost-click (menu) | `expect(...).toPass()` retry na otwarcie | Bounded, asercją-walidowany retry pojedynczej interakcji — nie globalny retry |
| Timing mutacji | `waitForResponse('**/api/shelves')` zamiast gołego 5s | Czekanie na realny stan, nie na zegar |
| Odczyt hover | Polling computed-style przez `toPass` | Deterministyczny; realnie zły kolor wciąż failuje |
| Reuse | Wspólny `helpers/interactions.ts` + AGENTS.md | Brak helperów dziś; jeden mechanizm dla 39 speców |
| CI `retries:2` | Zostaje | Siatka na infra-blip (JWT iat-skew), nie crutch — fix celuje w `retries:0` |

## Scope

**In scope:** moduł helperów (3 prymitywy); naprawa 3 nazwanych flaków; sweep tych
samych antywzorców (UserMenu-open, transient hover-read, mutation-timing,
`waitForTimeout` w `cost-panel`); wpis w AGENTS.md.

**Out of scope:** kod produkcyjny (komponenty/endpointy/prod-markery hydratacji);
zmiana `retries:2` w CI; model sesji (per-spec re-auth); globalny retry.

## Architecture / Approach

Trzy deterministyczne prymitywy w `helpers/interactions.ts`: `openUserMenu`
(retry-open walidowany widocznością dropdownu), `createShelf` (fill +
`waitForResponse` POST + asercja wiersza), `expectHoverBg` (hover + polling
computed-style do oczekiwanej wartości). Faza 1 buduje moduł, Faza 2 podłącza
3 flaki, Faza 3 zamiata resztę identycznych wzorców.

## Phases at a Glance

| Faza | Dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Helpery | `helpers/interactions.ts` + AGENTS.md, 1 flak podpięty | Sygnatura helpera nietrafiona → poprawka w Fazie 2 |
| 2. 3 flaki | account/shelves/dark-mode na helperach | `createShelf` mutation-wait nie pokrywa rename/delete |
| 3. Sweep | pełny run deterministyczny + `waitForTimeout` usunięty | Ukryty flak poza zidentyfikowaną powierzchnią |

**Prerequisites:** brak (S-44 bez prerequisites). Lokalne binarki Playwright obecne.
**Estimated effort:** ~1 sesja, 3 fazy.

## Open Risks & Assumptions

- Założenie: flaki to hydratacja + timing, nie wygasanie sesji (zweryfikowane w
  kodzie: UserMenu lost-click, ShelvesIsland refetch-timing).
- Ryzyko: pełny run może odsłonić flak poza zidentyfikowaną powierzchnią — Faza 3
  z 3× pełnym runem go wyłapie; jeśli wyjdzie, dopina się helperem lub raportuje.

## Success Criteria (Summary)

- Pełny `npm run test:e2e` zielony 3× pod rząd lokalnie (retries:0).
- Brak `page.waitForTimeout` w `tests/e2e/**` poza dokumentacją.
- Typecheck + lint zielone.
