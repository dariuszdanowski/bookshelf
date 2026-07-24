<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Model picker dla klucza BYOK openai_compatible

- **Plan**: `context/changes/byok-openai-compatible-models/plan.md`
- **Tryb**: Głęboki
- **Data**: 2026-07-23
- **Werdykt**: SOLIDNY (po auto-poprawkach)
- **Ustalenia**: 0 krytycznych (severity) · 2 ostrzeżenia · 0 obserwacji — wszystkie naprawione inline

## Werdykty

| Wymiar | Werdykt |
|---|---|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | ZALICZONY |
| Kompletność planu | ZALICZONY (po poprawkach) |

## Ugruntowanie

`Grounding: 5/5 paths ✓ (schema.ts, probe.ts, [id]/test.ts, AccountIsland.tsx, byok-key-override.spec.ts), 4/4 symbols ✓ (normalizeBaseUrl private/unexported, probeKey single export, editForm.key_value truthy-guard @ line 474, placeholder @ line 1131), brief↔plan ✓`. Zweryfikowane dodatkowo podagentem: zero istniejącego "list models" prior-art w repo (nowość, nie duplikacja); zero innych konsumentów `probeKey`/`normalizeBaseUrl` poza opisanymi (bezpieczny refaktor); trzy docelowe nowe pliki testów faktycznie nie istnieją; `AccountIsland.test.tsx` używa współdzielonego helpera `stubFetch` (linie 30-40) — dopisane do kryteriów sukcesu Fazy 2.

## Ustalenia

### F1 — Bloki Faz używały `- [ ]` zamiast zwykłych punktorów (kontrakt Postęp↔Faza)

- **Waga**: ⚠️ OSTRZEŻENIE (mechaniczny kontrakt formatu planu)
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 1, 2, 3 — bloki „Kryteria sukcesu"
- **Szczegóły**: Sekcje „Weryfikacja automatyczna/ręczna" w treści faz używały pól wyboru `- [ ]` zamiast zwykłych punktorów `- `, co jest zarezerwowane wyłącznie dla kanonicznej sekcji `## Postęp` na dole planu. Dodatkowo Fazy 1 i 2 miały placeholder-owy wpis „(odroczone do Fazy 3 — brak UI w tej fazie)" pod „Weryfikacja ręczna" zamiast pominięcia pustej podsekcji.
- **Poprawka**: Zamieniono wszystkie `- [ ]` w blokach Faz na zwykłe `- `; usunięto placeholder-owe wpisy „odroczone do Fazy 3" z Faz 1/2 (puste podsekcje „Weryfikacja ręczna" pominięte zgodnie z konwencją). Sekcja `## Postęp` na dole (jedyne miejsce z `- [ ]`/`- [x]`) pozostaje bez zmian — liczby punktów 1.1-1.6/2.1-2.4/3.1-3.7 nadal 1:1 z automatycznymi/ręcznymi kryteriami w treści faz.
- **Decyzja**: NAPRAWIONE (zastosowano inline)

### F2 — E2E kontrakt sugerował glob-string zamiast predykatu pathname

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu (zderzenie z zaakceptowaną regułą z `lessons.md`)
- **Szczegóły**: Kontrakt Fazy 3 zawierał `page.route('**/api/account/keys/models', ...)` — dokładnie ten wzorzec, który `context/foundation/lessons.md` § „Playwright page.route() — predykat pathname zamiast glob-stringa" (2026-06-09+) każe unikać, bo glob-string może dopasować niechciane podścieżki (np. przyszły `/api/account/keys/models/refresh`).
- **Poprawka**: Kontrakt Fazy 3 zaktualizowany na `page.route((url) => url.pathname === '/api/account/keys/models', handler)` z jawnym odwołaniem do reguły w `lessons.md`.
- **Decyzja**: NAPRAWIONE (zastosowano inline)

## Uwagi dodatkowe (bez formalnego ustalenia)

- Generyczność `listModels()` na wszystkie 4 providerów (mimo że UI wystawia przycisk tylko dla `openai_compatible`) była świadomą, udokumentowaną decyzją w `plan-brief.md` (reużycie istniejącego switcha z `probeKey`, zero dodatkowego kosztu) — potwierdzona jako rozsądna, nie wymaga zmiany ani eskalacji do usera (nie jest to projektowanie pod hipotetyczne przyszłe wymagania, tylko nie-zawężanie już generycznego kształtu istniejącego kodu).
- SSRF-adjacent ryzyko (dowolny `base_url` od usera odpytywany server-side) mirroruje dokładnie istniejący, zaakceptowany precedens `[id]/test.ts` — nie jest to nowa powierzchnia ryzyka wprowadzona przez ten plan.

Wszystkie ustalenia LOW-impact z jasną rekomendacją zaaplikowane automatycznie zgodnie z trybem fast-track (`CLAUDE.md` § Workflow agenta) — bez przerywania do menu interaktywnego.
