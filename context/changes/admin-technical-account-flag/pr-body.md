## Summary

- Dodaje kolumnę `profiles.is_technical BOOLEAN NOT NULL DEFAULT false` z backfillem kont `e2e-`, `ux-verify-`, `debug-vision-`, `rls-test-`, `auth-trigger-`
- Zastępuje heurystykę (`TECHNICAL_EMAIL_PREFIXES` + `book_count===0 && !display_name`) jednym sygnałem DB-level w `isAutomatic()`
- Nowy endpoint `PATCH /api/admin/users/[id]/technical` (kopia wzorca `ai-enabled.ts`)
- Kolumna „Tech" z checkboxem toggle w panelu admina (jak AI)
- E2E: testy toggle is_technical (optimistic + persist) + filtrowanie hideAutomatic po fladze DB

## Changes

| Plik | Co |
|---|---|
| `supabase/migrations/0025_profiles_is_technical.sql` | Kolumna + partial index + backfill |
| `src/pages/api/admin/users/index.ts` | `UserAdminDTO.is_technical` + SELECT + mapping |
| `src/pages/api/admin/users/[id]/technical.ts` | Nowy PATCH endpoint |
| `src/components/AdminUsersIsland.tsx` | Toggle Tech + uproszczony `isAutomatic()` + colSpan 8→9 |
| `tests/e2e/admin.spec.ts` | 2 nowe testy + fix beforeAll error-check |

## impl-review

APPROVED — 0 critical, 1 warning (auto-fixed: error-check na beforeAll backfill), 3 obs skipped.

## Test plan

- [ ] E2E `npm run test:e2e -- tests/e2e/admin.spec.ts` — 20/20 zielone lokalnie
- [ ] Manual: `/admin` → kolumna Tech widoczna, toggle działa, persystuje po reload
- [ ] Manual: konto z `is_technical=true` znika przy „Ukryj konta automatyczne"
- [ ] Manual: konto z `book_count=0` i `is_technical=false` nadal widoczne (fallback usunięty)
- [ ] Po merge: `supabase db push` (automatyczny w deploy.yml) backfilluje istniejące konta e2e-

🤖 Generated with [Claude Code](https://claude.com/claude-code)
