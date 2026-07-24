# Plan: rozszerzenia wyszukiwania książek przez LLM (propozycja)

## Status

**Propozycja — brak powiązanego GitHub Issue / ticketu Jira.** Ten dokument nie ma
odpowiednika `gh-issue-fingerprint`/`Realizacja`/`Weryfikacja spójności danych GitHub Issue`
z innych planów w tym katalogu, bo nic tu jeszcze nie jest zaimplementowane — to lista
konkretnych propozycji do decyzji, nie zapis wykonanej pracy. Propozycja #1 jest rozpisana
do poziomu gotowego do wdrożenia; #2–#5 są na poziomie uzasadnienia i szkicu zakresu
(wymagają osobnego doprecyzowania przed realizacją).

**Aktualizacja 2026-07-15:** dopisana Propozycja 6 na wniosek właściciela repo — trwała
historia prób OCR/matchingu (prompt + odpowiedź + wszystkie propozycje kandydatów) zamiast
dzisiejszego stanu, w którym część ścieżek destrukcyjnie nadpisuje poprzednie wyniki.
Zweryfikowano bezpośrednio w kodzie, że rzeczywisty mechanizm jest bardziej niejednorodny,
niż sugerowała pierwotna obserwacja — zob. nowa podsekcja w § Kontekst oraz Propozycja 6.

**Aktualizacja 2026-07-16:** dopisana Propozycja 7 na wniosek właściciela repo — dzisiejsze
globalne, zaszyte w kodzie limity budżetu AI-resolution (`maxCallsPerPhoto`/
`maxCallsPerUserAction`/`maxCallsPerDay`) jako konfigurowalne per-profil, z domyślnymi
wartościami identycznymi jak dziś, edytowalne przez samego użytkownika (self-service, nie
admin-only).

Powstało w ramach sesji w `cf-llm-relay` (Cloudflare Worker + lokalny agent WebSocket
serwujący modele LLM z prywatnych maszyn, np. LM Studio) po:
1. przeglądzie architektury identyfikacji książek w tym repo (OCR → matching → AI-resolution),
2. odrzuceniu koncepcji scrapowania `lubimyczytac.pl` (Google → Playwright → klik → scrape)
   jako niezgodnej z regulaminem serwisu (§2 ust. 6 pkt 2 i 11 — zakaz automatycznego
   pobierania i botów) i prawem do baz danych (§6, ustawa o ochronie baz danych,
   dyrektywa 96/9/WE) — `robots.txt` serwisu dodatkowo jawnie blokuje boty AI (w tym
   ClaudeBot),
3. potwierdzeniu na żywo, że modele lokalne serwowane przez cf-llm-relay poprawnie
   obsługują OpenAI-style `tool_calls` (test na `qwen/qwen3.5-9b` przez
   `rav_lmstudio::qwen/qwen3.5-9b` — model poprawnie zwrócił `tool_calls` dla
   zdefiniowanego narzędzia `search_web`).

## Kontekst: obecny stan pipeline'u

Zweryfikowane bezpośrednio w kodzie (nie tylko z opisu):

- **Vision/OCR**: `src/lib/vision/client.ts` — Claude (domyślnie `claude-sonnet-4-6`) albo
  BYOK `openai_compatible`/`openai`/`openrouter` przez surowy `fetch` do
  `{baseUrl}/v1/chat/completions`. Prompt: `src/lib/vision/prompt.ts`.
- **Matching strukturalny**: `src/lib/matching/findCandidates.ts` →
  `findBookCandidates(rawTitle, rawAuthor, rawIsbn, opts)` — **czysta funkcja bez DB**,
  odpytuje równolegle Google Books (`src/lib/books/googleBooks.ts`), Open Library
  (`src/lib/books/openLibrary.ts`) i Bibliotekę Narodową
  (`src/lib/books/nationalLibrary.ts`), scoruje (`score.ts`), dedupe'uje, ma word-level
  OCR fallback i opcję `isbnOnly`. To jest **gotowy, gwarantowanie legalny silnik
  wyszukiwania**, którego można użyć jako implementacji narzędzia dla LLM.
- **AI-resolution (ostatni poziom kaskady)**: `src/lib/resolution/client.ts` —
  `resolveBookViaAI(query, config)`:
  - dla `provider === 'anthropic'`: Claude + natywne narzędzie
    `{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }` (linia 212),
  - dla `provider !== 'anthropic'` (`openai`/`openrouter`/`openai_compatible` — **w tym
    modele podpięte przez cf-llm-relay jako BYOK**): `resolveViaOpenAICompat` (linia 107),
    **pojedyncze zapytanie chat completion, ZERO `tools`, ZERO web_search** — model
    odpowiada wyłącznie z wiedzy treningowej, bez możliwości weryfikacji
    (`AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT`, `src/lib/resolution/prompt.ts:46-68`,
    świadomie mocno naciska na `null` zamiast zgadywania — ale to nadal zgadywanie).
  - Wywoływane z `src/pages/api/detections/[id]/resolve.ts`, budżetowane przez
    `src/lib/resolution/budgetPolicy.ts` (`maxCallsPerPhoto: 3, maxCallsPerUserAction: 1,
    maxCallsPerDay: 20`), audytowane w tabeli `resolution_calls`.
  - Kontrakt wyjściowy: `AiResolutionResultSchema`
    (`src/lib/resolution/schema.ts`) — discriminated union `found`/`not_found`,
    provider-agnostyczny (nie trzeba go zmieniać).
