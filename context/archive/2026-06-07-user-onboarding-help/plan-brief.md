# S-38: Onboarding i pomoc kontekstowa — Plan Brief

> Full plan: `context/changes/user-onboarding-help/plan.md`

## What & Why

Uwaga M7: brak instrukcji/przewodnika. Nowoczesny wzorzec = warstwy, nie manual:
(1) empty states uczące następnego kroku, (2) kontekstowe „?" przy decyzjach
kosztowych/nietrywialnych, (3) statyczna `/help` z golden path + FAQ.

## Key Decisions (Fast track — zawetuj wyjątki)

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Tour (driver.js) | POZA zakresem | Najdroższa warstwa; najpierw sprawdzamy tanie 1–3 |
| `/help` dostęp | Publiczna (whitelist middleware) | Zero danych usera; pomaga też przed rejestracją |
| Popover `HelpTip` | Własny mały komponent (nie biblioteka) | 1 wzorzec w repo (Esc/klik-poza jak modale), zero deps |
| Screenshoty | Reużycie `docs/screenshots/` (auto-regen) | Już utrzymywane automatem |

## Phases at a Glance

| Phase | Delivers | Risk |
| --- | --- | --- |
| 1. Empty states | Nauka następnego kroku w 4-5 widokach | niski (treść+CTA) |
| 2. HelpTip + wpięcia | „?" przy ~6 decyzjach | niski |
| 3. /help | Przewodnik + FAQ + nav + E2E | niski |

**Effort:** 1–2 sesje (M) · **Prereqs:** brak (po merge pakietów 1–3 dla spójnych screenów)

## Success Criteria

- Każdy pusty stan ma CTA następnego kroku; „?" przy progach/refine/BYOK/skip-upload
- `/help` w nav (desktop+mobile), renderuje się na 375 px bez h-scrolla
- Manual: golden path „oczami nowego usera"
