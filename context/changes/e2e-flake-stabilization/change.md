---
change_id: e2e-flake-stabilization
title: "S-44: utwardzenie flaky E2E — pełny test:e2e przechodzi deterministycznie"
status: implemented
created: 2026-06-09
updated: 2026-06-09
archived_at: null
---

## Notes

S-44 (roadmap, proposed). Trzy znane flaki zielone w izolacji, padają w pełnym
przebiegu na współdzielonej sesji (storageState, 1 signup/run):

- `account.spec` — lost-click podczas hydratacji UserMenu (`user-menu-trigger`
  klikany przed podpięciem `onClick` → dropdown się nie otwiera).
- `shelves.spec` — ciasny 5s timeout na refetch po POST pod zimnym dev-serverem.
- `dark-mode-contrast.spec` — transientny odczyt computed-style po `.hover()`.

Kierunek: warstwa testów (zero prod-kodu), bounded `toPass` retry na obserwowalne
side-effecty, `waitForResponse` zamiast gołych timeoutów, wspólny moduł helperów.
NIE globalny retry maskujący. Plan: `plan.md` / `plan-brief.md`.

## Outcome

(do uzupełnienia przy archiwizacji)
