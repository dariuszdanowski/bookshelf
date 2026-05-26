# health-check-endpoint — Implementation Plan (Stream E micro-slice)

## Overview

Public GET `/api/health` zwracający `{data:{status:"ok",version:"<pkg version>",timestamp:"<iso>"}}` z F-02 envelope (`apiResponse` helper). Wymaga whitelist'u w middleware (bez tego endpoint zostanie zablokowany przez auth guard z 401). Bezpośrednia wartość: load balancer / monitoring / smoke checks (zob. lesson „Worker Secret validation" w `lessons.md` — przyszły deploy smoke test może hitować ten endpoint).

## Current State Analysis

- `src/lib/middleware/handler.ts:15-20` ma `PUBLIC_EXACT = new Set(['/', '/login', '/signup'])` i `PUBLIC_PREFIXES = ['/api/auth/']`. Każdy inny path wymaga zalogowanego usera.
- F-02 `apiResponse` helper w `src/lib/http/response.ts` — wymaga konsumpcji.
- `package.json` ma `"version": "0.1.0"` — endpoint zwraca to (import statyczny jest OK, Astro inline'uje przez Vite).

## Desired End State

- `GET /api/health` zwraca HTTP 200 + `{"data":{"status":"ok","version":"0.1.0","timestamp":"2026-..."}}` + `Cache-Control: private, no-store` (F-02 default).
- Dostępny bez logowania (`PUBLIC_EXACT` zawiera `/api/health`).
- Middleware test (`tests/unit/middleware.test.ts`) — istniejące testy NIE złamane (regression check); ale opcjonalnie dorzucić test że `/api/health` przechodzi bez auth.

## What We're NOT Doing

- Nie zwracać `database: up/down` (wymagałoby query do Supabase — slice scope-creep; osobny micro-slice „deep health check" jeśli kiedyś potrzebny).
- Nie dodawać liveness/readiness separation (k8s pattern, overkill dla CF Workers).
- Nie tykać `src/pages/index.astro`, `Layout.astro`, `LogoutButton.tsx`, `src/pages/404.astro`, `src/components/Skeleton.tsx` ani żadnego pliku poza scope poniżej (pozostałe 3 slice'y w Stream E bucketcie tykają tych plików).

## Phase 1: Endpoint + middleware whitelist + test

### Changes Required:

1. **`src/pages/api/health.ts`** (NEW): export `const GET: APIRoute = () => apiResponse({ data: { status: 'ok' as const, version: PKG_VERSION, timestamp: new Date().toISOString() } });` plus `export const prerender = false;` (wymóg `@astrojs/cloudflare`). Import version przez `import pkg from '../../../package.json'` (Astro + Vite obsługuje JSON imports) lub przez Vite `define` jeśli istnieje — najprościej JSON import.

2. **`src/lib/middleware/handler.ts`** (edit): dodać `/api/health` do `PUBLIC_EXACT` Set. Jedna linia: `const PUBLIC_EXACT = new Set(['/', '/login', '/signup', '/api/health']);`.

3. **`tests/unit/pages/api/health.test.ts`** (NEW): minimum 2 testy:
   - GET `/api/health` zwraca 200 + envelope `{data:{status:"ok",version:"<str>",timestamp:"<str>"}}` + `Cache-Control: private, no-store`.
   - `timestamp` parsuje się jako poprawny ISO string (`new Date(json.data.timestamp).toString() !== 'Invalid Date'`).

### Success Criteria

#### Automated

- `npm run typecheck` zielony
- `npm run lint` zielony
- `npm run test` zielony — istniejące 55 testów + minimum 2 nowe dla health endpoint. middleware.test.ts pozostaje zielony (jeden nowy `PUBLIC_EXACT` entry nie psuje istniejących testów).

#### Manual

- Code review: GET zwraca przez apiResponse; middleware ma `/api/health` w whitelist; PKG version importowany statycznie

## References

- S-11 w roadmapie: `context/foundation/roadmap.md`
- F-02 `apiResponse`: `src/lib/http/response.ts`
- Middleware whitelist: `src/lib/middleware/handler.ts:15-20`
- Lesson „Worker Secret validation" — `/api/health` może w przyszłości pojechać po deploy smoke jako monitor endpoint: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Endpoint + middleware whitelist + test

#### Automated

- [ ] 1.1 `npm run typecheck` zielony
- [ ] 1.2 `npm run lint` zielony
- [ ] 1.3 `npm run test` zielony — minimum 2 nowe testy dla `/api/health` + middleware regression

#### Manual

- [ ] 1.4 Code review: endpoint używa apiResponse + prerender=false; middleware ma /api/health w PUBLIC_EXACT
