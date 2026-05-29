---
change_id: e2e-in-ci
title: Wpięcie testów E2E (Playwright) w pipeline CI
status: archived
created: 2026-05-29
updated: 2026-05-29
archived_at: 2026-05-29T21:44:13Z
---

## Notes

Domknięcie wymogu certyfikacji 10xDevs #5 (test E2E) i #6 (CI/CD: lint + typecheck + vitest + **playwright** + deploy). 10 speców Playwright już istnieje w `tests/e2e/`, ale `ci.yml` ich nie uruchamia.

Sedno decyzji (fork): skąd CI bierze bazę — `auth.setup.ts` robi realny signup, dev server (`npm run dev`) czyta `.dev.vars`. Werdykt rekomendowany: **lokalna Supabase w runnerze** (izolacja, zero zaśmiecania prod DB, deterministyczne stabilne klucze, za darmo, bonus: waliduje migracje na każdym runie — złapałaby dzisiejszy bug 0011 42P17 przed prod). Alternatywa (remote prod) tworzyłaby realnych userów + zapisy w prod przy każdym CI runie.

Vision/match/storage mockowane na poziomie API w przeglądarce (`page.route`) → server-side vision NIE jest wykonywany → CI **nie** potrzebuje `ANTHROPIC_API_KEY`.
