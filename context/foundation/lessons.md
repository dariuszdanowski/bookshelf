# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Load-bearing convention detail wymusza kod, nie prozę w CLAUDE.md

- **Context**: API endpoints w `src/pages/api/` — każdy nowy endpoint zwracający JSON (M1: auth flow / shelves CRUD; M2: matching / library API; każdy kolejny później). Szerzej: każda konwencja stylistyczna lub security-header-tier, której naruszenie nie powoduje hard-failu kompilacji / lint'u.
- **Problem**: Empiryczny test N=3 (2026-05-20) pokazał, że mimo wpisanej w `CLAUDE.md > Konwencje > API endpoints` reguły o stabilnym error shape `{ error: { code, message } }`, `code` w SCREAMING_SNAKE_CASE, `Cache-Control: private, no-store` dla per-user data, oraz 404 dla zniekształconego UUID (privacy guardrail FR-NFR z PRD), agenci zacisnęli tylko 1 z 5 dywergencji vs baseline N=3 bez reguły. Jeden agent eksplicytnie **odrzucił regułę 404-dla-bad-UUID** jako mniej REST-ortodoxową. Sama proza w pliku reguł jest niewystarczającym enforcement'em dla load-bearing convention detail (enum casing, security header'y, response envelope shape) — agent czyta CLAUDE.md skanowaniem, nie weryfikuje sekcji "API endpoints" przed każdym endpoint'em.
- **Rule**: Dla load-bearing convention detail buduj enforcement-by-code **zanim** wpiszesz prozę: typed union (`type ApiErrorCode = "UNAUTHORIZED" | ...`) + response-builder helper (`apiResponse({ data })` / `apiError({ code, status, message })`) z security header'ami w defaultach. Wadliwa odpowiedź powinna **nie skompilować się**, nie "powinna się nie skompilować bo w CLAUDE.md tak napisaliśmy". Proza w CLAUDE.md zostaje jako 4-eyes principle przy code review, nie jako primary enforcement. Konkretny plan dla BookShelf już w `docs/plan-implementacji.md` M1 DoD: `src/lib/http/response.ts`.
- **Applies to**: plan, implement, impl-review

## Generowane artefakty pod ścieżką lintowaną → eslint ignore od razu

- **Context**: `src/lib/db/database.types.ts` (output `supabase gen types`) i ogólnie pliki generowane (np. `worker-configuration.d.ts` z `wrangler types`) leżące pod ścieżkami objętymi `npm run lint` lub kryteriami lint w planach.
- **Problem**: Generowany plik trafia pod ścieżkę lintowaną (np. kryterium „lint zielony na `src/lib/db/**`"); reguły ESLint mogą go oblać, mimo że nikt go nie edytuje ręcznie. Kryterium lint pada na nieedytowalnym kodzie, a „naprawa" oznaczałaby ręczną edycję pliku nadpisywanego przy każdej regeneracji.
- **Rule**: Generowane artefakty (typy z `supabase gen types`, `wrangler types`, itp.) dodawaj do `ignores` w `eslint.config.mjs` od razu przy ich wprowadzeniu — tak jak już zrobiono dla `worker-configuration.d.ts`. Kryteria lint pokrywają kod pisany ręcznie, nie generowany.
- **Applies to**: plan, implement, impl-review
