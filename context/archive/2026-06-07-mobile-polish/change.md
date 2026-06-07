---
change_id: mobile-polish
title: "Fix-pack z manualnych testów mobilnych (M1, M2, M9, M10, M12)"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T09:30:00Z
---

## Notes

Pakiet 1 z listy uwag usera po testach mobilnych S-28 (sesja 2026-06-07,
pełna lista M1–M12 w raporcie audytu). Bez formalnego planu — fix-pack
z manualnego review, każda poprawka zweryfikowana audytem wizualnym
(screenshoty desktop/mobile × jasny/ciemny w `tmp-audit-shots/`, sesyjne).
M4 przeniesione do pakietu theme-consistency (wymaga M3), M3/M5/M6 → pakiety 2-3,
M7/M8/M11 → osobne cykle.

## Outcome

- **M1**: miniatura zdjęcia półki na mobile pełną szerokością (`h-40 w-full`),
  na sm+ kompaktowy kwadrat jak dotąd (`PhotoListIsland`)
- **M2**: tryb Lista książek nie wychodzi poza kartę — wiersz `flex-wrap`,
  akcje pełnowierszowo pod tytułem na mobile (`BookCard`)
- **M9**: badge środowiska (PROD DB) w headerze obok przełącznika motywu
  (`EnvBadge variant="inline"`); floating tylko na stronach anon
- **M10**: klik w miniaturę otwiera `/photos/[id]` (link, nie tylko przycisk)
- **M12**: formularz „Szukaj po tytule" zamyka się też po SUKCESIE
  (odwrócony warunek w gałęzi bez kandydata — DetectionReview)

Weryfikacja: lint/typecheck 0 err, unit 919/919 (+2 nowe), E2E pełna regresja
147 passed / 0 failed.
