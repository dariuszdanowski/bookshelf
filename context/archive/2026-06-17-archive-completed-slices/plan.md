---
id: archive-completed-slices
title: Archiwizacja local-supabase-dev-access + upgrade-actions-node20
status: implementing
created: 2026-06-17
updated: 2026-06-17
complexity: LOW
---

# Plan: archive-completed-slices

## Problem Statement

`context/changes/` zawiera dwa ukończone slice'y z PR-ami już na main:
- `local-supabase-dev-access` (status: implementing — PR zmergowany do main 2026-06-11/12)
- `upgrade-actions-node20` (status: implementing — PR #99 zmergowany 2026-06-17)

Standard projektu: po merge PR → `/10x-archive` przenosi do `context/archive/`.

## Decyzje (fast-track)

| Obszar | Decyzja | Uzasadnienie |
|---|---|---|
| Prefix daty w archive | `2026-06-17-` | Konwencja z istniejących 4 archiwów |
| Status po przeniesieniu | `archived` (update w change.md) | Standard cyklu |
| Roadmap update | Nie (nie mają roadmap_id) | Brak mapowania — nie dotykamy roadmap.md |

## Fazy

### Faza 1 — Przenieś oba slice'y do archive

**Touched files:**
- `context/changes/local-supabase-dev-access/` → `context/archive/2026-06-17-local-supabase-dev-access/`
- `context/changes/upgrade-actions-node20/` → `context/archive/2026-06-17-upgrade-actions-node20/`
- Update `change.md` w obu archiwach: `status: archived`

**Weryfikacja:**
- `ls context/changes/` nie zawiera archiwizowanych slice'ów
- `ls context/archive/` zawiera oba nowe katalogi
- `git status` pokazuje git mv (rename)

**Commit:** `chore(archive): close local-supabase-dev-access + upgrade-actions-node20`

## Success criteria

- [ ] `context/changes/` zawiera tylko aktywne slice'y (bez `local-supabase-dev-access` i `upgrade-actions-node20`)
- [ ] `context/archive/2026-06-17-local-supabase-dev-access/` istnieje ze statusem `archived`
- [ ] `context/archive/2026-06-17-upgrade-actions-node20/` istnieje ze statusem `archived`
- [ ] Brak innych plików zmienionych
