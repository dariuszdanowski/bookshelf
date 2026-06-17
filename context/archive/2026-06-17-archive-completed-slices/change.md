---
id: archive-completed-slices
title: Archiwizacja zakończonych zmian — local-supabase-dev-access + upgrade-actions-node20
status: archived
created: 2026-06-17
updated: 2026-06-17
archived: 2026-06-17
---

# archive-completed-slices

## Problem

Dwa ukończone slice'y (`local-supabase-dev-access`, `upgrade-actions-node20`) mają
zmergowane PR-y na main, ale nadal siedzą w `context/changes/` z przestarzałym statusem.
Zaśmiecają listę aktywnych zmian.

## Cel

Przenieść oba ukończone slice'y do `context/archive/` zgodnie ze standardowym cyklem
`/10x-archive`, żeby `context/changes/` pokazywał tylko aktywne prace.