- **`corrections`**: zapisywana w wielu miejscach (`manual_entry`, `refine`,
  `parse_failure`, `ai_resolution_not_found`, `accept`/`field_edit`) — czysto jako
  audyt/telemetria, nigdzie nieużywana do poprawy promptów/progów.
- Dopasowanie to wyłącznie string similarity (Levenshtein, `score.ts`) — brak
  jakiegokolwiek komponentu semantycznego/embeddingowego.
- Brak skanowania kodów kreskowych.
- **Trwałość historii wyszukiwań — trzy różne zachowania, dziś pomieszane** (zweryfikowane
  2026-07-15, dot. Propozycji 6 poniżej):
  1. **Pełne przetwarzanie zdjęcia** (`src/pages/api/photos/[id]/process.ts:56-61`) jest
     formalnie *append-only* — każde wywołanie tworzy nowy wiersz `vision_runs` i nowe
     `detections` (`vision_run_id` FK), stare wiersze nigdy nie są usuwane (komentarz w
     kodzie: "DELETE per photo_id jest zakazane"). **Ale** `GET /api/photos/[id]`
     (`src/pages/api/photos/[id].ts:117-166`) zwraca detekcje **tylko z najnowszego
     udanego `vision_run`** — starsze przebiegi są nieosiągalne przez UI i nigdy nie są
     ze sobą reconciled. Efekt end-to-end dla użytkownika jest taki jak przy nadpisaniu,
     mimo że bajty w DB przeżywają.
  2. **`refine` (pojedyncza detekcja, crop + ponowny OCR)** —
     `src/pages/api/detections/[id]/refine.ts:380-389` robi **prawdziwy `UPDATE`** na
     `detections.raw_title/raw_author/vision_confidence/spine_color` w miejscu. Kandydaci
     (`book_candidates`) są **hard-DELETE + INSERT** (linie 404-422), gdy nowy top-score
     mieści się w `CONSERVATIVE_REPLACE_MARGIN` względem starego — poprzednia lista
     kandydatów ginie bezpowrotnie. Jedyny ślad: wpis w `corrections`
     (`correction_type: 'refine'`, linie 348-361) — ale to tylko diff
     `original_raw_title/author` → `corrected_title/authors`, **bez** listy kandydatów,
     bez surowej odpowiedzi modelu, bez promptu.
  3. **`rematch` (ręczna korekta tytułu/autora/ISBN → ponowny matching)** —
     `src/pages/api/detections/[id]/rematch.ts:190-217` identyczny wzorzec: `UPDATE`
     `detections` + hard-DELETE/INSERT `book_candidates`, z tym samym cienkim
     `corrections` breadcrumb (linie 158-188).
  - `GET /api/detections/[id]/history` (`src/pages/api/detections/[id]/history.ts`) —
    jedyny odczyt `corrections` w produkcie — pokazuje tylko chronologię
    title/author diffów, nie propozycje kandydatów ani surowe promptowanie.
  - **Wniosek**: żadna ścieżka nie przechowuje dziś (a) pełnej listy kandydatów przed
    filtrowaniem/progowaniem, (b) użytego promptu/wariantu, (c) surowej odpowiedzi modelu.
    `vision_runs`/`detections` z pełnego przetwarzania *technicznie* przeżywają, ale są
    funkcjonalnie martwe (żaden kod ich nie czyta poza najnowszym runem) — więc obserwacja
    "wyniki się nadpisują" jest **trafna w praktyce**, nawet jeśli nieprecyzyjna dosłownie.

---

## Propozycja 1: `search_book` tool dla providerów bez natywnego web-search

### Uzasadnienie

Dokładnie zlokalizowana luka: **każdy model podpięty jako `openai_compatible` (w tym
wszystkie modele lokalne serwowane przez cf-llm-relay) w AI-resolution zgaduje z pamięci,
zero weryfikacji.** Dla Anthropic to nie problem (natywny `web_search`), ale dla
tańszych/lokalnych/prywatnych modeli — jedynego sensownego zastosowania cf-llm-relay w tym
projekcie — to najsłabsze ogniwo kaskady. `findBookCandidates` to gotowa, legalna,
już przetestowana implementacja wyszukiwania książek (Google Books + Open Library +
Biblioteka Narodowa) — **nie trzeba żadnego nowego źródła danych, tylko owinąć istniejącą
funkcję w narzędzie wywoływane przez model.**

Dodatkowa korzyść: `findBookCandidates` jest wołana **in-process** (Astro server-side,
ten sam runtime co `resolve.ts`) — pętla tool-calling nie wymaga nowego endpointu HTTP ani
przechodzenia przez sieć drugi raz, tylko bezpośredniego wywołania funkcji w handlerze
odpowiedzi na `tool_calls`.

### Kontrakt narzędzia

```ts
export const SEARCH_BOOK_TOOL = {
  type: 'function',
  function: {
    name: 'search_book',
    description:
      'Szuka książki po tytule/autorze/ISBN w Google Books, Open Library i Bibliotece ' +
      'Narodowej. Zwraca do 8 najlepiej dopasowanych kandydatów z tytułem, autorami, ' +
      'ISBN, wydawcą, rokiem wydania i wynikiem dopasowania (0-1).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tytuł książki (może pochodzić z zaszumionego OCR)' },
        author: { type: ['string', 'null'], description: 'Autor, jeśli znany' },
        isbn: { type: ['string', 'null'], description: 'ISBN-10 lub ISBN-13, jeśli znany' },
      },
      required: ['title'],
    },
  },
} as const;
```

### Pętla tool-calling — zmiana w `src/lib/resolution/client.ts`

