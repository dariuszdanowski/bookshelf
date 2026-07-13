<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: AI book resolution fallback (S-50)

- **Plan**: `context/changes/ai-book-resolution-fallback/plan.md`
- **Tryb**: Głęboki
- **Data**: 2026-07-13
- **Werdykt**: DO POPRAWY → **SOLIDNY po poprawkach** (wszystkie 5 ustaleń zaaplikowane)
- **Ustalenia**: 1 krytyczne, 1 ostrzeżenie, 3 obserwacje — wszystkie NAPRAWIONE

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY (po poprawce F1) |
| Martwe punkty | ZALICZONY (po poprawkach F2, F3) |
| Kompletność planu | ZALICZONY (po poprawkach F1, F2, F4, F5) |

## Ugruntowanie

15/15 ścieżek ✓, 8/8 symboli ✓ (w tym typy `@anthropic-ai/sdk@^0.106.0`), brief↔plan ✓

## Ustalenia

### F1 — Błędne założenie o `database.types.ts` blokuje CI typecheck

- **Waga**: ❌ KRYTYCZNE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 1, punkt 2
- **Szczegóły**: Plan zakładał, że `database.types.ts` jest gitignored i regeneruje się „czysto". `git ls-files` potwierdza, że plik JEST committowany. CI job `verify` (typecheck) nigdy nie uruchamia lokalnej Supabase — polega wyłącznie na committowanej wersji. Established pattern w repo (`account/stats.ts`, `costs.ts`, M27) to `(locals.supabase as any)` + defensywny retry na `42703`/`PGRST204`.
- **Poprawka A**: Regeneruj typy lokalnie (WSL) i commituj w Fazie 1.
  - Siła: pełne typowanie od startu.
  - Kompromis: blokuje się bez WSL (bywa AV-blocked).
  - Pewność: WYSOKA.
  - Martwy punkt: nieznana dokładna komenda gen-types w tym repo.
- **Poprawka B ⭐ Zalecana**: Podążaj za ugruntowanym wzorcem `as any` + defensywny retry.
  - Siła: odblokowuje niezależnie od WSL/AV, zero nowego ryzyka — 3 precedensy w repo.
  - Kompromis: tymczasowe `as any` casty do czasu follow-up regeneracji.
  - Pewność: WYSOKA.
  - Martwy punkt: brak.
- **Decyzja**: NAPRAWIONE — zastosowano poprawkę B. `plan.md` Faza 1 punkt 2 przepisany na opis wzorca `as any`; Faza 3 punkt 1 rozszerzony o tę samą uwagę.

### F2 — Faza 4 celuje w zły komponent i pomija per-zdjęciowy widok kosztu

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Kompletność planu / Martwe punkty
- **Lokalizacja**: Faza 4, punkt 2
- **Szczegóły**: Plan celował w `CostPanel.tsx` (per-zdjęciowy popover, `GET /api/photos/[id]/costs.ts`) opisując go jako konsumenta `total_vision_cost_usd`/`total_refine_cost_usd` — to pola z `/api/account/stats`, konsumowane przez `AccountIsland.tsx:602-617`. `costs.ts` ma już established wzorzec graceful-degrade dla nowych tabel, niewykorzystany przez plan.
- **Poprawka A**: Popraw tylko nazwę (`AccountIsland.tsx`), udokumentuj `CostPanel` jako świadomie poza zakresem.
  - Siła: minimalna zmiana zakresu.
  - Kompromis: krótkotrwała niespójność UX.
  - Pewność: WYSOKA.
- **Poprawka B ⭐ Zalecana**: Popraw nazwę ORAZ rozszerz `photos/[id]/costs.ts` + `CostPanel.tsx` tym samym wzorcem co `refine_calls`.
  - Siła: pełna spójność kosztowa, zgodne z filozofią cost-transparency projektu (S-30/S-35), niski dodatkowy koszt.
  - Kompromis: jeszcze jeden plik w Fazie 3, jeszcze jeden blok UI w Fazie 4.
  - Pewność: WYSOKA.
  - Martwy punkt: brak.
- **Decyzja**: NAPRAWIONE — zastosowano poprawkę B. Dodano Faza 3 punkt 3 (`costs.ts`) i Faza 4 punkty 2-3 (`AccountIsland.tsx`, `CostPanel.tsx`).

### F3 — Brak etykiety źródła „ai_resolution" w BookModal

- **Waga**: 📝 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 4
- **Szczegóły**: `SOURCE_LABELS` w `BookModal.tsx:62-66` nie ma wpisu dla `ai_resolution` — degraduje gracefully (surowy string), nie crashuje.
- **Fix**: Dopisz `ai_resolution: 'AI (web search)'` do `SOURCE_LABELS`.
- **Decyzja**: NAPRAWIONE — dodano Faza 4 punkt 4.

### F4 — Kontrakt endpointu nie precyzuje odpowiedzi na `api_error`

- **Waga**: 📝 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 3, punkt 1
- **Szczegóły**: `resolveBookViaAI` może zwrócić `{ok:false, reason:'api_error'}`; plan pokrywał audyt, nie precyzował odpowiedzi dla klienta.
- **Fix**: Dopisano gałąź `api_error` → insert `resolution_calls(status:'error')` → `apiError({code:'INTERNAL_ERROR', status:500, ...})`.
- **Decyzja**: NAPRAWIONE — dopisano do kontraktu Fazy 3.1.

### F5 — Plan niepotrzebnie zakładał niepewność wokół typów SDK `web_search`

- **Waga**: 📝 OBSERWACJA (korekta upraszczająca)
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kompletność planu
- **Lokalizacja**: „Krytyczne szczegóły implementacji"; `plan-brief.md` „Otwarte ryzyka"
- **Szczegóły**: Zweryfikowano bezpośrednio zainstalowany `@anthropic-ai/sdk@^0.106.0` — `usage.server_tool_use.web_search_requests` i `WebSearchTool20250305` (`max_uses`, `type`, `name`) w pełni typowane (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:805,1000,1589,1829-1837`). Żaden `as any` nie jest potrzebny.
- **Fix**: Uproszczono opis w planie; usunięto zamknięte ryzyko z brief-u.
- **Decyzja**: NAPRAWIONE.
