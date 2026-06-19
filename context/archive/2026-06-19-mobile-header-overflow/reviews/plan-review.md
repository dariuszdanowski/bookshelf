<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Mobile header overflow (375px)

- **Plan**: context/changes/mobile-header-overflow/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-06-19
- **Werdykt**: SOLIDNY
- **Ustalenia**: 0 krytycznych, 1 ostrzeżenie, 1 obserwacja

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | ZALICZONY |
| Kompletność planu | OSTRZEŻENIE |

## Ugruntowanie
4/4 ścieżek ✓ (Layout.astro, EnvBadge.astro, BugReportModal.tsx, mobile-responsive.spec.ts), 4/4 symboli ✓ (`gap-4`@73, `EnvBadge variant="inline"`@150, pille `hidden sm:inline`, `fixme`@101/`describe.fixme`@141), brief↔plan ✓. `contract-surfaces.md` brak → pominięte. Blast-radius: żaden test nie wymaga widoczności `env-badge` na mobile (`help-screenshots`/`screenshots` go ukrywają); test 3.12 `/shelves/[id]`@375px sprawdza tylko widoczność (nie scrollWidth) → zielony mimo buga, brak regresji po fixie.

## Ustalenia

### F1 — Bloki faz używają `- [ ]` zamiast zwykłych punktów

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąska
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 1 → Kryteria sukcesu
- **Szczegóły**: Sekcja „Kryteria sukcesu" w bloku Fazy 1 używała checkboxów `- [ ]`. Kontrakt formatu wymaga, by bloki faz miały tylko zwykłe punkty `- `; checkboxy żyją wyłącznie w `## Postęp` (poprawnym: 1.1–1.6).
- **Poprawka**: Zamień `- [ ]` na `- ` w „Kryteria sukcesu" Fazy 1; `## Postęp` bez zmian.
- **Decyzja**: NAPRAWIONE (auto-apply Fast track — edycja zastosowana w plan.md)

### F2 — `/shelves/[id]` @375px bez scroll-checku (współdzielony header)

- **Waga**: 💡 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Strategia testowania
- **Szczegóły**: Test 3.12 dzieli ten sam header, ale sprawdza tylko widoczność, nie `scrollWidth`. Po fixie zostaje zielony (brak regresji), lecz no-scroll dla tej trasy nie jest asercjonowane. Niskie ryzyko: header wspólny, `/shelves` (lista) jest w odkwarantannowanym bloku.
- **Poprawka**: (opcjonalna) dodać `expectNoHorizontalScroll` do testu 3.12 — pominięte jako YAGNI.
- **Decyzja**: ZAAKCEPTOWANE (obserwacja, brak akcji)
