<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: ProgressModal i pasek postępu we wszystkich flow vision+match

- **Plan**: context/changes/match-progress-all-flows/plan.md
- **Zakres**: Faza 1 + Faza 2 (pełny przegląd)
- **Data**: 2026-06-20
- **Werdykt**: ZAAKCEPTOWANY
- **Ustalenia**: 0 krytycznych / 0 ostrzeżeń / 3 obserwacje

## Werdykty

| Wymiar | Werdykt |
|---|---|
| Plan Adherence | WARNING ⚠️ (1 drobny drift literalny) |
| Scope Discipline | PASS ✅ |
| Safety & Quality | PASS ✅ |
| Architecture | PASS ✅ |
| Pattern Consistency | PASS ✅ |
| Success Criteria | PASS ✅ |

## Weryfikacja automatyczna

| Kryterium | Status |
|---|---|
| `npx vitest run tests/unit/components/PhotoUploader.test.tsx tests/unit/components/DetectionReview.test.tsx` | ✅ 54/54 zielone |
| `npm run typecheck` | ✅ 0 błędów |
| E2E (upload-flow, match-sse-progress, manual-rematch, shelf-photo-pipeline-ui) | ✅ zielone (c2f9e61, 1174753) |

## Weryfikacja ręczna

Potwierdzona przez usera (2026-06-20): „wszystkie 3 miejsca działają prawidłowo" — PhotoUploader 2-step modal, DetectionReview rerun-vision 2-step modal, DetectionReview rerun-match 1-step modal.

## Ustalenia

### F1 — Literalny drift: `runSSEMatch` bez parametru `photoId`

- **Ważność**: 👁 OBSERVATION
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Plan Adherence
- **Lokalizacja**: `src/components/DetectionReview.tsx:2296`
- **Szczegóły**: Plan specyfikuje `runSSEMatch(photoId: string): Promise<void>` z jawnym parametrem. Implementacja używa `runSSEMatch(): Promise<void>` z `photoId` z domknięcia (komponent-scoped). Efekt funkcjonalny identyczny — `photoId` jest zawsze w scope. Klasyczna adaptacja literalna, nie zmiana kontraktu.
- **Poprawka**: Brak akcji kodu — zaakceptowana jako literalna adaptacja. Odnotowane w commit message.
- **Decyzja**: AUTO-APPLIED — accepted as literal adaptation

### F2 — Brak cleanup EventSource przy unmount komponentu

- **Ważność**: 👁 OBSERVATION
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąsko zakrojona
- **Wymiar**: Safety & Quality
- **Lokalizacja**: `src/components/DetectionReview.tsx:2124` (matchSourceRef)
- **Szczegóły**: `matchSourceRef` przechowuje aktywny EventSource bez cleanup przy odmontowaniu komponentu. Przy happy path niezauważalne (window.location.reload() wyprzedza unmount), ale przy nawigacji użytkownika w trakcie ~57s SSE stream EventSource pozostaje otwarty. Pre-existing pattern (był przed refaktorem). React 18 nie rzuca warningiem "Can't update on unmounted", ale wyciek połączenia możliwy.
- **Poprawka**: Dodano `useEffect(() => () => { matchSourceRef.current?.close(); matchSourceRef.current = null; }, [])` po linii 2143. ✅ Zaaplikowane inline.
- **Decyzja**: AUTO-APPLIED — fix committed

### F3 — MockEventSource w unit testach bez `onerror` setter — fallback path nieobjęty

- **Ważność**: 👁 OBSERVATION
- **Wpływ**: 🏃 NISKI — szybka decyzja; dotyczy gap w coverage, nie produkcji
- **Wymiar**: Pattern Consistency
- **Lokalizacja**: `tests/unit/components/DetectionReview.test.tsx:668`
- **Szczegóły**: `MockEventSource` implementuje `addEventListener`/`close`, ale nie ma settera `onerror`. Ścieżka „3x errorCount → fallback `/match`" jest więc niemożliwa do przetestowania w unit testach. Logika fallbacku jest poprawna (kod produkcyjny weryfikowany E2E), ale brak unit coverage oznacza że przyszły refactor może ją złamać bez ostrzeżenia.
- **Poprawka**: Rozszerzyć MockEventSource o setter `onerror` i dodać test `describe` dla ścieżki fallback. Bardziej skomplikowane niż F2 — zalecane jako oddzielny micro-fix lub follow-up.
- **Decyzja**: ODŁOŻONE — follow-up micro-fix; nie blokuje archiwizacji

## Podsumowanie

Implementacja jest zgodna z planem w 10/12 punktach. Dwa drobne drifty to adaptacje literalne (podpis funkcji, terminologia "thin wrapper") — intencja kontraktu zachowana w całości. Brak problemów bezpieczeństwa. Kryteria sukcesu spełnione automatami i ręcznie. Zastosowany jeden inline fix (F2: cleanup EventSource przy unmount). F3 odłożone jako follow-up.

**Werdykt ogólny: ZAAKCEPTOWANY**
