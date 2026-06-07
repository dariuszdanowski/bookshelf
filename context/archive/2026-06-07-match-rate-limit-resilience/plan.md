# S-39: Odporność auto-matchu na 429 GB — Implementation Plan

## Overview

Retry+backoff w kliencie GB (rdzeń — usuwa ciche gubienie dopasowań) + widoczność
resztkowych rate-limitów (licznik w `/match` + toast w tabie Zdjęcia).

## Current State Analysis

- [src/lib/books/googleBooks.ts:88](src/lib/books/googleBooks.ts): `429 → rate_limited`
  natychmiast, zero retry; kaskada zapytań traktuje `rate_limited` jako terminalne.
- [src/pages/api/photos/\[id\]/match.ts](src/pages/api/photos/[id]/match.ts):
  `MATCH_CONCURRENCY=5`, graceful degrade (rate-limited → status bez zmian, retriable),
  globalne 429 tylko gdy WSZYSTKIE detekcje ścięte; payload nie niesie liczby ściętych.
- `PhotoListIsland.runMatch`: ignoruje payload sukcesu; ma mechanizm toastów per wiersz.
- DetectionReview po matchu robi reload — komunikat tam nie przeżyje (adaptacja: toast
  w tabie Zdjęcia).
- Dowód prod: 9/14 pending z 0 kandydatów na popularnych tytułach (photo `e9876820…`).

## What We're NOT Doing

- Zmiany MATCH_CONCURRENCY (retry adresuje sedno; tuning concurrency = osobny eksperyment),
  kolejka/cache GB, komunikat w DetectionReview (reload), persystencja info o rate-limit w DB.

## Phase 1: Retry+backoff w fetchBooks

**File**: `src/lib/books/googleBooks.ts`

**Intent**: 429 to stan przejściowy QPS — ponowienie po krótkiej pauzie odzyskuje wynik.

**Contract**: `fetchBooks` próbuje do 3× (1 + 2 retry) wyłącznie na 429; opóźnienia
`RATE_LIMIT_RETRY_DELAYS_MS = [500, 1500]` + jitter 0–250 ms; inne błędy bez zmian.
Eksport stałej dla testów. Czas czekania = wall-clock (CF Workers: nie liczy się do CPU).
Testy istniejące `returns rate_limited on 429` i `stops cascade immediately` aktualizowane
pod nową semantykę (fake timers; 3 fetch-calle na stage przed poddaniem).

## Phase 2: Widoczność resztkowych rate-limitów

**Files**: `src/pages/api/photos/[id]/match.ts`, `src/components/PhotoListIsland.tsx`

**Intent**: gdy mimo retry coś zostało ścięte, user wie, że to limit (nie brak książki)
i że „Ponów match" pomoże.

**Contract**: payload `/match` rozszerzony o `rate_limited: number` (licznik detekcji
ze ściętym wynikiem; istniejące pola bez zmian — klienci ignorujący pole działają jak
dotąd). `runMatch` w PhotoListIsland: gdy `rate_limited > 0` → toast
„Dopasowano {matched} · {n} pozycji wstrzymał limit Google — ponów za chwilę".

## Testing Strategy

Unit: googleBooks (429→sukces przy 2. próbie z fake timers; 3×429 → rate_limited +
liczba wywołań; delay'e wg stałej), match.test (payload z licznikiem), PhotoListIsland
(toast przy rate_limited>0). E2E: regresja pełna (match mockowany — bez nowych scenariuszy).

## References

- Diagnoza + dane prod: `change.md`; roadmapa S-39.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>`.

### Phase 1: Retry+backoff w fetchBooks

#### Automated

- [ ] 1.1 Typecheck / Lint / Unit zielone (googleBooks z fake timers)

### Phase 2: Widoczność resztkowych rate-limitów

#### Automated

- [ ] 2.1 Typecheck / Lint / Unit / E2E zielone

#### Manual

- [ ] 2.2 Re-match zdjęcia `e9876820…` na prod — pending z 0 kandydatów spada do ~0 (user-only)
