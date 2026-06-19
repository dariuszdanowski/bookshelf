# Mobile header overflow (375px) — Plan implementacji

## Przegląd

Header aplikacji rozpycha viewport na szerokości 375px (telefon), powodując poziomy
scroll (`scrollWidth ~427 > 375`). Bug pre-existujący na main, ujawniony po uwolnieniu
joba `e2e` w CI na każdym PR (#107, 2026-06-19). 6 testów responsywności zostało
zakwarantannowanych `.fixme`, by odblokować bramkę CI. Ten plan naprawia layout headera
i zdejmuje kwarantannę.

## Analiza stanu obecnego

Header w `src/layouts/Layout.astro:73`:
- Kontener: `flex items-center gap-4 p-3 text-sm sm:p-4`.
- Lewa strona: logo „BookShelf", `MobileNav` (hamburger `<md`), desktop `<nav>` (`hidden md:flex`).
- Prawa strona (`Layout.astro:147`): `<div class="ml-auto flex flex-shrink-0 items-center gap-2">`
  zawiera kolejno: `ThemeToggle`, `EnvBadge variant="inline"`, pill „Pomoc" (`nav-help`),
  trigger `BugReportModal` „Zgłoś błąd" (tylko gdy `user`).

Ustalenia zweryfikowane w kodzie (2026-06-19):
- Pill „Pomoc" chowa tekst `<sm`: `Layout.astro:173` `<span class="hidden sm:inline">Pomoc</span>` → icon-only na 375px. ✓
- Trigger „Zgłoś błąd" chowa tekst `<sm`: `BugReportModal.tsx:100` `<span className="hidden sm:inline">Zgłoś błąd</span>` → icon-only na 375px. ✓ (notatka w pamięci była tu nieaktualna — bug-report-github dostarczył to z `hidden sm:inline`.)
- `EnvBadge` (`src/components/EnvBadge.astro`, `variant="inline"`) renderuje `<a>`/`<div>` z labelem `ENV_LABEL[dbEnv]` (np. „LOKALNA"/„PROD"), `rounded-md px-2 py-1 text-[10px] font-bold ... ring-2`. **Nie ma żadnego ukrycia na mobile** — to afordancja diagnostyczna (link do Supabase Studio), nie funkcja end-usera.
- Kontener headera używa `gap-4` (16px) między WSZYSTKIMi dziećmi na każdym breakpoincie — na 375px to kilkukrotne 16px marnowanej przestrzeni.

Pozostałe ~52px overflow pochodzi z sumy: label EnvBadge (~50–60px z paddingiem/ringiem) + nadmiarowe `gap-4`. Po ukryciu EnvBadge `<sm` i zwężeniu zewnętrznego gapu prawa grupa mieści się w 375px.

## Pożądany stan końcowy

Na 375px header nie powoduje poziomego scrolla na żadnej ścieżce (`/library`, `/shelves`,
`/upload`, `/account`, `/help`, review `/photos/[id]`). `EnvBadge` widoczny od `sm` wzwyż
(desktop/tablet bez zmian). 6 testów `mobile-responsive.spec.ts` bez `.fixme`, zielone
w pełnym przebiegu `npm run test:e2e` i w CI.

Weryfikacja: `expectNoHorizontalScroll(page)` (twarda asercja `scrollWidth <= clientWidth+1`)
przechodzi dla wszystkich odkwarantannowanych testów; wizualna inspekcja 375px (user-only).

### Kluczowe odkrycia:

- `src/layouts/Layout.astro:147` — prawa grupa headera, miejsce wszystkich zmian.
- `src/components/EnvBadge.astro:14` — `variant` prop; komponent NIE ma klasy ukrycia mobile — najprościej owinąć użycie w Layout w `<span class="hidden sm:inline-flex">` (zero zmian w komponencie, działa dla obu gałęzi `<a>`/`<div>`).
- Pille już są icon-only `<sm` — NIE ruszać ich (regresja desktop ich tekstu).
- `tests/e2e/mobile-responsive.spec.ts` — `test.fixme` linia ~101 (`/help bez scrolla`) + `test.describe.fixme` linia ~141 (blok `/library` `/shelves` `/upload` `/account` + review). Helper `expectNoHorizontalScroll` (linia 26) zostaje bez zmian.

## Czego NIE robimy

- NIE zmieniamy `BugReportModal.tsx` ani markupu pilla „Pomoc" (już icon-only `<sm`).
- NIE usuwamy `EnvBadge` całkowicie — tylko ukrywamy `<sm` (na desktopie nadal potrzebny diagnostycznie).
- NIE refaktoryzujemy nawigacji mobilnej (`MobileNav` działa poprawnie — test hamburgera jest zielony, nie w kwarantannie).
- NIE dodajemy globalnego `overflow-x-hidden` na `body` (maskuje bug zamiast go naprawić — anti-pattern; helper testu i tak mierzy `scrollWidth` elementów).
- NIE dotykamy `ImpersonationBanner` ani innych elementów poza headerem.

## Podejście do implementacji

Dwie minimalne zmiany w `Layout.astro`, zero zmian w komponentach:
1. Owinąć `<EnvBadge variant="inline" />` w `<span class="hidden sm:inline-flex">` — znika z 375px, wraca od `sm` (640px).
2. Zwęzić zewnętrzny gap headera: `gap-4` → `gap-2 sm:gap-4` (ciaśniej na mobile, desktop bez zmian).

Następnie zdjąć 6× `.fixme` i potwierdzić zielone E2E.

## Faza 1: Fix layoutu headera + zdjęcie kwarantanny

### Przegląd

Ukrycie EnvBadge poniżej `sm`, zwężenie gapu mobilnego, odkwarantannowanie testów.

### Wymagane zmiany:

#### 1. Header — ukryj EnvBadge < sm, zwęź gap mobilny

**Plik**: `src/layouts/Layout.astro`

**Cel**: usunąć z viewportu 375px diagnostyczny `EnvBadge` i nadmiarowy odstęp, tak by prawa grupa headera mieściła się bez poziomego scrolla; desktop/tablet (≥ sm) niezmieniony.

**Kontrakt**:
- Linia 73: kontener `<header>` — `gap-4` → `gap-2 sm:gap-4`.
- Linia 150: `<EnvBadge variant="inline" />` owinięty w `<span class="hidden sm:inline-flex">…</span>` (EnvBadge.astro bez zmian).
- Brak zmian w pillach „Pomoc"/„Zgłoś błąd", w desktop nav, w `MobileNav`.

#### 2. Zdejmij kwarantannę 6 testów responsywności

**Plik**: `tests/e2e/mobile-responsive.spec.ts`

**Cel**: przywrócić 6 testów scroll-checków do aktywnego przebiegu po naprawie headera.

**Kontrakt**:
- Linia ~101: `test.fixme('375px: /help renderuje się bez poziomego scrolla', …)` → `test(...)`; usuń komentarz `QUARANTINE` nad nim.
- Linia ~141: `test.describe.fixme('S-28: brak poziomego scrolla na 375px', …)` → `test.describe(...)`; usuń komentarz `QUARANTINE`. To odblokowuje 5 testów wewnątrz (`/library`, `/shelves`, `/upload`, `/account`, review `/photos/[id]`).
- Helper `expectNoHorizontalScroll` (linia 26) i mocki review bez zmian.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Lint przechodzi: `npm run lint`
- Typecheck przechodzi: `npm run typecheck`
- Pełny E2E przechodzi (6 odkwarantannowanych testów zielone): `npm run test:e2e`

#### Weryfikacja ręczna:

- Na 375px (DevTools / telefon) header nie ma poziomego scrolla na `/library`, `/shelves`, `/upload`, `/account`, `/help`
- Na desktopie (≥ sm) `EnvBadge` nadal widoczny i klikalny (link do Studio), spacing niezmieniony
- Pille „Pomoc"/„Zgłoś błąd" wyglądają poprawnie jako icon-only na mobile i z tekstem na desktopie

**Uwaga implementacyjna**: po przejściu automatów zatrzymaj się na ręczną weryfikację 375px (user-only) przed archiwizacją.

## Strategia testowania

### Testy E2E:

- 6 odkwarantannowanych testów `mobile-responsive.spec.ts` (twarda asercja `scrollWidth <= clientWidth+1`).
- Istniejące zielone testy hamburgera/desktop nav nie mogą się zepsuć (regresja desktop).

### Kroki testowania ręcznego:

1. DevTools → 375px → `/library`: brak poziomego scrolla, header czytelny.
2. To samo dla `/shelves`, `/upload`, `/account`, `/help` (zalogowany).
3. 1280px: EnvBadge widoczny, link do Studio działa, spacing jak wcześniej.

## Referencje

- Bug i kierunek: memory `next-slice-mobile-header-overflow`.
- Kwarantanna: commit `6dbe90f`, `tests/e2e/mobile-responsive.spec.ts:96-107,138-196`.
- Header: `src/layouts/Layout.astro:73,147-176`; EnvBadge: `src/components/EnvBadge.astro`.

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Fix layoutu headera + zdjęcie kwarantanny

#### Automatyczne

- [x] 1.1 Lint przechodzi: `npm run lint` — f7268ec
- [x] 1.2 Typecheck przechodzi: `npm run typecheck` — f7268ec
- [x] 1.3 Pełny E2E przechodzi (6 odkwarantannowanych testów zielone): `npm run test:e2e` — f7268ec

#### Ręczne

- [x] 1.4 375px bez poziomego scrolla na `/library`, `/shelves`, `/upload`, `/account`, `/help`
- [x] 1.5 Desktop (≥ sm) — EnvBadge widoczny/klikalny, spacing niezmieniony
- [x] 1.6 Pille icon-only na mobile, z tekstem na desktopie
