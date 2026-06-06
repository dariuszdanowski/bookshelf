---
change_id: manual-cover-match
title: "S-19: Ręczny match z Google Books w review (alignment-closure)"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T01:00:00Z
---

## Notes

Audyt kodu (2026-06-07) wykazał, że Outcome S-19 jest **w całości pokryty wcześniejszą
pracą** — bez planu i implementacji, change to closure + domknięcie luki testowej:

- „Szukaj po tytule" (RematchForm) dostępny dla detekcji **bez** kandydatów ORAZ
  **z** kandydatami (`DetectionReview.tsx` — cards L1001-1034, rows L1274+, tiles L1499+;
  wynik z S-23 per-detection-rematch + image-identification-dual-path p2)
- Wyniki niosą okładkę + ISBN + metadane (`BookCandidateDTO`); wybór spośród top+altów
  (`selectedCandidateId`) ustawia aktywnego kandydata → confirm
- Server-side conservative-replace guard (`CONSERVATIVE_REPLACE_MARGIN` w rematch.ts)

## Outcome

Jedyna realna luka: brak pokrycia E2E ścieżki „rematch przy ISTNIEJĄCYM (złym)
kandydacie". Dodane 2 scenariusze w `tests/e2e/manual-rematch.spec.ts` (przycisk
widoczny mimo kandydata + prefill ISBN topa; podmiana złego kandydata właściwym
z metadanymi i dostępnym confirm). Roadmapa: S-19 → done z notą alignment.
