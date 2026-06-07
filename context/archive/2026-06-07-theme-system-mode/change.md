---
change_id: theme-system-mode
title: "Pakiet D2: theme-system mode (M17)"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T13:10:00Z
---

## Notes

Pakiet D2 z rundy 2 manualnych testów (M13–M23, raport sesji 2026-06-07).

- **M17** (tryb zgodny ze stylem systemu): ThemeToggle był 2-stanowy
  (jasny/ciemny) — pierwszy klik na zawsze zamrażał jawny wybór w
  localStorage; brak drogi powrotu do „podążaj za systemem" i brak reakcji
  na zmianę schematu OS w trakcie sesji (np. auto-ciemny wieczorem).

Decyzje: `html.dark` zostaje JEDYNYM źródłem prawdy dla CSS
(`@custom-variant` z M3 bez zmian) — `'system'` rozwiązuje się do
light/dark w momencie aplikacji. Inline `<head>` script już obsługiwał
brak wpisu przez matchMedia, więc `'system'` w storage wpada w tę samą
gałąź (zero zmian logiki, tylko komentarz). Default bez wpisu = systemowy
(parytet z dotychczasowym zachowaniem). Listener `matchMedia('change')`
aktywny tylko w trybie systemowym (cleanup przy wyjściu).

## Outcome

1. **M17**: ThemeToggle = 3-stanowy segmented control (jasny / systemowy /
   ciemny; `role="radiogroup"`, testidy `theme-mode-{light,system,dark}`);
   tryb systemowy podąża za `prefers-color-scheme` na żywo (listener bez
   przeładowania); jawny wybór wygrywa z OS i przeżywa reload; legacy
   wpisy 'light'/'dark' działają bez migracji.
2. Testy: 5 unit (przepisane ThemeToggle.test — segmenty, default-system,
   żywy listener, cleanup listenera, legacy light) + nowy E2E
   `theme-system.spec.ts` (4 testy z `emulateMedia({ colorScheme })`:
   FOUC-free default, live-switch OS, jawny dark vs OS + reload, powrót
   na system).
