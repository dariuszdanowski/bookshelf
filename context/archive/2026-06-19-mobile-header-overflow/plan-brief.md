# Mobile header overflow (375px) — Krótki plan

> Pełny plan: `context/changes/mobile-header-overflow/plan.md`

## Co i dlaczego

Header rozpycha viewport na 375px → poziomy scroll (`scrollWidth ~427 > 375`). Bug
pre-existujący na main, ujawniony po uwolnieniu joba `e2e` w CI na każdym PR (#107);
6 testów responsywności zakwarantannowano `.fixme`, by odblokować bramkę. Naprawiamy
header i zdejmujemy kwarantannę.

## Punkt wyjścia

Prawa grupa headera (`Layout.astro:147`): `ThemeToggle` + `EnvBadge` + pille
„Pomoc"/„Zgłoś błąd". Pille JUŻ chowają tekst `<sm` (icon-only na mobile). `EnvBadge`
(diagnostyczny label „LOKALNA"/„PROD") nie jest ukrywany, a kontener używa `gap-4`
na każdym breakpoincie — to suma odpowiedzialna za ~52px overflow.

## Pożądany stan końcowy

Header bez poziomego scrolla na 375px na wszystkich ścieżkach; `EnvBadge` widoczny od
`sm` wzwyż (desktop bez zmian); 6× `.fixme` zdjęte i zielone w `npm run test:e2e` + CI.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego | Źródło |
|---------|-------|----------|--------|
| Podejście do overflow | Ukryj `EnvBadge` `<sm` (wrapper `hidden sm:inline-flex`) + `gap-4`→`gap-2 sm:gap-4` | EnvBadge to afordancja diagnostyczna, zbędna na telefonie; gap-4 marnuje przestrzeń | Plan |
| Pille „Pomoc"/„Zgłoś błąd" | Bez zmian (już icon-only `<sm`) | `hidden sm:inline` już w kodzie; korekta nieaktualnej notatki | Plan |
| Powierzchnia zmian | Tylko `Layout.astro` + spec; EnvBadge.astro bez zmian | Minimalne ryzyko regresji desktop | Plan |
| `overflow-x-hidden` na body | Odrzucone | Maskuje bug zamiast naprawiać (anti-pattern) | Plan |

## Zakres

**W zakresie:** `Layout.astro` (gap + wrapper EnvBadge); zdjęcie 6× `.fixme` w `mobile-responsive.spec.ts`.

**Poza zakresem:** zmiany w `BugReportModal.tsx`/pillu „Pomoc", `MobileNav`, globalny `overflow-x-hidden`, refaktor nawigacji.

## Architektura / Podejście

Dwie edycje w `Layout.astro`: (1) zewnętrzny gap responsywny, (2) `EnvBadge` owinięty w
`<span class="hidden sm:inline-flex">`. Potem odkwarantannowanie testów. Helper
`expectNoHorizontalScroll` (twarda asercja scrollWidth) jest wyrocznią poprawności.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|------|--------------|-----------------|
| 1. Fix headera + kwarantanna | Header bez scrolla 375px; 6× `.fixme` zielone | EnvBadge wrapper nie łamie układu flex na desktopie (mitygacja: `inline-flex`) |

**Wymagania wstępne:** dev server na :4321 (user ma zawsze); Playwright zainstalowany.
**Szacowany nakład pracy:** ~1 sesja, 1 faza (LOW).

## Otwarte ryzyka i założenia

- Założenie: po ukryciu EnvBadge + zwężeniu gapu prawa grupa mieści się w 375px. Jeśli helper nadal wykrywa offendera — winowajca jest poza prawą grupą (offenders log w asercji wskaże element); ewentualny drugi przebieg z dodatkową korektą.
- Weryfikacja wizualna 375px pozostaje user-only (reguła CLAUDE.md).

## Kryteria sukcesu (podsumowanie)

- 375px: brak poziomego scrolla na `/library`, `/shelves`, `/upload`, `/account`, `/help`, review.
- Desktop ≥ sm: EnvBadge widoczny/klikalny, spacing niezmieniony.
- `npm run test:e2e` zielony bez `.fixme`.
