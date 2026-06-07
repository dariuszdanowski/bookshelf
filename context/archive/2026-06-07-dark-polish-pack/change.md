---
change_id: dark-polish-pack
title: "Pakiet A2: dark-polish (M13, M14)"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T12:20:00Z
---

## Notes

Pakiet A2 z rundy 2 manualnych testów (M13–M23, raport sesji 2026-06-07).
Przyczyny zweryfikowane w kodzie przed startem:

- **M13** (dark hover bieleje na /shelves): manualne override'y dark w
  `global.css` pokrywały `hover:bg-gray-50`, ale NIE `hover:bg-gray-100`
  (ShelfListItem „Edytuj"/„Anuluj", index CTA secondary) ani `hover:bg-gray-200`
  (taby AddPurchase, chipy katalogu, BookCard) — w dark hover malował jasny
  gray-100/200 ≈ „bieleje". Analogiczne dziury: `hover:bg-red-50`,
  `hover:bg-green-200`, `hover:text-gray-700/600`, `hover:text-amber-900`.
- **M14** („Dodaj półkę" niewidoczny): `ShelfForm.tsx:71` używał
  `border-gray-900 bg-gray-900 hover:bg-gray-800` — gray-900 na ciemnym tle
  znika. Ten sam relikt w `ShelfListItem.tsx:95` (Zapisz) i `index.astro`
  (CTA login/library ×2). Konwencja primary w repo (9+ miejsc) to
  `bg-blue-600 hover:bg-blue-700`.

## Outcome

1. **M13**: `global.css` — dark override'y rozszerzone o `hover:bg-gray-100/200`
   (→ #1f2937, parytet z gray-50), `hover:bg-red-50` (→ #450a0a),
   `hover:bg-green-200` (→ #14532d), `hover:text-gray-700/600` (→ #f9fafb),
   `hover:text-amber-900` (→ #fde047). Hover w dark ciemnieje/jaśnieje
   poprawnie zamiast bieleć.
2. **M14**: 4 przyciski gray-900 (ShelfForm submit, ShelfListItem Zapisz,
   index CTA ×2) przeniesione na konwencję primary `bg-blue-600
   hover:bg-blue-700 border-transparent` — widoczne w obu motywach.
3. **E2E**: nowy `tests/e2e/dark-mode-contrast.spec.ts` (4 testy) — computed
   style asercje: M14 blue-600 (oklch) vs tło w dark, M13 hover #1f2937
   nie-gray-100, CTA landing, kontrola parytetu w trybie jasnym.
