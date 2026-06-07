---
change_id: user-onboarding-help
title: "S-38: Onboarding i pomoc kontekstowa (M7)"
status: plan_reviewed
created: 2026-06-07
updated: 2026-06-07
archived_at: null
---

## Notes

Uwaga M7 z testów (2026-06-07): „potrzebuję instrukcji dla użytkowników, opisów
funkcji, przewodnika, kontekstowego helpa". Wybrane warstwy (rekomendacja z sesji,
user nie zawetował): instruktażowe empty states + kontekstowe „?" + strona `/help`.
Tour (driver.js) świadomie poza MVP slice'a — osobny follow-up jeśli zajdzie potrzeba.

## Outcome

Nowy użytkownik rozumie golden path bez instrukcji zewnętrznej: puste stany uczą
następnego kroku, nietrywialne funkcje (progi dopasowania, refine-płatne, BYOK,
dedup, tryby widoku) mają popover „?", a `/help` zbiera przewodnik krok-po-kroku
ze screenshotami + FAQ.
