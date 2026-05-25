# F-01: Persystencja + izolacja per-user — Plan Brief

> Full plan: `context/changes/data-and-rls-substrate/plan.md`

## What & Why

Zamknięcie partial-baseline warstwy danych (roadmap slice F-01). Migracje 8 tabel + RLS są już napisane, ale niezastosowane, a `src/lib/db/` puste. F-01 aplikuje migracje, generuje typ `Database`, dostarcza RLS-respecting typowane klienty i dowodzi izolacji per-user — bo guardrail prywatności ("user A nie widzi danych B") jest blokujący launch i musi być egzekwowany w bazie, zanim ruszą jakiekolwiek widoki.

## Starting Point

Migracje `0001` (8 tabel + indeksy + CHECK enums) i `0002` (RLS na każdej tabeli, bezpośrednie + przez-parent) napisane; projekt Supabase zlinkowany, ale migracje niezastosowane. Astro 6 + Cloudflare Workers (`nodejs_compat` on), `@supabase/ssr` + `@supabase/supabase-js` w deps. `src/lib/db/` puste, brak typu `Database`, brak pipeline'u `supabase gen types`.

## Desired End State

Zdalny projekt ma zastosowane migracje (8 tabel z RLS); `src/lib/db/database.types.ts` eksportuje `Database`; dwa typowane klienty (server SSR + browser, anon key, zero service-role) kompilują się; test integracyjny Vitest dowodzi, że user A nie widzi danych user B. Substrat gotowy pod S-01…S-08.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Model klienta server | RLS-respecting (anon + JWT), bez service-role | Guardrail prywatności egzekwowany w bazie, nie w kodzie app | Plan |
| Workflow CLI | Tylko zdalnie (`npx supabase db push`), bez Dockera | Najszybsze, omija firewall na binarki i zależność od Docker | Plan |
| Weryfikacja RLS | Vitest, 2 userów przez admin API, cross-user assertion | Bez Dockera, CI-ready, w tym samym runnerze | Plan |
| Definition-of-done | Ściśle substrat (migracje + klienty + test RLS) | Test RLS już ćwiczy klient+bazę; zgodne z outcome F-01 | Plan |
| Trigger profiles/„Zakupione" | Odłożony do S-01/S-02 | F-01 nie wciąga zależności od auth flow (dekompozycja roadmapy) | Plan |
| Miejsce testu integ. | `tests/integration/` + osobny config, poza `npm run test` | Drogie/sieciowe testy poza domyślnym offline runem (CLAUDE.md) | Plan |

## Scope

**In scope:** aplikacja migracji 0001+0002 (zdalnie); skrypt `db:types` + `database.types.ts`; `supabase.server.ts` (SSR, RLS) + `supabase.browser.ts` (anon); test integracyjny izolacji RLS + osobny config/skrypt.

**Out of scope:** klient service-role/admin (w kodzie app); `env.d.ts`/typowanie `runtime.env`; middleware/guard (F-02); UI logowania (S-01); trigger profiles/„Zakupione" (S-01/S-02); endpointy + response envelope (F-02); Docker/local stack; bucket Storage (S-03).

## Architecture / Approach

Trzy fazy w kolejności zależności: (1) stan bazy + typ `Database`, (2) klienty konsumujące typ, (3) dowód izolacji egzekwowanej przez bazę. Klienty używają wyłącznie `PUBLIC_*` (URL + anon key) inline'owanych przez Vite — żadne wiring sekretów/`runtime.env` nie jest potrzebne w F-01. Test integracyjny konstruuje admin-klienta lokalnie (tylko w pliku testu) do tworzenia/sprzątania userów; admin nie trafia do `src/lib/db/`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migracje + typ | Migracje applied (zdalnie) + `database.types.ts` | Kolidujący stan na zlinkowanym projekcie z poprzednich prób |
| 2. Klienty | `supabase.server.ts` (SSR/RLS) + `supabase.browser.ts` | Zły kontrakt cookies `@supabase/ssr` (musi być getAll/setAll) |
| 3. Test RLS | Vitest cross-user isolation, osobny config | Userzy-śmiecie na zlinkowanym projekcie, gdy cleanup zawiedzie |

**Prerequisites:** Supabase CLI osiągalny przez `npx supabase` (NIE na PATH — zweryfikuj `npx supabase --version` przed Fazą 1; projekt zlinkowany); sieć do zlinkowanego projektu; `.env.local` z `PUBLIC_SUPABASE_URL`/`ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` (do testu). Firewall blokuje tylko pobranie binarki CLI, nie `db push`/`gen types`.
**Estimated effort:** ~1 sesja, 3 fazy.

## Open Risks & Assumptions

- Zakładamy, że zlinkowany projekt nie ma kolidującego stanu schematu z wcześniejszych prób (jeśli `push` zgłosi konflikt — sprawdź `migration list`, NIE `db reset` na danych demo).
- Test integracyjny tworzy realnych userów na zlinkowanym (możliwe prod/demo) projekcie; izolacja zależy od cleanupu w `afterAll`.
- Pełny Workers-runtime smoke (klient→DB pod miniflare) świadomie odłożony do pierwszego endpointu (S-01) — dev Astro używa Vite, nie miniflare.

## Success Criteria (Summary)

- Migracje 0001+0002 applied; 8 tabel z RLS w zlinkowanym projekcie.
- `npm run typecheck` zielony z typowanymi klientami; zero service-role w `src/lib/db/`.
- `npm run test:integration` dowodzi cross-user isolation (polityka bezpośrednia + przez-parent); domyślny `npm run test` pozostaje offline.
