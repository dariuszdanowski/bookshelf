---
change_id: vision-cost-preservation
title: Zachowanie historii kosztów vision przy DELETE zdjęć (S-30)
status: archived
created: 2026-06-03
updated: 2026-06-03
archived_at: 2026-06-03T19:57:13Z
---

## Notes

Roadmap S-30 / backlog uwaga F. Prereq dla S-29 (photos-crud DELETE nie może
tracić historii kosztów vision). Migracja FK CASCADE→SET NULL + denorm user_id +
endpoint GET /api/account/stats.