Nowa funkcja `resolveViaOpenAICompatWithSearch` (albo rozszerzenie istniejącej
`resolveViaOpenAICompat`, linia 107) zastępująca dzisiejsze pojedyncze wywołanie pętlą:

1. Pierwsze zapytanie: `messages: [{system: <nowy prompt>}, {user: buildUserPrompt(query)}]`,
   `tools: [SEARCH_BOOK_TOOL]`.
2. Jeśli odpowiedź zawiera `tool_calls` z `name: 'search_book'`:
   - sparsuj `arguments` (JSON.parse, walidacja Zod — nie ufaj ślepo modelowi),
   - wywołaj `findBookCandidates(args.title, args.author ?? query.rawAuthor ?? null, args.isbn ?? null)`,
   - sformatuj wynik jako zwarty JSON (tylko pola potrzebne modelowi: title, authors,
     isbn10, isbn13, publisher, publishedYear, matchScore — **nie** cały `ScoredCandidate`
     z `coverUrl`/`description`, żeby nie marnować tokenów),
   - dołóż jako `{role: 'tool', tool_call_id, content: <JSON>}`,
   - wyślij kolejne zapytanie z pełną historią wiadomości.
3. Limit iteracji: **`MAX_TOOL_ROUNDS = 3`** (analogicznie do `MAX_WEB_SEARCH_USES = 3` w
   ścieżce Anthropic, linia 13) — po przekroczeniu, wymuś finalną odpowiedź bez `tools`
   (albo zwróć `parse_failure`, jeśli model nie odda czystego JSON).
4. Parsowanie finalnej odpowiedzi: bez zmian — `extractLastJsonCandidate` +
   `AiResolutionResultSchema.safeParse` (już provider-agnostyczne, nie ruszać).
5. **Backward-compat / graceful degradation**: nie każdy self-hosted OpenAI-compatible
   serwer wspiera `tools` (starsze `llama.cpp` serwery potrafią zwrócić 400 na nieznane
   pole). Owiń pierwsze wywołanie w try/catch: przy HTTP 400 zawierającym wzmiankę o
   `tools`/`function` (albo po prostu przy dowolnym 400 na pierwszej próbie), **retry bez
   `tools`** — spadek do dzisiejszego zachowania (`resolveViaOpenAICompat` bez zmian), nie
   twardy błąd. To gwarantuje zero regresji dla providerów bez function-calling.

### Zmiana promptu — `src/lib/resolution/prompt.ts`

