# Model picker dla klucza BYOK openai_compatible — Krótki plan

> Pełny plan: `context/changes/byok-openai-compatible-models/plan.md`

## Co i dlaczego

Dziś pole "Model" przy kluczu `openai_compatible` (Moje konto → Klucze API) to zwykły tekst — użytkownik musi ręcznie znać i przepisać dokładny identyfikator modelu serwowanego przez jego serwer (np. przez `cf-llm-relay`/LM Studio). Literówka = błąd dopiero przy pierwszym realnym wywołaniu vision/resolution. Dodajemy przycisk "Załaduj modele" obok pola Model, który po podaniu adresu (base URL) i klucza odpytuje `GET {base_url}/v1/models` i pokazuje klikalną listę z znacznikiem dostępności każdego modelu — kliknięcie wpisuje dokładną nazwę.

## Punkt wyjścia

`AccountIsland.tsx` ma już formularz dodawania i edycji klucza z warunkowym polem `base_url` dla `openai_compatible` oraz przycisk "Testuj" (`POST /api/account/keys/[id]/test`) który odpytuje `probeKey()` (`src/lib/keys/probe.ts`) — ale tylko sprawdza 2xx/nie-2xx na `/v1/models`, nie pokazuje listy. `probeKey` już zna URL/nagłówki dla wszystkich 4 providerów.

## Pożądany stan końcowy

W formularzu dodawania i edycji klucza `openai_compatible`, po wpisaniu base URL i klucza, użytkownik klika "Załaduj modele" i widzi listę modeli zwróconych przez serwer, każdy ze znacznikiem "Dostępny"/"Niedostępny". Kliknięcie modelu wpisuje jego dokładny identyfikator w pole Model.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Zakres formularzy | Przycisk w formularzu dodawania I edycji (symetrycznie) | Ten sam problem (znajomość dokładnej nazwy modelu) istnieje przy dodawaniu nowego klucza, nie tylko przy edycji istniejącego — pominięcie add-formu byłoby niespójną luką w tym samym UI | Plan |
| Generyczność lib funkcji | `listModels(provider, apiKey, baseUrl)` w `probe.ts` obsługuje wszystkie 4 providery (jak istniejący `probeKey`) | Zero dodatkowego kosztu (reużywa URL/nagłówki z `probeKey`), UI i tak wystawia przycisk tylko dla `openai_compatible` — łatwe rozszerzenie później bez zmian backendu | Plan |
| Endpoint | Nowy `POST /api/account/keys/models`, zawsze 200 z `{result:'ok'|'error', models:[]}` | Mirror istniejącego wzorca `POST /api/account/keys/[id]/test` (probe-style akcja, nie CRUD) — probe failure to wynik, nie błąd serwera | Plan |
| Klucz dla nie-zapisanego formularza | Body przyjmuje `key_value` (ad-hoc, dla add-formu i edycji z nowym kluczem) LUB `id` (fallback na zaszyfrowany klucz z DB, dla edycji z pustym polem "nowy klucz") | Edit-form ma "Pozostaw puste, aby nie zmieniać" — serwer musi wtedy odszyfrować już zapisany klucz zamiast wymagać przepisania go tylko po to, by przetestować listę modeli | Plan |
| Znacznik dostępności | Heurystyka: pola `available`/`is_available` (bool) lub `status`/`state` (string) na obiekcie modelu; brak takich pól → domyślnie dostępny | Standard OpenAI `/v1/models` nie ma pola dostępności (sama obecność w liście = dostępny) — heurystyka daje realną wartość, gdy serwer (np. `cf-llm-relay`) faktycznie zwraca taki sygnał, i gracefully degraduje do "wszystkie dostępne" gdy nie zwraca | Plan |
| Normalizacja base_url przed zapisem | Eksport istniejącego `normalizeBaseUrl` z `schema.ts` i reużycie w nowym endpoint | Add-form wysyła surowy, jeszcze nie zapisany `base_url` (mógł mieć trailing `/v1`) — ten sam bug klasy "podwójne /v1/v1" co przy zapisie musi być zaadresowany tu też | Plan |
| Timeout zapytania do serwera modeli | 10s `AbortSignal.timeout` w `listModels` (nowe, `probeKey` bez zmian) | Lokalny relay (WS bridge do prywatnej maszyny) może wisieć bez odpowiedzi — endpoint nie może zawiesić się w nieskończoność | Plan |

