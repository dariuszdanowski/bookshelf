---
change_id: theme-consistency
title: "Spójność trybu jasny/ciemny w całej aplikacji (M3, M4)"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T10:40:00Z
---

## Notes

Pakiet 2 z uwag po testach mobilnych (lista M1–M12 w
`context/archive/2026-06-07-mobile-polish/change.md`). Root cause M3 znaleziony
audytem z twardą reprodukcją (screenshot 1:1 ze zgłoszeniem usera): brak
`@custom-variant dark` w Tailwind v4 → 222 użycia `dark:` reagowały na systemowy
`prefers-color-scheme`, a apka steruje motywem klasą `html.dark` + ręcznymi
override'ami w `global.css`. Psuła się kombinacja **apka-jasna + system-ciemny**.

## Outcome

- **M3**: `@custom-variant dark (&:where(.dark, .dark *))` w `global.css` —
  wszystkie warianty `dark:` kluczowane klasą; zweryfikowane wizualnie:
  app-light+sys-dark = w całości jasne, app-dark+sys-light = w całości ciemne.
  Ręczne override'y zostają (dominują kaskadę tam, gdzie się nakładają — spójne
  kolory; stylują też komponenty bez klas `dark:`).
- **M4**: widoczny stan aktywny tabów Książki/Zdjęcia i trybów Karty/Lista/Kafelki —
  akcent **kolorem** (`text-blue-700` + `font-semibold`; w dark override mapuje na
  `#93c5fd`), bo override'y zlewają wszystkie `text-gray-*` do jednej wartości
  i wcześniej aktywny chip był nierozróżnialny. Świadomie BEZ polegania na
  `dark:` na elemencie z `bg-white` — override `html.dark .bg-white` (specyficzność
  0,2,1) wygrywa z utility wariantu (0,1,0).

Weryfikacja: screenshoty 375px (3 kombinacje) + lint/typecheck 0 err +
unit 917/917 + E2E 147 passed / 0 failed.
