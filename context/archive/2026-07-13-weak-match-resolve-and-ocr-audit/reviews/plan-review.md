<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Weak-match AI-resolution gate + historia korekt OCR

- **Plan**: `context/changes/weak-match-resolve-and-ocr-audit/plan.md`
- **Tryb**: Głęboki
- **Data**: 2026-07-13
- **Werdykt**: SOLIDNY (po zastosowaniu poprawek)
- **Ustalenia**: 1 krytyczne, 2 ostrzeżenia, 1 obserwacja — wszystkie 3 aktywne ustalenia naprawione w planie

## Werdykty

| Wymiar | Werdykt |
|---|---|
| Zgodność ze stanem końcowym | OSTRZEŻENIE → naprawione (F1) |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | OSTRZEŻENIE → naprawione (F3) |
| Kompletność planu | OSTRZEŻENIE → naprawione (F2) |

## Ugruntowanie

5/5 ścieżek ✓, 3/3 symboli ✓, brief↔plan ✓ (grounding + jeden subagent weryfikacyjny, `general-purpose`, 6 twierdzeń zweryfikowanych względem realnego kodu)

## Ustalenia

### F1 — Kontrakt zachowuje tylko tytuł, nie autora — luka w obietnicy

- **Waga**: ❌ KRYTYCZNE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Zgodność ze stanem końcowym
- **Lokalizacja**: Faza 1 (schemat) + Faza 2 (rematch.ts/refine.ts)
- **Szczegóły**: `corrections` nie ma kolumny na oryginalnego autora (tylko `original_raw_title` + `corrected_authors` jako nowa wartość). `rematch.ts:76` (`.select('id, status, raw_title')`) nawet nie pobiera `raw_author` przed nadpisaniem. Historia autora nadal ginęłaby — dokładnie przypadek źródłowy zmiany („Marowska Duchowska") nie zostałby naprawiony w pełni.
- **Poprawka A ⭐ Recommended**: Dodaj kolumnę `original_raw_author` do `corrections` (Faza 1, ta sama migracja 0028), rozszerz select w `rematch.ts` o `raw_author`, obie ścieżki insertu przez `(locals.supabase as any)` + defensywny retry (wzorzec S-50) do czasu regeneracji typów.
  - Pewność: WYSOKA — wzorzec już ugruntowany w repo.
  - Martwy punkt: Brak znaczących.
- **Poprawka B**: Zawęź obietnicę do samego tytułu (jak `correct.ts` dziś) — bez zmian w schemacie.
- **Decyzja**: NAPRAWIONE (Poprawka A) — plan.md zaktualizowany: Faza 1 (nowa kolumna), Faza 2 (rozszerzony select + insert z `original_raw_author`), Faza 4 (endpoint/panel pokazują też autora), Faza 5 (kryteria manualne rozszerzone).

### F2 — Nieaktualny komentarz w resolve.ts po rozszerzeniu bramki

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 3
- **Szczegóły**: `resolve.ts:32` dokumentuje niezmiennik „shouldReplace zawsze true, bo przycisk widoczny tylko przy 0 kandydatów" — po Fazie 3 to zdanie staje się nieprawdziwe (kod nadal poprawny, komentarz mylący).
- **Poprawka**: Dodano punkt 2 do Fazy 3 — aktualizacja komentarza w `resolve.ts` opisująca nowy niezmiennik.
- **Decyzja**: NAPRAWIONE — plan.md Faza 3 rozszerzona.

### F3 — Dialog potwierdzenia nie ostrzega o zastąpieniu istniejących kandydatów

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 3
- **Szczegóły**: Po rozszerzeniu bramki przycisk może się pojawić przy istniejących (słabych) kandydatach. `resolve.ts` bezwarunkowo je usuwa w gałęzi `found`, ale `ConfirmDialog` (3 bloki, `title="Rozwiązać przez AI?"`) o tym nie wspomina.
- **Poprawka**: Dodano punkt 3 do Fazy 3 — warunkowe rozszerzenie `message` dialogu, gdy `top` istnieje. Rozszerzono też Fazę 5 (E2E) o asercję tego zdania.
- **Decyzja**: NAPRAWIONE — plan.md Faza 3 + Faza 5 rozszerzone.

### F4 — Czwarte miejsce z podobnym wzorcem `!top`, poza zakresem planu

- **Waga**: ℹ️ OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Dopasowanie architektoniczne
- **Lokalizacja**: poza planem — `src/components/PhotoDetectionOverlay.tsx:28,48` (`MarkerTooltip`)
- **Szczegóły**: Osobny komponent z własnym `const top = det.candidates[0]` gating treść tooltipa (nie przycisk AI-resolution) — niepowiązane z tym planem.
- **Decyzja**: ZAAKCEPTOWANE (informacyjne, brak akcji wymaganej)