Nowy wariant `AI_RESOLUTION_OPENAI_COMPAT_TOOLS_SYSTEM_PROMPT` — jak istniejący
`AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT` (linia 46), ale:
- zamiast "Nie masz dostępu do internetu" → instrukcja użycia `search_book` (styl 1:1 z
  `AI_RESOLUTION_SYSTEM_PROMPT` dla Anthropic, linia 17: "Użyj narzędzia... spróbuj innej
  odmiany tytułu, samego autora, czy tytuł+wydawnictwo"),
  - te same zasady anty-halucynacyjne ("NIE zgaduj", `confidence` = realna pewność),
- **ten sam kształt JSON wyjściowego** (`AiResolutionResultSchema` się nie zmienia).

### Audyt i koszty

- `resolution_calls.search_count` — dziś liczy wywołania `web_search` Anthropic
  (`response.usage.server_tool_use?.web_search_requests`, linia 226); dla nowej ścieżki
  ustaw na liczbę faktycznie wykonanych rund `search_book` (licznik w pętli).
- `costUsd` zostaje `0` dla tej ścieżki — **niezmienione** ("system nie płaci za klucz
  usera", zgodnie z komentarzem w kodzie, linia 106) — wywołania `findBookCandidates` są
  darmowe (Google Books/OL/BN, już cache'owane w `apiCache.ts`), płatny jest wyłącznie
  klucz LLM usera.
- Zero zmian w `src/lib/resolution/budgetPolicy.ts` ani w `resolve.ts` poza tym, że
  `resolveBookViaAI` (linia 195) po prostu deleguje do nowej implementacji zamiast starej
  dla `provider !== 'anthropic'`.

### Pliki do zmiany

1. `src/lib/resolution/client.ts` — nowa stała `SEARCH_BOOK_TOOL`, nowa/rozszerzona
   `resolveViaOpenAICompat` z pętlą tool-calling + fallback bez `tools`, import
   `findBookCandidates` z `../matching/findCandidates`.
2. `src/lib/resolution/prompt.ts` — nowy `AI_RESOLUTION_OPENAI_COMPAT_TOOLS_SYSTEM_PROMPT`.
3. Testy: nowy plik lub rozszerzenie istniejących testów `resolution/client` (jeśli
   istnieją — zweryfikować `tests/unit/lib/resolution/` przed implementacją) — mock
   `fetch` zwracający najpierw `tool_calls`, potem finalny JSON; mock `findBookCandidates`
   (jest czystą funkcją — łatwy do zamockowania).

### Ryzyko

- Nie wszystkie modele lokalne (LM Studio itd.) równie dobrze obsługują wieloturnowy
  tool-calling z historią `tool` messages — może wymagać dostrojenia promptu per model.
  Mitigacja: limit rund + twardy fallback do parsowania bez tools przy błędzie.
- Dodatkowa latencja (2-4 rundy zamiast 1 zapytania) — akceptowalne, bo to i tak "ostatni
  poziom kaskady" (rzadko wołany, tylko gdy GB/OL/BN nic nie znalazły).
- `findBookCandidates` woła zewnętrzne API (GB/OL/BN) — przy 3 rundach × zapytanie to do
  9 dodatkowych wywołań zewnętrznych na jedną AI-resolution. Zaakceptowalne przy istniejącym
  budżecie (max 3 wywołania resolution/zdjęcie, 20/dzień), ale warto to mieć na uwadze przy
  ewentualnym tuningu limitów.

### Kroki realizacji

1. Dodać `SEARCH_BOOK_TOOL` i nowy prompt.
2. Zaimplementować pętlę tool-calling w `client.ts` z fallbackiem bez `tools`.
3. Testy jednostkowe (mock fetch + mock `findBookCandidates`) pokrywające: happy path
   (1 runda), multi-round (2-3 rundy), przekroczenie limitu rund, fallback przy 400 na
   `tools`, brak regresji dla istniejącego zachowania bez tool-calling.
4. Manualny smoke test na żywym modelu przez cf-llm-relay (np.
   `rav_lmstudio::qwen/qwen3.5-9b` albo lokalny model z tool-calling) na przykładzie
   książki nieznajdywanej przez GB/OL/BN.
5. `npm run lint`, typecheck, `vitest run`, `npm run build`.

---

## Propozycja 2: wykorzystanie tabeli `corrections` jako sygnału uczącego

**Problem:** `corrections` jest dziś czystym audytem — zapisywana przy każdej korekcie
(`manual_entry`, `refine`, `parse_failure`, `ai_resolution_not_found`,
`accept`/`field_edit`), ale nigdzie nieodczytywana poza panelem historii dla usera
(`CorrectionHistoryPanel.tsx`, `GET /api/detections/[id]/history`).

**Szkic zakresu (wymaga doprecyzowania przed planem implementacyjnym):**
- Few-shot injection: przed wywołaniem vision/resolution pobrać N ostatnich korekt danego
  usera/typu i wstrzyknąć jako przykłady do promptu (np. "wcześniej OCR odczytał X, poprawny
  tytuł to Y") — celuje w systematyczne błędy (transliteracja, powtarzalne literówki
  konkretnego fontu/oświetlenia).
- Wymaga: (a) decyzji o granularności (per-user? globalnie? per typ błędu?), (b) limitu
  długości promptu, (c) polityki prywatności (czy przykłady innych userów mogą trafiać do
  promptu innego usera — prawdopodobnie **nie**, więc per-user only).
- Nie koliduje z Propozycją 1 — różne warstwy (prompt vision/resolution vs. narzędzie
  wyszukiwania).

**Otwarte pytanie:** czy to ma być prosty few-shot, czy coś bardziej strukturalnego (np.
tabela "known OCR error patterns" budowana z agregacji `corrections`)? Rekomendacja: zacząć
od prostego few-shot per-user, zmierzyć wpływ, dopiero potem rozbudowywać.

---

## Propozycja 3: dopasowanie semantyczne (embeddingi) jako dodatkowy fallback

**Problem:** `score.ts` to czysty string similarity (Levenshtein) — silnie zaszumiony OCR
może nie przekroczyć `SEARCH_MIN_SCORE`/`MATCH_MID` mimo że semantycznie to ta sama książka
(np. transliteracja, skrót, tłumaczenie tytułu).

**Szkic zakresu:**
- Model embeddingowy już zarejestrowany przez cf-llm-relay
  (`text-embedding-nomic-embed-text-v2-moe`, widoczny w `/v1/models` jako
  `mId-lmstudio::text-embedding-nomic-embed-text-v2-moe`) — dostępny bez dodatkowych
  kosztów/kluczy.
- Dodatkowa warstwa w `findBookCandidates`: gdy najlepszy wynik string-similarity < progu,
  policz embedding `rawTitle` i embeddingi tytułów kandydatów (z GB/OL/BN, które i tak już
  mamy z odpowiedzi), porównaj cosine similarity jako **dodatkowy sygnał do rankingu**, nie
  zastąpienie istniejącego scoringu.
- Do rozstrzygnięcia: czy woła się cf-llm-relay (zależność od dostępności lokalnej maszyny —
  ryzyko dla produkcyjnego flow) czy embedding lokalny/edge (Cloudflare Workers AI ma modele
  embeddingowe bez zależności od czyjegoś prywatnego komputera) — **dla stabilności produkcji
  raczej Workers AI, nie cf-llm-relay**, mimo że to ten projekt zainicjował pomysł.

**Otwarte pytanie:** czy warto premature-optimize tym, zanim zmierzymy jak często word-level
OCR fallback (już istniejący) faktycznie zawodzi w praktyce — rekomendacja: najpierw
zebrać dane (np. z `corrections` — ile `parse_failure`/`ai_resolution_not_found` miało w
rzeczywistości poprawny kandydat blisko progu w GB/OL, tylko odrzucony przez scoring).

---

## Propozycja 4: LLM jako arbiter kandydatów zamiast czystego scoringu

**Problem:** gdy kilku kandydatów z GB/OL/BN ma bliskie wyniki `matchScore`, dziś wygrywa
czysto najwyższy score — brak miejsca na kontekstowy osąd (np. wydanie z odpowiedniego
roku, właściwa edycja językowa).

**Szkic zakresu:**
- Nowy, tani krok **po** `findBookCandidates`, **przed** insertem do `book_candidates`:
  gdy top 2-3 kandydatów mają zbliżony `matchScore` (próg różnicy do ustalenia, np. < 0.05),
  wyślij ich do LLM (bez `web_search`/`search_book` — kandydaci już pobrani, to czysty
  wybór) z pytaniem "który z tych pasuje do zaszumionego OCR i dlaczego", parsuj krótką
  odpowiedź (index + uzasadnienie).
- Tańsze niż AI-resolution (brak wielu rund wyszukiwania), ale dodaje 1 wywołanie LLM do
  ścieżki, która dziś jest w 100% deterministyczna/darmowa — wymaga decyzji, czy to
  uzasadnia koszt/latencję dla przypadku "kilku bliskich kandydatów" (prawdopodobnie rzadki
  w praktyce — do zmierzenia).

**Otwarte pytanie:** czy to się w ogóle często zdarza (kilku kandydatów blisko siebie) —
rekomendacja: zmierzyć na istniejących danych `book_candidates` przed implementacją.

---

## Propozycja 5: skanowanie kodu kreskowego ISBN jako pre-pass

**Problem:** jeśli na zdjęciu widoczny jest kod kreskowy (tył okładki, czasem grzbiet), dziś
w ogóle nie jest wykorzystywany — cały pipeline idzie przez OCR tekstu + fuzzy matching.

**Szkic zakresu:**
- Deterministyczny pre-pass przed/równolegle do vision OCR: biblioteka dekodowania
  kodów kreskowych (EAN-13 dla ISBN) na fragmencie zdjęcia, jeśli wykryty — od razu
  `findBookCandidates(..., rawIsbn, {isbnOnly: true})` z pominięciem fuzzy matchingu.
- Wymaga zdecydowania: czy to wchodzi w `process.ts` (batch, cała półka) czy tylko w
  ręcznym flow (`refine`/`rematch`, pojedyncze zdjęcie) — biblioteki dekodujące kody
  kreskowe z surowego zdjęcia (nie idealnie sprostowanego) mają zmienną skuteczność, warto
  zacząć od ręcznego flow gdzie user może dostarczyć wyraźniejsze zdjęcie tyłu okładki.

**Otwarte pytanie:** czy zdjęcia w tym projekcie w ogóle typowo pokazują tył okładki
(kod kreskowy), czy tylko grzbiety na półce (gdzie kodu nie widać) — jeśli to drugie,
ta propozycja ma niski ROI i powinna spaść w priorytecie.

---

## Propozycja 6: trwała historia prób OCR/matchingu + rekoncyliacja między przebiegami

### Uzasadnienie (zgłoszone przez właściciela repo, 2026-07-15)

Obserwacja z realnego użycia: to samo zdjęcie półki przetworzone dwa razy potrafi dać różne
rezultaty — za pierwszym razem vision poprawnie rozpozna np. 3 z 7 książek, za drugim razem
inny podzbiór, czasem lepszy na jednych pozycjach, gorszy na innych. Dziś **nic nie łączy
tych przebiegów** — user musi ręcznie porównywać i wybierać, a materiał z gorszego (ale nie
bezwartościowego) przebiegu ginie z perspektywy produktu (zob. nowa podsekcja w § Kontekst:
`vision_runs` technicznie przeżywają, ale `GET /api/photos/[id]` czyta tylko najnowszy udany
run; `refine`/`rematch` wprost nadpisują `detections` i hard-deletują `book_candidates`).

To nie jest to samo co Propozycja 2 (few-shot z `corrections`) — `corrections` przechowuje
wyłącznie **finalny diff** tytułu/autora, nigdy pełną listę kandydatów, użyty prompt ani
surową odpowiedź modelu. Propozycja 6 jest szersza: pełny, strukturalny log każdej próby,
który może zasilać Propozycję 2 jako jeden ze swoich źródeł (few-shot to jeden z możliwych
*konsumentów* tej historii, nie jej zamiennik).

### Szkic zakresu

**a) Nowa tabela `match_attempts` (append-only, nigdy UPDATE/DELETE)**

Jeden wiersz per próba dopasowania — niezależnie czy pochodzi z `process.ts` (vision),
`refine.ts` (crop OCR), `rematch.ts` (ręczny tytuł/autor) czy `resolve.ts`
(AI-resolution). Szkic kolumn:

```
id uuid pk
detection_id uuid references detections(id) on delete cascade
photo_id uuid references photos(id) on delete cascade
attempt_type text  -- 'vision_run' | 'refine' | 'rematch' | 'ai_resolution'
strategy text       -- np. 'anthropic', 'openai_compatible:qwen3.5-9b', 'google_books+open_library'
input_snapshot jsonb  -- {rawTitle, rawAuthor, rawIsbn, bbox, promptVersion, ...} — co poszło NA WEJŚCIU
raw_response jsonb    -- pełna odpowiedź modelu/API PRZED filtrowaniem/progowaniem
candidates_snapshot jsonb  -- cała lista kandydatów z matchScore, nie tylko finalny top-N
accepted boolean    -- czy ta próba "wygrała" (stała się aktualnym stanem detections)
cost_usd numeric, latency_ms int
created_at timestamptz default now()
```

RLS: `user_id = auth.uid()` przez join na `photos`/`detections`, analogicznie do reszty
schematu (§ Model danych w `CLAUDE.md`).

**b) Punkty zapisu — rozszerzyć, nie zastąpić istniejące inserty**

W `process.ts` (po kroku 6.5), `refine.ts` (po `matchOne`), `rematch.ts` (po
`findBookCandidates`), `resolve.ts` (po każdym wywołaniu `resolveBookViaAI`) — dopisać
jeden `INSERT INTO match_attempts` z pełnym snapshotem **przed** dzisiejszą logiką
"replace jeśli `CONSERVATIVE_REPLACE_MARGIN`". `corrections` zostaje bez zmian (audyt
title/author diff nadal ma sens jako szybki, tani do odczytania log) — `match_attempts`
to warstwa niżej, bogatsza, nie zamiennik.

**c) Rekoncyliacja między przebiegami — realna zmiana zachowania, nie tylko log**

