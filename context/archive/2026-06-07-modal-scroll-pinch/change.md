---
change_id: modal-scroll-pinch
title: "Body scroll lock dla modali + pinch-zoom zdjęcia (M5, M6)"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T10:55:00Z
---

## Notes

Pakiet 3 z uwag po testach mobilnych (lista M1–M12 w
`context/archive/2026-06-07-mobile-polish/change.md`).

## Outcome

- **M5**: wspólny hook `useBodyScrollLock` (`src/components/useBodyScrollLock.ts`,
  restauruje poprzednią wartość — modale się zagnieżdżają) wpięty w `BookModal`,
  `PhotoLightbox`, `ConfirmDialog` + `overscroll-contain` na przewijalnych
  kontenerach BookModala — scroll nie „przelewa się" na stronę pod modalem.
- **M6**: pinch-zoom w `PhotoDetectionOverlay` — `touch-action: none` blokował
  natywny gest, więc obsługa własna: mapa aktywnych pointerów, 2 palce → zoom
  1–4× z punktem skupienia w środku gestu (math jak w wheel-handlerze), przerwanie
  pan; gest wyłączony w trybach edycji bbox (kolizja z rysowaniem).

Weryfikacja: lint/typecheck 0 err, unit 921/921 (+4: 3 pinch + 1 body-lock),
E2E 147 passed / 0 failed (1 flake S-37 przy równoległości — izolowany retry
i pełny rerun zielone).
