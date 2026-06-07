# Impl-review — mobile-responsive (S-28)

**Data:** 2026-06-07
**Reviewer:** agent (Opus), Fast track
**Zakres:** commity `c7846fb` (p1) + `d606ce1` (p2) + `70eea6e` (p3) vs `plan.md`

## Zgodność plan ↔ implementacja

| Kontrakt | Stan |
| --- | --- |
| P1: `MobileNav` island (aria-expanded/controls/label, panel 5 linków + email + logout, `md:hidden`) | ✅ |
| P1: header `relative … md:justify-end`; desktopowy `<nav class="hidden md:flex">` z dotychczasowymi testidami; pojedynczy ThemeToggle | ✅ |
| P2: `p-4 sm:p-8` na 7 stronach; shelf-stats `gap-2 sm:gap-4`; AccountIsland `grid-cols-1 sm:grid-cols-2` | ✅ |
| P3: spec `mobile-responsive.spec.ts` — hamburger flow + no-h-scroll ×5 (review z mockiem) | ✅ 7 testów |

## Findings

### F1 (MEDIUM, zaaplikowane) — realny overflow w trybie Lista wykryty testem

Asercja no-h-scroll na review wykryła `scrollWidth=508` na 375 px: kontener akcji
`DetectionRow` (`flex flex-shrink-0 gap-1`, min-content 479 px). Fix:
`flex flex-wrap gap-1 sm:flex-shrink-0`. To dokładnie klasa ryzyka, którą spec miał
łapać — asercja nie jest dekoracyjna.

### F2 (LOW, zaaplikowane) — hydration race przycisku hamburgera w E2E

Klik przed podpięciem handlera React → retry-click `toPass` na `aria-expanded`
(pattern `revealPhotosTab` z photos-crud).

### Incydent narzędziowy (naprawiony w trakcie, zero śladu w commitach)

Masowa podmiana `p-8` przez `Set-Content` w PS 5.1 zepsuła polskie znaki
(BOM-less UTF-8 czytany jako ANSI) — pliki przywrócone z gita przed commitem,
edycje powtórzone per plik Edit toolem. Wniosek: bulk-rewrite plików UTF-8
w PS 5.1 tylko z jawnym dekodowaniem.

## Weryfikacja

- ✅ lint · typecheck 0 err · unit **917/917** (4 nowe) · **E2E pełna regresja 147 passed / 0 failed** (7 nowych mobile; standardowy config — zombie :4321 usunięty)
- ⏳ Manual 3.4 (user-only): realny telefon / device mode — header, review, upload

## Werdykt

**PASS** — Outcome S-28 dowieziony; element „domyślny tryb Lista na mobile" był już
done (S-34) i świadomie poza zakresem (zob. change.md).