To jest właściwa odpowiedź na obserwację "3/7 za pierwszym razem, inny zestaw za drugim":

- Zamiast dzisiejszego `shouldReplace` (binarny wybór: nowy top-score wygrywa margines czy
  nie → stary wynik ginie), przy kolejnej próbie dla tej samej detekcji/pozycji zbuduj
  **połączoną pulę kandydatów** ze wszystkich `match_attempts` tej detekcji + nowej próby,
  odrzuć duplikaty (już istnieje `dedupeCandidates`/`checkCatalogDuplicate`), przelicz ranking
  na połączonym zbiorze. Nic z poprzednich prób nie ginie — najwyżej spada w rankingu.
- Dla **pełnego przetwarzania zdjęcia** (`process.ts`) problem jest trudniejszy: każdy
  `vision_run` tworzy nowe `detections` z nowym `position_index`, nie ma dziś identity
  między "detekcja na pozycji 3 w runie A" a "detekcja na pozycji 3 w runie B" — te same
  fizyczne książki mogą wylądować na innych pozycjach, jeśli model inaczej policzy grzbiety.
  Dopasowanie między runami wymaga heurystyki (bbox overlap + string similarity tytułu, coś
  w rodzaju istniejącego `dedupeCandidates`, ale między detekcjami a nie kandydatami) — to
  jest największe ryzyko tej propozycji i wymaga osobnego zaprojektowania przed planem
  implementacyjnym.
