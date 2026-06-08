<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-38 Onboarding i pomoc kontekstowa (faza 3 — /help)

- **Plan**: context/changes/user-onboarding-help/plan.md
- **Scope**: Phase 3 of 3
- **Date**: 2026-06-08
- **Verdict**: APPROVED (po naprawie krytycznego F1)
- **Findings**: 1 critical (FIXED) · 1 warning (resolved) · 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS (po naprawie F1) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — /help martwy w produkcji (prerender → redirect na /login)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — oczywisty 1-liner
- **Dimension**: Safety & Quality / Plan Adherence
- **Location**: src/pages/help.astro:2
- **Detail**: `prerender = true` (zgodnie z planem) powodował, że przy prerenderze middleware emitował redirect `/help/ → /login` (trailing slash nie matchował `/help` w `PUBLIC_EXACT` w `handler.ts:39`) i zamrażał go jako statyczny `dist/client/help/index.html`. W produkcji każdy request na /help dostawał meta-refresh do /login — strona pomocy całkowicie niedostępna. Dev maskował problem (middleware biegnie per-request, nie z prerendera). Wykryte przez `npm run build` + grep wygenerowanego HTML.
- **Fix**: `prerender = false` → /help jako SSR. Rebuild potwierdza brak statycznego redirectu, route w `dist/server/chunks/help_*.mjs`. Powód planu dla prerender=true (obawa o `<Image>` na on-demand route, plan-review F1) nieaktualny — impl używa zwykłego `<img src={imported.src}>`.
- **Decision**: FIXED

### F2 — zalogowany user widział anon-header na prerenderowanym /help

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Adherence (UX)
- **Location**: src/pages/help.astro:2 + src/layouts/Layout.astro:14-26
- **Detail**: Prerender zamraża header z build-time `Astro.locals.user = undefined` → zalogowany user na /help widziałby anon-header (bez nav/UserMenu, tylko logo + pill Pomoc). Sprzeczne z intencją „header zawsze widoczny".
- **Fix**: rozwiązane przez fix F1 (SSR renderuje auth-aware header). Zweryfikowane — nav-library + user-menu-trigger obecne na /help.
- **Decision**: FIXED (via F1)

### F3 — logout.astro nie jest linkowany z nav

- **Severity**: ℹ️ OBSERVATION
- **Dimension**: Scope Discipline
- **Location**: src/pages/logout.astro
- **Detail**: Strona /logout (signOut + redirect) nie jest linkowana z UI; faktyczny logout idzie przez `/api/auth/logout` (UserMenu, LogoutButton). Agenci flagowali jako dead code, ale to **świadomy, wprost zamówiony przez usera** convenience-URL (GET /logout pod ręką). Zostaje.
- **Decision**: ACCEPTED (intencjonalne)

### F4 — UserMenu.tsx: nieużywany menuRef

- **Severity**: ℹ️ OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: src/components/UserMenu.tsx:10,71
- **Detail**: `menuRef` przypięty do diva dropdownu ale nigdy nie czytany (zamykanie poza obsługuje overlay div, nie ref). Kosmetyka.
- **Decision**: SKIPPED

### F5 — kruchy marker '__isAuthError' w middleware

- **Severity**: ℹ️ OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: src/lib/middleware/handler.ts:90
- **Detail**: Detekcja oczekiwanego błędu auth przez `'__isAuthError' in err` to nieudokumentowany wewnętrzny marker `@supabase/supabase-js` — kruchy przy bumpie SDK. Akceptowalne: jest fallback `user=null` niezależnie od gałęzi logowania.
- **Decision**: ACCEPTED

### F6 — PUBLIC_EXACT wrażliwy na trailing slash

- **Severity**: ℹ️ OBSERVATION
- **Dimension**: Architecture
- **Location**: src/lib/middleware/handler.ts:39-45
- **Detail**: `isPublicPath('/help/')` zwraca false (Set ma `/help` bez slasha) — to była współprzyczyna F1. Po fixie F1 (SSR + nav linkuje `/help`) normalne użycie OK, ale latentna kruchość zostaje dla wszystkich exact-paths. Defensywna normalizacja trailing-slash to osobny, szerszy refactor poza zakresem tej fazy.
- **Decision**: SKIPPED (osobny follow-up jeśli zajdzie)

## Scope note

EXTRA poza planem fazy 3 (wszystkie spójne z intencją onboardingu/pomocy): UserMenu + usunięcie linku „Moje konto" z desktop nav, dark-mode w PhotoUploader (potrzebne dla zrzutów dark na /help), wyciszenie oczekiwanych auth-errorów w middleware. **„Zero zmian w API" UPHELD** — żaden plik `src/pages/api/` nie tknięty (zweryfikowane `git show 3985248 -- src/pages/api/`).
