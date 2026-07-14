# AI book resolution przez BYOK openai_compatible provider — krótki plan

> Pełny plan: `context/changes/resolution-openai-compatible-provider/plan.md`

## Co i dlaczego

AI book resolution (`src/lib/resolution/client.ts`, S-50) — najdroższy krok kaskady matchingu (~$0.20/książka, 10× vision) — jest dziś zablokowany wyłącznie do Anthropica, bo używa natywnego `web_search`. User zmierzył empirycznie, że jego self-hosted OpenAI-compatible relay (`RAV_LAPTOP::Qwen/Qwen3.6-27B`) daje sensowne wyniki identyfikacji książek za darmo. Ten plan dodaje branch `openai_compatible` do resolution (bez web_search — model odpowiada wyłącznie z wiedzy treningowej) i zdejmuje blokadę providera.

## Punkt wyjścia

`vision/client.ts` już ma gotową, zero-kodową ścieżkę `openai_compatible` (S-33) — to działa dziś bez zmian. `resolution/client.ts` nie ma takiej ścieżki: `resolve.ts` twardo odrzuca każdy provider poza `anthropic` (`403 AI_RESOLUTION_PROVIDER_UNSUPPORTED`).

## Pożądany stan końcowy

User z aktywnym kluczem BYOK `openai_compatible` może użyć „Rozwiąż przez AI” na detekcji bez kandydatów — wywołanie idzie przez jego self-hosted model zamiast Anthropica, koszt $0, wynik trafia do katalogu identycznie jak dziś. Per-klucz konfigurowalny timeout i limit tokenów (potrzebne dla wolnych/„thinking” modeli — zmierzone empirycznie w tej sesji: część węzłów usera nie kończy odpowiedzi nawet w 120s).

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Zakres przełączenia | Pełne, bez hybrydy | User: "jak wybiorę openai_compatible to tak ma być" — cała ścieżka przez ten provider, zero ukrytego fallbacku do Anthropica | Plan (odpowiedź usera) |
| Budget policy (3/zdjęcie, 20/dzień) | Bez zmian, identyczne dla każdego providera | Limity chronią też przed spamem/pętlą UI, nie tylko kosztem | Plan |
| Anti-halucynacja | Prompt wymusza `null` dla niepewnych pól + istniejący confidence floor (0.5) w resolve.ts | Brak web-search = brak weryfikacji; floor już jest provider-agnostyczny, nic dodatkowego nie trzeba dopisywać | Plan |
| Telemetria | Nowa kolumna `resolution_calls.provider`, `book_candidates.source` zostaje `'ai_resolution'` | Zero zmian w downstream kodzie filtrującym po source, nadal analizowalne per-provider | Plan |
| UX | Krótki tooltip/badge gdy aktywny provider ≠ anthropic | Ustawia oczekiwania (brak web-search → słabsza trafność dla niszowych wydań) bez blokowania flow | Plan |
| Timeout/max_tokens | Konfigurowalne per-klucz (nowe kolumny), używane WSPÓLNIE przez vision i resolution | Realny problem zmierzony w tej sesji (model wisi >120s bez odpowiedzi); wspólna kolumna bo oba moduły mają ten sam problem | Plan |
| Trigger resolution | Bez zmian — fallback po nieudanej kaskadzie | Zero zmian w resolve.ts poza zdjęciem blokady providera, minimalny scope | Plan |

## Zakres

**W zakresie:**
- Nowy branch `openai_compatible` w `resolution/client.ts` + nowy prompt bez web_search
- Zdjęcie guardu providera w `resolve.ts` + telemetria (`resolution_calls.provider`)
- Nowe kolumny `user_api_keys.request_timeout_ms` / `max_tokens_override`, skonsumowane przez VISION i resolution
- UI: formularz kluczy (nowe pola), dynamiczny tekst w `DetectionReview.tsx`

**Poza zakresem:**
- Web search / function-calling dla self-hosted modeli
- Zmiana triggera (kiedy przycisk resolution jest widoczny)
- Zmiana budget policy
- Nowy enum `book_candidates.source`

## Architektura / Podejście

Rozszerzenie istniejącego wzorca „provider abstraction" (S-33) z vision na resolution — ten sam kształt brancha (`if provider !== 'anthropic'`), osobny prompt, ten sam `AiResolutionResultSchema` jako kontrakt wyjściowy (provider-agnostyczny). Nowa konfiguracja timeout/tokenów żyje w `user_api_keys` i jest czytana przez oba moduły openai-compat.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Schema | Migracja + typy + propagacja przez keys API | Migracja czysto addytywna — niskie ryzyko |
| 2. Vision config | Timeout/max_tokens konsumowane w vision openai-compat | Regresja istniejącego zachowania dla `null` — pokryte testami |
| 3. Resolution branch | Nowy branch + prompt + zdjęcie guardu + telemetria | Halucynacja bez web-search — zaadresowane promptem + istniejącym confidence floor |
| 4. UI | Formularz + dynamiczny tekst w DetectionReview | 3× zduplikowany tekst dialogu do zaktualizowania spójnie |

**Wymagania wstępne:** żadne — rozszerza istniejący, działający kod
**Szacowany nakład pracy:** ~4 sesje implementacyjne (1 na fazę), medium złożoność

## Otwarte ryzyka i założenia

- Self-hosted modele bez web_search będą miały gorszą jakość dla niszowych/obskurnych wydań — dokładnie tam, gdzie resolution jest pomyślany jako fallback. User świadomie akceptuje to jako koszt pełnego przełączenia.
- Niektóre węzły relaya usera (np. `rav_lmstudio`) mogą nie odpowiadać w rozsądnym czasie nawet z wysokim `max_tokens_override` — to ograniczenie sprzętowe/modelowe poza kontrolą kodu, zaadresowane przez konfigurowalny timeout (czytelny błąd zamiast wieszania UI), nie przez zmianę logiki.

## Kryteria sukcesu (podsumowanie)

- User z aktywnym kluczem `openai_compatible` może użyć „Rozwiąż przez AI" i dostać poprawny wynik z własnego modelu, koszt $0
- Wolne modele kończą się czytelnym błędem zamiast wieszać UI (dzięki konfigurowalnemu timeoutowi)
- Zero regresji dla istniejącej ścieżki Anthropic (vision i resolution)
