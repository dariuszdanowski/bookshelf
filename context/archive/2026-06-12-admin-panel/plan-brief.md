# Plan Brief: Panel administracyjny (S-26)

## What & Why

Panel dla userów z `profiles.is_admin=true`: lista użytkowników, toggle `ai_enabled`, impersonacja przez magic link, soft delete z anonimizacją. Kolumny `is_admin` i `ai_enabled` już istnieją w schemacie (migration 0014) — dodajemy brakującą logikę dostępu i UI.

## 3 Phases

| Faza | Scope | Migracja |
|---|---|---|
| Phase 1 | Service-role client + guard `requireAdmin` + `ADMIN_REQUIRED` w ApiErrorCode + strona `/admin` (stub) + conditional nav link (guard `ai_enabled` w process/refine już istnieje — tylko weryfikacja) | brak |
| Phase 2 | Migracja 0023 (`profiles.deleted_at`, item 0) + GET `/api/admin/users` (merge auth.users + profiles + liczniki) + PATCH `ai-enabled` + `AdminUsersIsland.tsx` z tabelą i togglem | **0023** |
| Phase 3 | POST impersonate + POST delete (soft) + rozszerzenie AdminUsersIsland + E2E tests | brak |

## Key Decisions

- **Guard kolejność** (process/refine): auth → `ai_enabled` → BYOK. Wyłączenie AI blokuje niezależnie od klucza.
- **Service-role client** (`supabase.admin.ts`): tworzony on-demand w endpoincie, nie w `App.Locals`. `autoRefreshToken: false`.
- **Soft delete**: krok 1 DB (profiles: `deleted_at` + `display_name='Użytkownik usunięty'`), krok 2 Auth best-effort (`updateUserById` zmiana emaila + random password). Dane (books/shelves/photos) pozostają.
- **Impersonacja**: `generateLink({ type: 'magiclink', email })` → `action_link` → frontend redirect.

## Files Touched (summary)

**Phase 1 (7 plików)**:
- Nowe: `src/lib/db/supabase.admin.ts`, `src/lib/admin/guard.ts`, `src/pages/admin.astro`
- Zmienione: `src/lib/http/response.ts`, `src/layouts/Layout.astro`, `src/components/UserMenu.tsx`, `src/components/MobileNav.tsx`
- Bez zmian (guard ai_enabled już istnieje): `src/pages/api/photos/[id]/process.ts`, `src/pages/api/detections/[id]/refine.ts`

**Phase 2 (5 plików)**:
- Nowe: `supabase/migrations/0023_profiles_soft_delete.sql`, `src/pages/api/admin/users/index.ts`, `src/pages/api/admin/users/[id]/ai-enabled.ts`, `src/components/AdminUsersIsland.tsx`
- Zmienione: `src/pages/admin.astro`

**Phase 3 (4 pliki)**:
- Nowe: `src/pages/api/admin/users/[id]/impersonate.ts`, `src/pages/api/admin/users/[id]/delete.ts`, `tests/e2e/admin.spec.ts`
- Zmienione: `src/components/AdminUsersIsland.tsx`

## Risk

Impersonacja wymaga poprawnego `SITE_URL` w Supabase dashboard (dev: `http://localhost:4321`, prod: Workers URL) — do weryfikacji manualnej po Phase 3 deploy.