- UI: strona zdjęcia mogłaby pokazać "znaleziono w 2/3 przebiegach" jako sygnał pewności,
  albo prosty widok "poprzednie próby" z możliwością przywrócenia starszego wyniku (dziś
  fizycznie niemożliwe — dane nadpisane).

**d) Wielomodelowe/embeddingowe "współzawodnictwo" (rozszerzenie zgłoszone razem z powyższym)**

User zasugerował też: pozwolić kilku strategiom (różne modele LLM, dopasowanie
embeddingowe z Propozycji 3) próbować równolegle i porównać wyniki, zamiast trzymać się
jednej ścieżki. To naturalnie komponuje się z `match_attempts` — każda strategia to kolejny
wiersz z innym `strategy`, a rekoncyliacja z (c) automatycznie bierze pod uwagę wszystkie.
**Nie jest to jednak tanie**: wielokrotne wywołania LLM/embeddingów per detekcja mnożą koszt
i latencję wprost proporcjonalnie do liczby strategii — wymaga jawnej zgody usera (opt-in,
nie default) i uszanowania istniejących budżetów (`budgetPolicy.ts`,
`daily_vision_budget_usd` z PRD §13). Traktować jako **osobną, późniejszą fazę** nad
podstawą z (a)-(c), nie jako część pierwszego wdrożenia.

### Koszt i retencja — nowe ryzyko, którego nie ma w Propozycjach 1-5

`raw_response`/`candidates_snapshot` jako `jsonb` dla **każdej** próby (a przy 1000
książkach w kolekcji i wielokrotnych przebiegach na zdjęcie to może być tysiące wierszy)
rośnie szybciej niż reszta schematu — to pierwsza propozycja w tym dokumencie, która
dodaje realny koszt storage, nie tylko compute. Do rozstrzygnięcia przed planem:
- Czy `raw_response` przechowuje pełną odpowiedź API, czy tylko to, co faktycznie
  potrzebne do rekoncyliacji (candidates + confidence) — pełna odpowiedź jest cenniejsza
  do debugowania, ale droższa i być może niepotrzebna.
- Polityka retencji — czy `match_attempts` rośnie bez końca, czy jest jakiś TTL/limit per
  detekcja (np. zachowaj tylko N ostatnich prób + zawsze tę zaakceptowaną).
- To PII-adjacent w sensie kosztu, nie prywatności (dane to tylko tytuły/autorzy książek,
  nie dane osobowe) — RLS wystarcza, nie trzeba dodatkowej polityki prywatności jak w
  Propozycji 2.

### Otwarte pytanie

Zakres (a)+(b) (czysty log, append-only, bez zmiany zachowania) jest tani i bezpieczny —
można go wdrożyć samodzielnie i już daje właścicielowi repo możliwość ręcznego zbadania w
SQL, jak często i dlaczego przebiegi się różnią, **zanim** zainwestuje się w (c) (realna
rekoncyliacja, wymaga heurystyki dopasowania detekcji między runami — ryzykowna część) i (d)
(wielomodelowe współzawodnictwo, mnoży koszt). Rekomendacja: (a)+(b) jako pierwszy, wąski
plan; (c) dopiero po zebraniu danych z (a)+(b) pokazujących, że problem jest częsty i wart
tej złożoności; (d) jako opt-in feature już po (c).

---

## Propozycja 7: konfigurowalne per-profil limity budżetu AI-resolution

### Uzasadnienie (zgłoszone przez właściciela repo, 2026-07-16)

Dziś `AI_RESOLUTION_BUDGET_LIMITS` (`src/lib/resolution/budgetPolicy.ts:4-8`) to trzy
stałe **globalne, zaszyte w kodzie**, identyczne dla każdego użytkownika:

```ts
export const AI_RESOLUTION_BUDGET_LIMITS = {
  maxCallsPerPhoto: 3,
  maxCallsPerUserAction: 1,
  maxCallsPerDay: 20,
} as const;
```

