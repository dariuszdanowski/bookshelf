---
change_id: match-rate-limit-resilience
title: "S-39: Odporność auto-matchu na 429 Google Books"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T11:45:00Z
---

## Notes

Diagnoza M11 (sesja 2026-06-07): `fetchBooks` w `googleBooks.ts` przy 429 zwraca
`rate_limited` bez retry; `/match` z `MATCH_CONCURRENCY=5` na 14 detekcji robi burst
ścinany przez QPS GB — rate-limited detekcje PO CICHU zostają `pending` z 0 kandydatów.
**Potwierdzone na danych prod**: zdjęcie `e9876820…` (2026-06-05) — 9/14 detekcji
pending z zerem kandydatów, w tym tytuły na pewno obecne w GB („MAFALDA TOM 1/2",
„WOJNA", „Potwory"). Ręczny rematch po minutach = pojedynczy request = sukces.

## Outcome

1. `fetchBooks`: do 2 retry na 429 z backoffem (500/1500 ms + jitter 0–250 ms);
   `rate_limited` dopiero po wyczerpaniu prób.
2. `/match` zwraca `rate_limited: <count>` w payloadzie; `PhotoListIsland.runMatch`
   pokazuje toast „Dopasowano X · N pozycji wstrzymał limit Google — ponów za chwilę".
   **Adaptacja względem noty w roadmapie**: komunikat w tabie Zdjęcia (toast per wiersz,
   bez reloadu), nie w review — review po matchu robi `window.location.reload()`,
   więc komunikat by nie przeżył; po retrach przypadek staje się rzadki.
