<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Per-call BYOK key override

- **Plan**: context/changes/per-call-byok-key-override/plan.md
- **Zakres**: Pełny plan (Faza 1-3)
- **Data**: 2026-07-14
- **Werdykt**: ZAAKCEPTOWANY
- **Ustalenia**: 0 krytycznych, 1 ostrzeżenie, 3 obserwacje

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność z planem | PASS |
| Dyscyplina zakresu | WARNING |
| Bezpieczeństwo i jakość | PASS |
| Architektura | PASS |
| Spójność wzorców | WARNING |
| Kryteria sukcesu | PASS |

## Weryfikacja automatyczna

- `npm run typecheck` — 0 błędów
- `npm run lint` — czysto
- `npx vitest run` — 1242/1242
- `npx playwright test tests/e2e/byok-key-override.spec.ts tests/e2e/shelf-photo-pipeline-ui.spec.ts` — 21/21
- `npm run build` — sukces

## Weryfikacja ręczna

- 3.6 Dropdown działa na koncie z 2 kluczami — potwierdzone przez usera
- 3.7 Lista 1-pozycyjna na koncie z 1 kluczem — potwierdzone przez usera
- 3.8 `is_active` niezmienione po użyciu override — potwierdzone przez usera (Supabase Studio)

## Ustalenia

### F1 — PhotoListIsland.tsx: EXTRA scope poza oryginalnym planem

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja, poprawka oczywista
- **Wymiar**: Dyscyplina zakresu
- **Lokalizacja**: src/components/PhotoListIsland.tsx (cały plik)
- **Szczegóły**: Plan nie wymieniał `PhotoListIsland.tsx`. User zgłosił podczas manualnej weryfikacji Fazy 3, że drugi, niezależny trigger „Ponów vision" (lista zdjęć na półce) nie miał wpiętego wyboru klucza. Naprawione w tej samej fazie, wzorzec wierny DetectionReview.tsx, z testem E2E. Kontrakt zmiany się nie zmienił — dokończenie pokrycia UI, nie nowa funkcja.
- **Fix**: Już udokumentowane w commit message Fazy 3 (`01316d9`) i komentarzu w kodzie. Nic do zrobienia.
- **Decyzja**: ZAAKCEPTOWANE (already resolved)

### F2 — useApiKeys: error handling rozjeżdża się z precedensem CostAnalysisModal

- **Ważność**: OBSERWACJA
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: src/components/useApiKeys.ts:20-25
- **Szczegóły**: Silent catch + traktowanie każdej nie-`data` odpowiedzi (w tym 401) jako `keys: []`. Istniejący analogiczny hook (`CostAnalysisModal.tsx:73-85`) ma osobny `error` state + `cancelled` guard. Niskie ryzyko (dropdown/disable, nie dane transakcyjne).
- **Fix**: Dodano `error` state (rozróżnienie `data`/`error` w odpowiedzi, mirror `CostAnalysisModal.tsx`) + `requestIdRef` guard przeciw wyścigom. 4 nowe testy w `useApiKeys.test.tsx` (5/5 zielone), zero regresji w pełnym unit suite (1244/1244).
- **Decyzja**: NAPRAWIONE

### F3 — Brak race-guard w fetchKeys() przy szybkim wielokrotnym otwarciu dialogu

- **Ważność**: OBSERWACJA
- **Wymiar**: Bezpieczeństwo i jakość (niezawodność)
- **Lokalizacja**: src/components/useApiKeys.ts
- **Szczegóły**: Klik→zamknij→klik może teoretycznie dać wyścig odpowiedzi. Niskie ryzyko, dotyczy tylko listy kluczy w dropdownie.
- **Decyzja**: NAPRAWIONE (ten sam `requestIdRef` mechanizm z F2 — potwierdzone testem "szybkie podwójne fetchKeys()")

### F4 — runProcessSSE: zmiana sygnatury to potencjalnie "silent break" na przyszłość

- **Ważność**: OBSERWACJA
- **Wymiar**: Architektura
- **Lokalizacja**: src/lib/vision/runProcessSSE.ts:18-20
- **Szczegóły**: `(photoId, onStarted?)` → `(photoId, opts?: {apiKeyId?, onStarted?})`. Zweryfikowano wszystkie 3 call-site'y — żaden nie używał starego pozycyjnego `onStarted`, brak realnej regresji teraz. Wzorzec ryzyka na przyszłość (błędne wywołanie nie rzuciłoby błędu typu w runtime).
- **Decyzja**: POMINIĘTE (TypeScript strict + 0 realnych call-site'ów z regresją już wystarczające zabezpieczenie)