Zweryfikowane bezpośrednio w kodzie: `isAiResolutionBudgetAvailable`
(linie 15-20) sprawdza wyłącznie `callsForPhoto`/`callsForDay` — **`maxCallsPerUserAction`
nie jest dziś nigdzie faktycznie egzekwowany** (jedyne wystąpienie tego identyfikatora w
`src/` to sama definicja stałej, `budgetPolicy.ts:6`; zob. też dead-code precedens w
komentarzu tego samego pliku o `matching/fallbackPolicy.ts::REFINE_BUDGET_LIMITS`). Pomysł:
przenieść te trzy liczby z stałej modułowej na kolumny w `profiles`, z domyślnymi
wartościami identycznymi jak dziś (3/1/20), ale edytowalne przez samego użytkownika ze
strony konta — analogicznie do istniejącego self-service pattern `PATCH
/api/account/profile` (`src/pages/api/account/profile.ts`, dziś edytuje tylko
`display_name`) i w odróżnieniu od `ai_enabled`, które jest **admin-only**
(`src/pages/api/admin/users/[id]/ai-enabled.ts`) — ten limit ma być pod kontrolą właściciela
konta, nie admina.

### Szkic zakresu

**a) Migracja — nowe kolumny w `profiles`** (kolejny numer po `0031_book_candidates_manual_source.sql`
→ `0032_...sql`), wzorem `0014_profiles_admin_ai.sql` (`alter table ... add column if not
exists ... default ...`):

```sql
alter table public.profiles
  add column if not exists ai_resolution_max_calls_per_photo int not null default 3,
  add column if not exists ai_resolution_max_calls_per_user_action int not null default 1,
  add column if not exists ai_resolution_max_calls_per_day int not null default 20;
```

Bez zmian RLS — update własnego profilu już jest pokryty istniejącą policy
`profiles_update_own` (ten sam mechanizm co `display_name` dziś).

**b) `budgetPolicy.ts`** — `AI_RESOLUTION_BUDGET_LIMITS` zostaje jako **fallback/default**
(wartość startowa nowych kolumn + wartość dla wierszy sprzed migracji dzięki `default`), ale
`isAiResolutionBudgetAvailable` przyjmuje limity jako parametr zamiast czytać stałą
modułową:

```ts
export function isAiResolutionBudgetAvailable(
  state: AiResolutionBudgetState,
  limits: AiResolutionBudgetLimits = AI_RESOLUTION_BUDGET_LIMITS,
): boolean { ... }
```

**c) `resolve.ts`** — query profilu na linii 49-53 już pobiera `ai_enabled`; rozszerzyć
`select` o trzy nowe kolumny (jeden round-trip, bez dodatkowego zapytania) i przekazać jako
`limits` do `isAiResolutionBudgetAvailable` (linia 132).

**d) Walidacja (Zod)** — nowy schema (rozszerzenie `UpdateProfileSchema` w
`src/lib/account/schema.ts` albo osobny `UpdateResolutionBudgetSchema`, do decyzji przy
planie) z sensownymi granicami górnymi/dolnymi — **do ustalenia** (zob. otwarte pytanie
niżej), np. `maxCallsPerPhoto: z.number().int().min(1).max(20)`. Dolna granica **musi** być
≥ 1 — `0` wyłączałby AI-resolution furtką inną niż `ai_enabled`, co myliłoby dwa niezależne
przełączniki.

**e) UI** — sekcja na `/account` (obok istniejących ustawień profilu/BYOK/kosztów), trzy pola
liczbowe z dzisiejszymi wartościami jako placeholder/default, walidacja inline lustrzana do
Zod.

**f) `maxCallsPerUserAction` — decyzja przed planem**: skoro dziś to martwy parametr, jego
wystawienie jako edytowalnego pola sugerowałoby userowi, że coś realnie ogranicza, podczas
gdy nic tego nie robi. Dwie opcje: (i) przy okazji tej zmiany **faktycznie wpiąć**
egzekwowanie `maxCallsPerUserAction` w `resolve.ts` (wymaga zdefiniowania czym jest "jedna
akcja użytkownika" w kontekście pojedynczego POST — dziś każdy request to i tak jedno
wywołanie, więc limit `1` per akcję wygląda jak z założenia zawsze spełniony niezależnie od
wartości), albo (ii) **nie wystawiać** tego pola w UI/schema na razie, zostawić jako
wewnętrzną stałą do czasu aż ma realną semantykę. Rekomendacja: (ii) — nie dodawać
konfigurowalności do parametru, który nic nie robi.

### Ryzyko

- To BYOK — koszt każdego wywołania ponosi sam użytkownik na własnym kluczu, więc podniesienie
  limitów przez usera nie jest ryzykiem kosztowym dla właściciela aplikacji (w odróżnieniu od
  `daily_vision_budget_usd` z PRD §13, gdzie koszt idzie na wspólny klucz). Realne ryzyko to
  raczej ochrona przed przypadkowym runaway loop (np. automatyzacja/skrypt walący w endpoint) —
  stąd sensowność twardego górnego capu w Zod, nawet jeśli user "płaci za siebie".
- Rozjazd między `ai_enabled` (admin-only, wyłącza AI całkowicie) a nowymi polami
  (self-service, tylko przycina częstotliwość) — warto w UI jasno rozróżnić te dwa
  mechanizmy, żeby user nie mylił "wyłączone przez admina" z "wyczerpany własny limit".

### Otwarte pytanie

