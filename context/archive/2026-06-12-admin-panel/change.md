---
id: admin-panel
title: Panel administracyjny
status: archived
created: 2026-06-12
updated: 2026-06-12
archived_at: 2026-06-12T21:35:19Z
roadmap_id: S-26
branch: change/admin-panel
---

## Cel

Panel administracyjny dla użytkowników z flagą `is_admin=true`: lista userów, przełącznik `ai_enabled`, impersonacja przez magic link, soft delete konta z anonimizacją.

## Scope

- Phase 1: service-role client + guard `ai_enabled` w vision pipeline + strona `/admin` z bramką
- Phase 2: lista użytkowników + toggle `ai_enabled`
- Phase 3: impersonacja + soft delete konta

## Powiązania

- Roadmapa: S-26 admin-panel (proposed → in-progress)
- Prerequizity: S-01 (auth, done), F-01 (RLS, done), migration 0014 (is_admin + ai_enabled, done)
