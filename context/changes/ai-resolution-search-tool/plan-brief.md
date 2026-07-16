# search_book tool dla AI-resolution — Krótki plan

> Pełny plan: `context/changes/ai-resolution-search-tool/plan.md`
> Dokument źródłowy: `modificationPlans/20260714-PROPOSAL-llm-book-search-extensions.md` (Propozycja 1)

## Co i dlaczego

AI-resolution (`src/lib/resolution/client.ts`) to ostatni poziom kaskady matchingu — wołany
gdy OCR + structural matching (Google Books/Open Library/Biblioteka Narodowa) nie znajdzie
kandydata. Dla providera Anthropic model ma natywny `web_search` i weryfikuje swoje
odpowiedzi. Dla każdego innego providera (`openai`/`openrouter`/`openai_compatible` — w tym
wszystkie modele lokalne serwowane przez cf-llm-relay, jedyne realistyczne zastosowanie
własnego LLM-relaya w tym projekcie) model dziś **zgaduje wyłącznie z pamięci, zero
weryfikacji**. Ten change domyka tę lukę: owija istniejący, gotowy silnik wyszukiwania
(`findBookCandidates`) w narzędzie `search_book`, które model może wywołać samodzielnie.

## Punkt wyjścia

`resolveViaOpenAICompat` wykonuje dziś jedno zapytanie `chat/completions` bez `tools` i
parsuje odpowiedź. `findBookCandidates` (Google Books + Open Library + Biblioteka Narodowa,
scoring, dedupe) jest już gotową, czystą funkcją używaną gdzie indziej w repo (rematch,
ręczna identyfikacja) — nie trzeba nowego źródła danych, tylko owinąć istniejącą funkcję w
kontrakt narzędzia wywoływanego przez model.

## Pożądany stan końcowy

Model podpięty jako `openai_compatible`/`openai`/`openrouter` może w trakcie AI-resolution
samodzielnie wywołać `search_book` (do 3 rund), zamiast odpowiadać z czystej pamięci.
Serwery bez wsparcia function-calling działają identycznie jak dziś (automatyczny fallback
na HTTP 400) — zero regresji.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Limit rund | `MAX_TOOL_ROUNDS = 3` | Spójne z `MAX_WEB_SEARCH_USES` Anthropic i budżetem resolution | Plan |
| Implementacja | Rozszerzenie `resolveViaOpenAICompat` w miejscu | Zero duplikacji, sygnatura `resolveBookViaAI` bez zmian | Plan |
| Fallback bez `tools` | Retry bez `tools` tylko na 1. requeście przy HTTP 400 | Message-matching błędów różnych serwerów jest kruche; status 400 na starcie wystarcza | Badania/Plan |
| Równoległe `tool_calls` | Obsłużone (pętla po tablicy) | Ignorowanie części wywołań byłoby cichą utratą danych | Plan |
| Walidacja argumentów | Zod, błąd → feedback do modelu, nie crash | Konwencja repo: Zod dla external I/O; model może się poprawić | Plan |
| `searchCount` audytu | Liczba faktycznych wywołań `search_book` | Spójne znaczeniowo z `web_search_requests` Anthropic | Badania |
| Prompt | Nowy wariant tylko dla ścieżki z tools, stary zostaje jako fallback | Zero regresji dla serwerów bez function-calling | Badania/Plan |

## Zakres

**W zakresie:** kontrakt narzędzia `search_book`, nowy system prompt, pętla tool-calling w
`resolveViaOpenAICompat` z fallbackiem, testy jednostkowe, manualny smoke test.

**Poza zakresem:** Propozycje 2-6 z dokumentu źródłowego (few-shot z `corrections`,
embeddingi, LLM-arbiter kandydatów, skanowanie ISBN, trwała historia `match_attempts`);
gałąź Anthropic; zmiana kontraktu `AiResolutionOutcome`/endpointu `resolve.ts`;
`budgetPolicy.ts`.

## Architektura / Podejście

Model → `POST /v1/chat/completions` z `tools: [search_book]` → jeśli `tool_calls`, wywołaj
`findBookCandidates` in-process (ten sam runtime, bez nowego endpointu) → dołóż wynik jako
wiadomość `role: 'tool'` → kolejne zapytanie → powtórz do 3 rund → finalna odpowiedź bez
`tools` → parsowanie bez zmian (`AiResolutionResultSchema`, provider-agnostyczny).

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Kontrakt + pętla | `SEARCH_BOOK_TOOL`, nowy prompt, tool-calling loop z fallbackiem w `client.ts` | Sekwencjonowanie wiadomości (assistant+tool_calls → tool responses) musi być poprawne, inaczej serwer odrzuci request |
| 2. Testy + smoke test | Pełne pokrycie branchy (happy/multi-round/limit/fallback/parallel/invalid-args) + manualne potwierdzenie na żywym modelu | Nie wszystkie lokalne modele równie dobrze obsługują wieloturnowy tool-calling — mitygacja: limit rund + twardy fallback |

**Wymagania wstępne:** brak (moduł izolowany, zero migracji DB).
**Szacowany nakład pracy:** ~1 sesja, 2 fazy (jeden plik implementacji + jeden plik testów).

## Otwarte ryzyka i założenia

- Nie wszystkie modele lokalne (LM Studio itd.) równie dobrze obsługują wieloturnowy
  tool-calling z historią `tool` messages — może wymagać dostrojenia promptu per model
  (poza zakresem tego planu, obserwować przy manualnym smoke teście).
- `findBookCandidates` woła 3 zewnętrzne API równolegle — przy 3 rundach to do 9 dodatkowych
  wywołań zewnętrznych na jedno AI-resolution; akceptowalne przy istniejącym budżecie.

## Kryteria sukcesu (podsumowanie)

- Model `openai_compatible`/`openai`/`openrouter` faktycznie wywołuje `search_book` zamiast
  zgadywać z pamięci, gdy to pomaga zidentyfikować książkę.
- Serwery bez wsparcia `tools` działają dokładnie jak dziś (zero regresji).
- Pełne pokrycie testowe nowej logiki, zero zmian w kontrakcie publicznym modułu.