- Sensowne górne/dolne granice per pole w Zod (dziś tylko szkic: `maxCallsPerPhoto` 1-20?,
  `maxCallsPerDay` 1-200?) — do ustalenia przy planie, prawdopodobnie arbitralne na start,
  do skorygowania po obserwacji realnego użycia.
- `maxCallsPerUserAction` — wpiąć realnie (opcja f-i) czy zostawić poza zakresem UI (opcja
  f-ii, rekomendowane)?
- Czy te trzy pola idą razem z resztą `UpdateProfileSchema`/`PATCH /api/account/profile`, czy
  jako osobny endpoint `/api/account/resolution-budget` (czystszy separation of concerns,
  ale kolejny plik do utrzymania) — do decyzji przy planie.

---

## Priorytetyzacja i rekomendacja kolejności

1. **Propozycja 1** (`search_book` tool) — gotowa do wdrożenia, jasny zakres, zero ryzyka
   prawnego, bezpośrednio domyka udokumentowaną lukę w kodzie, korzysta z istniejącej,
   przetestowanej infrastruktury (`findBookCandidates`). Bez zależności od Propozycji 6 —
   można wdrożyć równolegle lub przed nią.
2. **Propozycja 6a+b** (append-only log prób OCR/matchingu, bez zmiany zachowania) — drugi
   w kolejności: tani względem wartości (czysty INSERT obok istniejących ścieżek, zero
   zmian w dzisiejszej logice replace/threshold), a jednocześnie **odblokowuje pomiar** dla
   Propozycji 3 i 4 (dziś rekomendowane tam "zmierz najpierw" nie miało z czego mierzyć —
   po 6a+b będzie). Zastępuje/rozszerza dotychczasowe miejsce Propozycji 2 w kolejności: 2
   staje się jednym z konsumentów danych z 6, nie osobnym wdrożeniem od zera.
3. **Propozycja 6c** (rekoncyliacja między przebiegami) — dopiero po zebraniu danych z 6a+b
   pokazujących, że rozbieżność między przebiegami jest częsta i warta złożoności heurystyki
   dopasowania detekcji między runami (największe ryzyko architektoniczne w tym dokumencie).
4. Propozycje 3-5 oraz **Propozycja 6d** (wielomodelowe współzawodnictwo) — wymagają
   najpierw zebrania danych/pomiaru (jak często realnie zawodzi string-matching, jak często
   kandydaci są blisko siebie, jak często zdjęcia mają widoczne kody kreskowe, jak często
   przebiegi się różnią) zanim uzasadnią koszt implementacji **i** koszt runtime (6d mnoży
   wywołania LLM per detekcja). Rekomendacja: nie rozpoczynać bez wcześniejszej analizy
   danych produkcyjnych — teraz dostępnej dzięki 6a+b.
5. **Propozycja 7** (per-profil limity budżetu AI-resolution) — niezależna od reszty
   (zmiana w `profiles`/`budgetPolicy.ts`/`resolve.ts`, zero powiązania z Propozycjami 1-6),
   mała i tania (jedna migracja + parametryzacja istniejącej funkcji + rozszerzenie
   istniejącego self-service endpointu). Może wejść w dowolnym momencie, niezależnie od
   kolejności powyżej — jedyna zależność to decyzja co zrobić z martwym
   `maxCallsPerUserAction` (zob. otwarte pytania Propozycji 7).

## Otwarte pytania (do właściciela repo)

- Propozycja 1: czy `MAX_TOOL_ROUNDS = 3` (analogicznie do Anthropic) to sensowny limit, czy
  lokalne modele przez cf-llm-relay powinny mieć inny (np. niższy, ze względu na latencję
  lokalnych maszyn)?
- Propozycja 2: per-user czy per-typ-błędu granularność few-shot? (Może zostać odpowiedziane
  danymi z Propozycji 6, nie tylko decyzją a priori.)
- Propozycja 3: embedding przez Workers AI czy przez cf-llm-relay (zależność od dostępności
  prywatnej maszyny)?
- Propozycje 4-5: czy istnieją już dane/metryki pozwalające ocenić częstość scenariuszy,
  które miałyby adresować, zanim zapadnie decyzja o priorytecie?
- **Propozycja 6a+b**: pełna odpowiedź modelu w `raw_response`, czy okrojona do pól
  potrzebnych do rekoncyliacji (koszt storage vs. wartość diagnostyczna)? Czy potrzebna
  polityka retencji/TTL, czy `match_attempts` rośnie bez ograniczeń na start (zmierz, potem
  zdecyduj)?
- **Propozycja 6c**: czy dopasowywanie detekcji między różnymi `vision_run` tej samej
  fotografii (żeby wiedzieć, że "pozycja 3 w runie A" i "pozycja 5 w runie B" to ta sama
  fizyczna książka) ma być automatyczne (heurystyka bbox+tytuł) czy user-assisted (user
  wskazuje, że to duplikat) na start — automatyczna wersja jest wygodniejsza, ale to
  dokładnie ten sam rodzaj problemu co dedup już rozwiązywany w `dedupe.ts` dla kandydatów,
  tylko między detekcjami; warto zweryfikować, czy istniejącą logikę da się ponownie użyć.
- **Propozycja 6d**: czy to w ogóle wchodzi w zakres MVP/certyfikacji, czy to
  post-19.06 "co po MVP" (zob. `docs/plan-implementacji.md` — routing przez lokalny LLM
  proxy jest tam już wymieniony jako pomysł na przyszłość, więc 6d byłoby jego naturalnym
  rozwinięciem, ale nie było wcześniej priorytetem)?
