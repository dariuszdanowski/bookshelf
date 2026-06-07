---
change_id: review-ux-pack
title: "Pakiet C: review-UX (M19, M20, M22, M23)"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T11:55:00Z
---

## Notes

Pakiet C z rundy 2 manualnych testów (lista M13–M23 w raporcie sesji 2026-06-07).
Wszystkie przyczyny zweryfikowane w kodzie przed startem:

- **M19**: rows/tiles renderują „Szukaj" tylko w gałęzi `!top` (`top ? Popraw : Szukaj+Wpisz`,
  DetectionReview ~L1402/L1668); render `RematchForm` jest już bezwarunkowy — wystarczy
  dodać przycisk do gałęzi `top`. **Sprostowanie do S-19 closure**: audyt twierdził
  „wszystkie 3 tryby" — prawdziwe tylko dla detekcji bez kandydata.
- **M20**: `useDetectionDecision` startuje ze stanu `pending` niezależnie od
  `detection.status` z DB → potwierdzona detekcja renderuje pełne UI akceptacji
  i dedup melduje „Masz już tę książkę" (absurd przy wejściu deep-linkiem S-37).
- **M22**: brak pola wydawnictwa w łańcuchu rematch (form → schema → endpoint →
  findBookCandidates → searchGoogleBooks); GB wspiera `inpublisher:`.
- **M23**: user wyłącza lightbox po kliknięciu (zoom/pan + pinch wystarczają);
  „wyłącz, nie kasuj" — komponent + jego testy zostają.

## Outcome

1. **M19**: „Szukaj po tytule" dostępny w trybach Lista i Kafelki także przy
   istniejącym kandydacie (parytet z Kartami).
2. **M20**: detekcja ze statusem DB `confirmed` od wejścia renderuje widok
   „dodano do katalogu" (bez przycisków akceptacji); liczniki „pozostało" je
   uwzględniają; auto-redirect po skompletowaniu wymaga AKCJI w sesji (wejście
   deep-linkiem na w pełni potwierdzone zdjęcie NIE wyrzuca na półkę).
3. **M22**: opcjonalne pole „Wydawnictwo" w RematchForm → `inpublisher:` w kaskadzie
   GB (etap po intitle+inauthor); tylko ścieżka ręczna (auto-match bez zmian).
4. **M23**: klik w zdjęcie nie otwiera lightboxa; `PhotoLightbox` + testy unit
   zostają; E2E lightboxa = `describe.skip` z notą; roadmapa S-24 z notą o wyłączeniu.
