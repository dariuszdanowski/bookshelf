# Per-call BYOK key override — Krótki plan

> Pełny plan: `context/changes/per-call-byok-key-override/plan.md`

## Co i dlaczego

Dziś refine, „Rozwiąż przez AI" i przetwarzanie/rerun vision zawsze używają jedynego `is_active=true` klucza BYOK usera — bez wyboru. Ten plan dodaje dropdown wyboru klucza w istniejących dialogach potwierdzenia tych trzech akcji, domyślnie ustawiony na aktywnym kluczu, jako jednorazowy override (nie zmienia trwałego `is_active`).

## Punkt wyjścia

`getActiveProviderConfig` (`src/lib/keys/getActiveProviderConfig.ts`) selectuje jeden wiersz po `is_active=true`; 3 endpointy (`resolve.ts`, `refine.ts`, `process.ts`) nie parsują dziś JSON body. `ConfirmDialog` (już opakowuje wszystkie 3 akcje) przyjmuje tylko `message: string`, brak slotu na dodatkową treść. Wzorzec pochodzi z sesji badawczej, w której odkryto że model glm-ocr jest OCR-only i user chciał móc świadomie testować różne klucze bez przełączania „aktywnego" na stałe.

## Pożądany stan końcowy

User z ≥2 kluczami widzi dropdown (`etykieta (provider)`) w dialogu każdej z 3 akcji, może wybrać inny niż aktywny klucz na to jedno wywołanie. User z ≤1 kluczem widzi dokładnie to co dziś — zero wizualnego szumu.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Zakres akcji | resolve + vision (process/rerun) + refine | User: chce testować różne modele na wszystkich trzech ścieżkach AI | Plan (odpowiedź usera) |
| Trwałość wyboru | Jednorazowy override, `is_active` bez zmian | Bezpieczniejsze — nie psuje innych flow polegających na "aktywnym" kluczu | Plan (odpowiedź usera) |
| UI slot | Dropdown wewnątrz istniejącego `ConfirmDialog` (nowy `children` prop) | Wszystkie 3 akcje już przechodzą przez ten dialog — zero nowej architektury | Plan (research) |
| 1-klucz UX | Ukryj selektor całkowicie | Zero szumu dla najczęstszego przypadku, brak złudnego wyboru | Plan (odpowiedź usera) |
| Info w liście | Etykieta + provider w nawiasie | Wzorzec już użyty w `activeKeyInfo`, wystarcza do rozróżnienia | Plan (odpowiedź usera) |
| Fetch listy kluczy | Wspólny hook `useApiKeys` (lazy-on-open) | DRY, zastępuje 2 istniejące ad-hoc fetche zamiast dodawać 3.; musi zachować lazy-fetch semantykę (ochrona kolejności mocków w testach) | Plan (odpowiedź usera) |
| Błąd: keyId nie istnieje/cudzy | 404 NOT_FOUND (nie 403) | Spójne z konwencją repo (RLS-scoped "nie ma/nie mój" = 404, nigdy leak przez 403) | Plan (research) |

## Zakres

**W zakresie:**
- Backend: opcjonalny `apiKeyId` w body 3 endpointów, rozszerzenie `getActiveProviderConfig`
- Frontend: `ConfirmDialog` children slot, `useApiKeys` hook, `ApiKeySelect` komponent, wpięcie w 8 miejsc w `DetectionReview.tsx`
- Pełne testy: Vitest (unit) + Playwright (E2E, wszystkie scenariusze wg standardu projektu)

**Poza zakresem:**
- Refaktor 3× powielonych bloków renderowania w `DetectionReview.tsx` (istniejący fakt pliku, niezależny od tej zmiany)
- Zmiana `is_active` / trwałego aktywnego klucza konta
- Wybór klucza dla „Ponów match" (nie woła BYOK)
- Trwałość wyboru (localStorage)

## Architektura / Podejście

Addytywne rozszerzenie istniejącego wzorca provider-abstraction (S-33, `resolution-openai-compatible-provider`): opcjonalne pole w body → opcjonalny parametr w lib-funkcji → UI slot w już istniejącym dialogu. Zero migracji SQL (RLS już wystarcza do lookupu po `id`).

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Backend | Opcjonalny `apiKeyId` w 3 endpointach + `getActiveProviderConfig(..., keyId?)` | Puste body (dzisiejsze wywołania) musi być tolerowane, nie 400 |
| 2. Frontend infra | `useApiKeys`, `ApiKeySelect`, `ConfirmDialog` children slot | Lazy-fetch semantyka musi przetrwać refaktor (ochrona testów) |
| 3. Wiring + testy | 8 call-site'ów podłączonych, pełne Vitest+Playwright | Duże, mechaniczne rozproszenie edycji w battle-tested `DetectionReview.tsx` |

**Wymagania wstępne:** żadne — rozszerza istniejący, działający kod
**Szacowany nakład pracy:** ~3 sesje implementacyjne (1 na fazę), złożoność średnia

## Otwarte ryzyka i założenia

- `DetectionReview.tsx` (3600+ linii) ma już dziś 3× powielone bloki renderowania per widok — każda z 8 edycji musi być zaaplikowana identycznie we wszystkich kopiach; łatwo przeoczyć jedną (mitygacja: E2E pokrywa wszystkie 3 view mode warianty).
- Fetch-mock-ordering w istniejących testach jest krucha (udokumentowana wprost w kodzie) — refaktor do `useApiKeys` musi być ostrożny, żeby nie przesunąć kolejności wywołań `fetch` w testach niezwiązanych z tą zmianą.

## Kryteria sukcesu (podsumowanie)

- User z 2+ kluczami może wybrać inny niż aktywny klucz per-wywołanie dla refine/resolve/vision, bez zmiany trwałego `is_active`
- User z ≤1 kluczem nie widzi żadnej zmiany w UI
- Zero regresji w istniejącym ~845-testowym unit suite + 28 E2E specs
