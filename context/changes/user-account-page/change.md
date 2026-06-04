---
change_id: user-account-page
roadmap_slice: S-31
status: implementing
created: 2026-06-04
updated: 2026-06-04
---

# S-31 — Strona /account (profil użytkownika)

Strona `/account`: edycja `display_name` (PATCH `/api/account/profile`), zmiana
emaila i hasła (Supabase Auth `updateUser`), blok statystyk kosztów vision
(konsumuje istniejący `GET /api/account/stats` z S-30), placeholder sekcji
kluczy API (wypełni S-32 BYOK).

Prereq: S-01. Parallel-with: S-30 (done), S-35 (done).
