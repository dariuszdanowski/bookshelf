<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Usunięcie blokady AI-resolution per-zdjęcie + informacyjny licznik prób

- **Plan**: context/changes/ai-resolution-per-photo-reset/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-07-17
- **Werdykt**: SOLIDNY
- **Ustalenia**: 0 krytycznych, 1 ostrzeżenie, 0 obserwacji

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | ZALICZONY |
| Kompletność planu | OSTRZEŻENIE |

## Ugruntowanie

10/10 ścieżek ✓, 4/4 symboli ✓, brief↔plan ✓, Postęp↔Faza: 4/4 fazy zgodne, 17/17 kryteriów
sukcesu ma parę w Progress ✓.

Głęboka weryfikacja (subagent) potwierdziła: (1) blast radius `budgetPolicy.ts` — tylko
`resolve.ts` + 2 pliki testowe, zero niespodzianek; (2) blast radius kolumny
`ai_resolution_max_calls_per_photo` — dokładnie 7 plików kodu + 3 pliki testowe zgodne z planem
(E2E dotknięty pośrednio przez `data-testid`, nie literal string — plan i tak to poprawnie
celuje); (3) `DROP COLUMN` w migracji 0033 jest bezpieczny — brak zależnych VIEW/trigger/funkcji;
(4) mock `resolve.test.ts` przetrwa bez restrukturyzacji (branch `photo_id` staje się martwym
kodem, nie zepsutym) — tylko 2 konkretne testy do usunięcia/przepisania, dokładnie zgodnie z
intencją planu.

## Ustalenia

### F1 — Plan cytował słabszy precedens dla resolution_attempts_count

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 2, punkt 3 ("Licznik prób w GET /api/photos/[id]")
- **Szczegóły**: Plan wskazywał `costs_total_usd` (`photos/[id].ts:84-115`) jako wzorzec, gdy
  istnieje bliższy, gotowy precedens: `src/pages/api/photos/[id]/costs.ts:68-96` — dokładnie ten
  sam count na `resolution_calls` po `photo_id`. Ten precedens (i `photos/[id].ts:93`) rzutuje
  zapytanie przez `(locals.supabase as any)` z nieaktualnym komentarzem ("resolution_calls nie
  jest w database.types.ts") — dziś w pełni typowane (`database.types.ts:445`).
- **Poprawka**: Zaktualizowano Kontrakt w Fazie 2 punkt 3 — wskazuje `costs.ts:68-96` jako
  precedens kształtu, z jawną notatką żeby NIE kopiować `as any` (już niepotrzebne).
- **Decyzja**: NAPRAWIONE (w planie)
