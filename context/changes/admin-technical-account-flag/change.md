---
id: admin-technical-account-flag
title: "S-47: Admin — flaga is_technical w DB"
status: impl_reviewed
created: 2026-06-13
updated: 2026-06-13
roadmap_id: S-47
---

## Summary

Dodanie kolumny `is_technical BOOLEAN DEFAULT false` do tabeli `profiles` i toggle w panelu admina.
Zastąpienie heurystyki email-prefix + `book_count===0 && !display_name` w `isAutomatic()` niezawodnym sygnałem DB-level.