## Zakres

**W zakresie:**
- Nowa funkcja `listModels()` w `src/lib/keys/probe.ts` + eksport `normalizeBaseUrl` z `schema.ts`
- Nowy Zod schema `ListModelsInputSchema`
- Nowy endpoint `POST /api/account/keys/models`
- UI: przycisk "Załaduj modele" + klikalna lista ze znacznikiem dostępności w add-formie i edit-formie (`AccountIsland.tsx`), tylko dla `provider === 'openai_compatible'`
- Unit testy (schema, lib, endpoint, komponent) + E2E (Playwright, zmockowany endpoint)

**Poza zakresem:**
- Rozszerzenie przycisku na providerów `anthropic`/`openai`/`openrouter` (lib to już wspiera, UI — nie w tym slice)
- Zapamiętywanie/cache'owanie listy modeli między sesjami
- Realne uderzenie w `cf-llm-relay` w automatach — E2E mockuje własny endpoint aplikacji, nie zewnętrzny serwer

## Architektura / Podejście

Przeglądarka → `POST /api/account/keys/models` (nasz serwer) → `fetch({base_url}/v1/models)` server-side (dokładnie ten sam wzorzec co istniejący `probeKey`/test-endpoint) → parsowanie `{data:[...]}` → heurystyka dostępności → sortowanie (dostępne first, potem alfabetycznie) → zwrot do UI, gdzie renderuje się jako klikalna lista.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Backend | `listModels()`, `ListModelsInputSchema`, `POST /api/account/keys/models` + unit testy | Kształt odpowiedzi realnych serwerów OpenAI-compatible jest niejednorodny — heurystyka dostępności to best-effort |
| 2. Frontend | Przycisk + lista w add/edit-formie `AccountIsland.tsx` + unit testy komponentu | Stan listy musi być czyszczony przy zmianie base_url/klucza/zamknięciu formularza, inaczej user zobaczy nieaktualną listę |
| 3. E2E | Playwright spec (mock `/api/account/keys/models`) dla add i edit flow | — |

**Wymagania wstępne:** brak (samodzielny slice, zero zmian schematu DB).
**Szacowany nakład pracy:** ~1 sesja, 3 fazy.

## Otwarte ryzyka i założenia

- ~~Heurystyka dostępności nie ma potwierdzonego kontraktu z żadnym konkretnym serwerem~~ — **zweryfikowane manualnie w Fazie 3** (2026-07-24) na żywym `cf-llm-relay` (`localhost:8787`): realny kształt to `health: 'healthy'|'unhealthy'` per model, nie `status`/`state`. Heurystyka w `probe.ts` dopisana o pole `health` + `'unhealthy'` w zbiorze niedostępnych wartości.
- **Drugie kalibrujące odkrycie z tej samej manualnej weryfikacji**: multi-agent relaye (jak `cf-llm-relay`) zwracają per model zarówno `id` (goła nazwa) jak i `qualified_id` (`<agent>::<model>`, np. `mId-lmstudio::qwen2.5-vl-3b-instruct`) — do realnych wywołań trzeba użyć `qualified_id`, nie `id` (użytkownik ręcznie wpisywał identyfikatory w tym formacie, np. `rav_lmstudio::qwen/qwen3.5-9b`, właśnie dlatego że gołe `id` nie jest routowalne do konkretnej maszyny). `listModels()` teraz preferuje `qualified_id`, z fallbackiem na `id` dla standardowych serwerów OpenAI-compatible bez tego pola.

## Kryteria sukcesu (podsumowanie)

- Po wpisaniu base URL + klucza dla `openai_compatible` i kliknięciu "Załaduj modele", użytkownik widzi listę z znacznikiem dostępności (add i edit form)
- Kliknięcie modelu na liście wpisuje jego dokładny identyfikator w pole Model
- Błąd sieci/zły klucz/zły adres → czytelny komunikat błędu, zero crasha UI
