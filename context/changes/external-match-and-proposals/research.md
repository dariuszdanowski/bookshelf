---
date: 2026-05-27T23:37:56Z
researcher: Dariusz Danowski
git_commit: ef7645e955b3fba39cc20c7b1298572c08d1906b
branch: main
repository: bookshelf
topic: "S-04 external-match-and-proposals — matching do Google Books/OpenLibrary + bounding boxy + server-side image processing"
tags: [research, codebase, matching, google-books, openlibrary, cloudflare-images, bounding-boxes, vision]
status: complete
last_updated: 2026-05-28
last_updated_by: Dariusz Danowski
---

# Research: S-04 external-match-and-proposals

**Date**: 2026-05-27T23:37:56Z
**Researcher**: Dariusz Danowski
**Git Commit**: ef7645e955b3fba39cc20c7b1298572c08d1906b
**Branch**: main
**Repository**: bookshelf

## Research Question

Jak zaimplementować S-04: matching detekcji do publicznych baz książek (Google Books + OpenLibrary), scoring, deduplikację i propozycje z flagami duplikatów (FR-015–018) — **plus rozszerzony zakres** (decyzja 2026-05-28): bounding boxy znormalizowane w detekcjach, upload oryginału + cała obróbka obrazu po stronie serwera, model danych regionu pod przyszłą re-analizę fragmentów.

## Summary

**Trzy filary, wszystkie wykonalne na obecnym stacku:**

1. **Matching** — Google Books jako primary (dobre pokrycie polskich tytułów, znosi diakrytyki i OCR-garbled), OpenLibrary jako fallback **tylko do ISBN-lookup/enrichment** (zero wyników dla polskich tytułów w live-teście). `book_candidates` + `books` + RLS już istnieją w prod — zero nowej pracy schematowej dla samego matchingu. `src/lib/books/` i `src/lib/matching/` to puste stuby.

2. **Image processing server-side** — **Cloudflare Images `cf.image` przez `fetch()` (plan FREE, do 5000 transformacji/mc)** rozwiązuje OBA potrzeby jednym mechanizmem: `width:1568` → kopia robocza dla vision; `trim:{top,left,width,height}` + upscale + `sharpen`/`contrast` → crop pojedynczego grzbietu pod re-analizę. Supabase Storage transforms = **ślepa uliczka** (Pro plan + brak arbitrary crop). photon-rs WASM = fallback (brak CLAHE, ryzyko pamięci na dużych JPEG).

3. **Bounding boxy** — Claude **oficjalnie** zwraca koordynaty, ale w przestrzeni **przeskalowanego** obrazu (Sonnet 4.6 widzi ≤1568px). To domyka pętlę: jak serwer derywuje dokładnie 1568px working copy i wyśle JĄ do Claude, koordynaty są **1:1** — żadnego rescalingu. Konwencja per cookbook Anthropic: **znormalizowane 0..1, dwa rogi `[x1,y1,x2,y2]`, origin top-left** — dokładnie to co w memory `s04-detection-spatial-region-model`. Caveat: spatial reasoning Claude jest „limited" — bbox traktować jako optional/niepewny w MVP, `position` (kolejność) zostaje primary signal.

**Scope flag (ważne):** S-04 urósł z „matching only" do matching + bbox-substrate + upload-refactor + server-image-processing. To realnie ~2 slice'y pracy. Rekomendacja fazowania w Open Questions.

**Granica S-04/S-05 (twarda):** S-04 pisze TYLKO `book_candidates` + aktualizuje `detections.status → matched` + wyświetla propozycje. **Accept→`books`/`shelf_entries` należy w całości do S-05.**

## Detailed Findings

### A. Google Books API (primary)

Endpoint: `GET https://www.googleapis.com/books/v1/volumes?q={query}&key={KEY}`

- **Query qualifiers** (case-sensitive, łączone przez `+`): `intitle:`, `inauthor:`, `inpublisher:`, `isbn:`. Przykład: `q=intitle:przeklety+adept+inauthor:pilipiuk&printType=books&maxResults=10`.
- **Params**: `maxResults` (default 10, max 40), `printType=books`, `langRestrict=pl`, `projection=lite` (subset, wystarcza), `country=PL` (cloud IP może wymagać — flag dla server-side z CF datacenter).
- **Response dot-paths**: `items[n].id`, `items[n].volumeInfo.{title,subtitle,authors[],publisher,publishedDate,language}`, `items[n].volumeInfo.industryIdentifiers[]` (filtruj `.type==='ISBN_13'`/`'ISBN_10'`), `items[n].volumeInfo.imageLinks.{thumbnail,smallThumbnail}` (HTTPS, fetchable server-side, **może być absent** → guard `?.`).
- **Rate limit**: domyślnie **1000 zapytań/dzień** per projekt + 100/100s/user. Bez klucza: agresywny per-IP throttle (`403 userRateLimitExceededUnreg`) — niepewny dla prod. Klucz jako `?key=`. **Weryfikuj aktualny limit w Cloud Console przed buildem.** Przy referrer-restriction klucza server-side wymaga `Referer` header → użyj IP/None restriction.
- **`publishedDate`** to freeform string (`"2010"` / `"2010-06"` / `"2010-06-01"`) → `parseInt` na rok.

### B. OpenLibrary API (fallback — wąsko)

Endpoint: `GET https://openlibrary.org/search.json?{params}`

- **Breaking change 2025-01-21**: `fields=` jest teraz **wymagane** (inaczej minimalny payload). Rekomendowany set: `fields=key,title,author_name,first_publish_year,isbn,cover_i,language,publisher`.
- **Params**: `q`, `title`, `author`, `isbn`, `limit=5`, `lang`.
- **Response dot-paths**: `docs[n].{key,title,author_name[],first_publish_year,isbn[],publisher[],cover_i,language[]}`. ⚠ `language` to **trzyliterowe ISO 639-2** (`"pol"`,`"eng"`) — Google używa dwuliterowych (`"pl"`,`"en"`).
- **Covers API**: `https://covers.openlibrary.org/b/id/{cover_i}-M.jpg` (preferuj `cover_i` — bez rate-limitu) vs `b/isbn/{isbn}-M.jpg` (rate-limit 100/IP/5min).
- **Rate limit**: 1 req/s domyślnie, 3 req/s z `User-Agent` (wymagany format: `BookshelfCatalog/1.0 (contact@email)`). Bez klucza.
- **KRYTYCZNE**: live-test zwrócił **0 wyników** dla polskich tytułów (`przeklety adept`, nawet z autorem). ICUFoldingFilter (PR #7445) działa niepewnie dla polskiego. **OpenLibrary NIE jest wiarygodnym źródłem discovery dla polskich książek** — używać tylko do ISBN-lookup + enrichment gdy mamy już ISBN z Google.

### C. ISBN handling

- Walidacja ISBN-10 (mod-11, check digit może być `X`) i ISBN-13 (GS1 mod-10, prefix `978`/`979`). Algorytmy w raporcie agenta — proste pętle wagowe.
- ISBN-10↔13 konwersja (uwaga: `979`-prefix nie ma odpowiednika ISBN-10).
- Normalizacja: `isbn.replace(/[-\s]/g,'')` przed każdą operacją; przechowuj kanoniczny (bez myślników).

### D. Strategia matchingu dla OCR-garbled tytułów

Kaskada:
1. **ISBN** (gdy detekcja zawiera cyfry-jak-ISBN): `q=isbn:...` / `isbn=...` — najpewniejsze.
2. **Structured title+author**: Google `q=intitle:..+inauthor:..`; OL `q={title} {author}`.
3. **Title-only free-text fallback**.
4. **Token query dla garbage** (`PRZECIRZTA ADEPT`): split na tokeny, weź 2–3 najdłuższe, Google `q={tokens}` — **free-text `q=` bije `intitle:`** dla zniekształconych stringów (intitle wymaga wszystkich termów w tytule).
- **Diakrytyki**: Google znosi natywnie (OCR bez ogonków i tak matchuje). Wyślij BOTH wersję znormalizowaną ASCII (`NFD` + strip combining marks) i oryginał Unicode, weź więcej wyników.
- Fetch `maxResults=10` z Google, top 10 pokrywa >95% prawdziwych matchy; scoring na wszystkich, top 3 do UI.

### E. Scoring + dedupe (PRD §10/§11)

- **Formuła (PRD §10, dokładne wagi)**: `score = 0.65×titleSim + 0.30×authorSim + 0.05×isbnBonus`. `titleSim = 1 - levenshtein(norm(a),norm(b))/max(len)`; `authorSim` = max similarity nad authors[], brak detection.author → 0.5 neutral; `isbnBonus` = 0.05 gdy kandydat ma ISBN. **Algorytm similarity do wyboru w planie** (Levenshtein/Jaro-Winkler/trigram).
- **Progi (start values, NIE zamrożone — `roadmap.md:150` Open Q1)**: ≥0.75 pre-zaznaczone / 0.55–0.75 wymaga potwierdzenia / <0.55 „wpisz ręcznie". Trzymać jako nazwane stałe, nie magic numbers.
- **Dedupe (PRD §11)**: ISBN-13 exact → `books_user_isbn13` unique index (`0001:96`) to anchor → blokada + komunikat „duplikat z półki X". Bez ISBN → fuzzy `levenshtein(title)<3 AND authors &&` → warning „masz inną edycję" (różny ISBN = różne rekordy, `roadmap.md` Open Q3).
- **Reconciliation** gdy oba źródła zwrócą: grupuj po `isbn_13`, w grupie wyższy `match_score` wygrywa, remis → preferuj Google Books.
- ⚠ **Series-number bonus** (z `bookshelf_idea.md:62`) — **PARKED, NIE implementować w S-04 bez decyzji**.

### F. Server-side image processing — photon-rs WASM (DECYZJA)

> **DECYZJA 2026-05-28**: `cf.image` zablokowane (0 zone'ów — zob. niżej). **Wybrano photon-rs WASM (`@cf-wasm/photon`)** — self-contained, działa na workers.dev teraz, bez zależności od domeny/planu. Sekcja cf.image poniżej zostaje jako udokumentowana alternatywa gdyby kiedyś doszła custom domain.

**photon-rs (`@cf-wasm/photon`, import z `@cf-wasm/photon/workerd`):**
- `resize(img, w, h, SamplingFilter.Lanczos3)` → working copy 1568px (potrzeba a).
- `crop(img, x1, y1, x2, y2)` → arbitrary region grzbietu (potrzeba b, re-analiza). `sharpening` + contrast (`photon_rs::correction`) → enhancement.
- `PhotonImage.new_from_byteslice(bytes)` → ops → `.get_bytes_jpeg(85)` → base64 → Anthropic.
- 1.6MB WASM (mieści się w 10MB compressed bundle). **Limit pamięci Worker 128MB** — 20MP JPEG dekodowany do raw RGBA ~80MB → ryzyko. **Mitygacja: cap rozmiaru uploadu (~15MB / odrzuć >15MB) lub downscale wcześnie.** CPU: decode+resize ~2-5s, w limicie 30s (testować na realnym dużym pliku).
- Brak CLAHE (tylko globalny contrast) — akceptowalne dla MVP (POC CLAHE był nice-to-have).
- Opcjonalnie `@jsquash/jpeg` (MozJPEG enc, mniejszy output przy równej jakości) dla finalnego encode.

**Alternatywa (odłożona) — `fetch()` + `cf.image` (plan FREE).** Jeden mechanizm, oba zastosowania, zero WASM w bundlu — ale wymaga custom domain.

Potrzeba (a) — kopia robocza 1568px:
```ts
const { data: signed } = await supabase.storage.from('shelf-photos').createSignedUrl(originalPath, 120);
const resized = await fetch(signed.signedUrl, {
  cf: { image: { width: 1568, fit: 'scale-down', quality: 85, format: 'jpeg', sharpen: 1 } },
});
const buf = await resized.arrayBuffer(); // → base64 → Anthropic
```

Potrzeba (b) — crop grzbietu pod re-analizę (osobny slice, ale ten sam mechanizm):
```ts
cf: { image: {
  trim: { top: y1px, left: x1px, width: (x2-x1)px, height: (y2-y1)px }, // arbitrary region
  width: (x2-x1)*2.5, fit: 'contain', sharpen: 3, contrast: 1.3, quality: 90, format: 'jpeg',
}}
```
`trim` to klucz — pixel-accurate arbitrary region, aplikowany PRZED resize. `gravity` (focal-point) NIE daje arbitrary crop.

- **Pricing**: transformacje obrazów spoza CF Images storage (czyli z Supabase) — **plan FREE, 5000 unique transform/mc** (unique = ten sam URL+params raz/mc, cache nie obciąża). Powyżej: `9422` error (bez opłaty). Binding `env.IMAGES` wymaga **Images Paid** — więc trzymać się ścieżki `fetch()`+`cf.image`.
- **Setup**: Dashboard → Speed → Optimization → Image Transformations → Enable. Guard przed pętlą: sprawdź `request.headers.get('Via')` na `'image-resizing'`.
- 🔴 **ZWERYFIKOWANE 2026-05-28 (Cloudflare API): konto ma 0 zone'ów, 0 custom domains.** App stoi tylko na `*.workers.dev`. Image Transformations to funkcja poziomu zone → bez własnej domeny `cf: { image: {...} }` jest **po cichu ignorowane** (zwraca oryginał). **Ścieżka cf.image jest ZABLOKOWANA w obecnym setupie.** Odblokowanie wymaga dodania custom domain do Cloudflare + włączenia Transformations. Alternatywa bez domeny: **photon-rs WASM** (`@cf-wasm/photon`) — działa na workers.dev, ma resize+crop+sharpen+contrast, brak CLAHE, 1.6MB WASM, limit pamięci 128MB (cap rozmiaru uploadu).

**Odrzucone:**
- **Supabase Storage transforms**: Pro plan + tylko `cover/contain/fill` resize, **brak arbitrary-region crop** → blokuje potrzebę (b) bez upgrade-path. Nie używać jako primary.
- **photon-rs (`@cf-wasm/photon`)**: ma `crop()`+`resize()`+`sharpen()`, ale 1.6MB WASM, limit pamięci 128MB (ryzyko na 20MP JPEG), **brak CLAHE**. Fallback only.
- **CLAHE**: niedostępne off-the-shelf w żadnej Worker-WASM libce. Tylko globalny contrast (multiplier).

### G. Claude bounding boxes

- **Oficjalne wsparcie** (platform.claude.com/docs/.../vision): Claude zwraca koordynaty, ale „**with respect to the resized/padded image**". Sonnet 4.6 widzi **≤1568px** longest edge (~1568 tokenów); Opus 4.7 ≤2576px. Wysłanie >1568px → auto-resize server-side u Anthropic, koordynaty w przestrzeni 1568px.
- **Domknięcie pętli**: serwer derywuje DOKŁADNIE 1568px working copy (potrzeba a) → wysyła ją → koordynaty Claude są 1:1 z working copy → normalizacja `/1568dims` trywialna → crop z oryginału przez `cf.image trim` (denormalize × original dims). Spójny design, bez rescalingu między Claude-space a working-copy-space.
- **Konwencja (cookbook Anthropic „crop tool", 2025-11-22)**: znormalizowane **0..1**, dwa rogi `{x1,y1,x2,y2}`, origin top-left. Dokładnie memory `s04-detection-spatial-region-model`.
- **Caveat reliability**: docs explicite „**Claude's spatial reasoning abilities are limited**... precise localization". → bbox = **optional, niepewny w MVP**; `position` (kolejność lewo→prawo) zostaje primary ordering signal. Oficjalny wzorzec re-analizy = **tool-use iterative crop** (Claude woła `crop_image` z normalized coords → serwer kropuje+upscale → drugi pass) — „consistent uplift when Claude can zoom in".
- Schemat: dodać opcjonalny `bbox: {x1,y1,x2,y2}` (0..1) do `DetectionItemSchema`.

### H. Codebase integration points

- **F-02** (`src/lib/http/response.ts`): `ApiErrorCode = UNAUTHENTICATED|NOT_FOUND|VALIDATION_ERROR|INTERNAL_ERROR|RATE_LIMITED`. Downstream 429 (Google/OL) → reuse `RATE_LIMITED` LUB dodać `EXTERNAL_API_UNAVAILABLE` (one-line, union to `type`). Helpery `apiResponse({data,status?})` / `apiError({code,status,message,details?})`, default `Cache-Control: private, no-store`. `parseUuidParam` → null → 404.
- **RLS** (`0002_rls_policies.sql`): `book_candidates` MA JUŻ politykę dwuhopową (`detection_id→detections→photos.user_id`, linie 44-78). `books` ma Pattern A (direct user_id). **Zero nowej pracy RLS dla matchingu.** Nowe migracje (bbox cols, `original_path`) wzorować na idempotent `drop ... if exists` (precedens 0004/0005).
- **External-call pattern** (`src/lib/vision/client.ts`): mirror — `env` z `cloudflare:workers` z `?? import.meta.env` fallback; discriminated union `{ok:true,...}|{ok:false,reason}`; pojedyncza `async function`, nie klasa; stałe na górze; framework-agnostic (`infrastructure.md:103` — `src/lib/matching/` BEZ CF imports).
- **DTO/schema** (`src/lib/<domain>/schema.ts`): Zod input → `z.infer` (`CreateXInput`); response DTO → hand-written `type` (`BookCandidateDTO`). Nowe: `src/lib/books/schema.ts`, `src/lib/matching/`.
- **Testy** (`tests/unit/pages/api/photos/*`): `vi.hoisted()`+`vi.mock()` dla klienta; plain-object Supabase mock (fluent `from().select()...`); assert `res.status` + `json.data`/`json.error.code`; UUID v4 (`...-4...-8...`).
- **Middleware**: nowe `/api/*` **auto-protected** (whitelist tylko `/`,`/login`,`/signup`,`/api/health`,`/api/auth/*`). `locals.{user,supabase}` zawsze ustawione; endpointy guardują `if(!locals.user)` defense-in-depth.
- **Trigger point**: `process.ts` kończy na persist detekcji (status `pending`), zwraca `{photo,detections}` (linia 220). **Brak `/api/detections/`.** ⚠ `DetectionDTO` (`photos/schema.ts:22`) **NIE ma pola `id`** — constraint dla UI ładującego propozycje per-detekcja.

## Code References

- `src/lib/http/response.ts:11-66` — F-02 union + helpery + parseUuidParam
- `supabase/migrations/0001_initial_schema.sql:61-97` — `book_candidates` + `books` + unique `books_user_isbn13`
- `supabase/migrations/0002_rls_policies.sql:44-85` — RLS dwuhop `book_candidates`, Pattern A `books`
- `src/lib/vision/client.ts:14-104` — wzorzec external-call (union, env, retry)
- `src/lib/vision/schema.ts:5-15` + `prompt.ts:20-36` — gdzie dokleić bbox + SPINE_COLORS
- `src/lib/photos/schema.ts:10-27` — `PhotoDTO`/`DetectionDTO` (brak `id`!)
- `src/pages/api/photos/[id]/process.ts:36-220` — pipeline do rozszerzenia/po którym matching
- `src/pages/api/photos/[id].ts` — istniejący `GET` zwraca `DetectionDTO[]` (entry point dla UI propozycji)
- `src/components/PhotoUploader.tsx:33-159` — client-side resize do usunięcia (upload oryginału)
- `tests/unit/pages/api/photos/process.test.ts:4-160` — wzorzec testu endpointu

## Architecture Insights

1. **Konwergencja 1568px**: „upload oryginału + derywacja 1568px server-side" (decyzja usera) + „Claude widzi ≤1568px" + „bbox w resized-space" + „cf.image trim z oryginału" składają się w jeden spójny design bez rescalingu. Working copy 1568px jest jednocześnie: (a) inputem vision, (b) przestrzenią koordynatów bbox 1:1, (c) tłem UI highlight. Crop re-analizy bierze z oryginału przez `cf.image trim` skalując normalized × original-dims.
2. **Idempotencja kaskadowa**: `book_candidates` ma `on delete cascade` na `detection_id` (`0001:64`). Re-process zdjęcia (S-03 delete-then-insert detekcji) wywala kandydatów. → matching MUSI być idempotentny per detekcja (delete-then-insert candidates), mirror S-03. User-confirmed state idzie do `books`/`shelf_entries` (`detection_id` tam jest `on delete set null` — przeżywa re-process).
3. **Synchroniczny endpoint OK**: CF 30s = CPU, nie wall-clock; `await fetch` (Google/OL) = ~0 CPU. Ta sama logika co S-03, zero potrzeby Queues.
4. **Dwa rodzaje „confidence"**: `detections.vision_confidence` (pewność OCR) vs `book_candidates.match_score` (pewność matchu) — nie mylić; progi 0.75/0.55 dotyczą match_score.

## Historical Context (from prior changes)

- `context/archive/2026-05-27-shelf-photo-vision-detection/plan.md:31-37` — „NOT doing": matching/kandydaci/dedupe/accept → S-04/S-05; ręczna edycja detekcji → S-05.
- `context/archive/.../research.md:27,62` — CF 30s = CPU nie wall-clock → synchroniczny endpoint (dotyczy też S-04).
- `context/foundation/roadmap.md:143-153` — S-04 Outcome + Open Q1 (progi), Q3 (edycje), Q4 (bez-ISBN); Risk: progi nietestowane na realnych danych, telemetria korekt = jedyny sygnał strojenia.
- `context/foundation/roadmap.md:156-165` — S-05 owns accept→`books`/`shelf_entries`, read-status, shelf view. **Twarda granica: S-04 ≠ catalog write.**
- `context/foundation/infrastructure.md:103` — `src/lib/matching/` framework-agnostic; `:101` — KV cache dla Google Books = post-MVP.
- `context/foundation/tech-stack.md:34` — Zod-walidacja odpowiedzi Google/OL (constraint).
- `deploy-plan.md:66-68` — `GOOGLE_BOOKS_API_KEY` Worker Secret (optional, higher limit) — dodać do `.dev.vars` + Worker Secrets przed prod smoke S-04.
- Memory `s04-detection-spatial-region-model` — bbox 0..1, `photos.original_path`, re-analiza = UPDATE nie delete-insert, źródło LLM→CV swap-ready, koszt $0.0285/11książek mierzony na prod.

## Open Questions

1. **SCOPE/fazowanie (decyzja dla `/10x-plan`)** — S-04 łączy teraz: (i) klienci Google/OL + scoring + dedupe + UI propozycji (oryginalny S-04), (ii) bbox w prompt+schema+migracja, (iii) refactor PhotoUploader na upload oryginału, (iv) server-side `cf.image` + `photos.original_path`. To ~2 slice'y. **Rekomendacja**: albo split na fazy w jednym planie (Faza 1: bbox-substrate + original-upload + cf.image working-copy; Faza 2: Google/OL klienci + scoring + dedupe; Faza 3: UI propozycji), albo wydziel (i) jako rdzeń S-04 i (ii–iv) jako precursor `S-04a image-substrate`. `/10x-plan` rozstrzyga.
2. ✅ **ROZSTRZYGNIĘTE**: 0 zone'ów → cf.image zablokowane. **Decyzja: photon-rs WASM (`@cf-wasm/photon`)** — self-contained na workers.dev. cf.image odłożone (gdyby doszła custom domain). Plan: cap uploadu ~15MB (limit pamięci Worker 128MB), test CPU na dużym pliku.
3. **Algorytm similarity** dla titleSim/authorSim — Levenshtein (PRD §10 explicite) vs Jaro-Winkler vs trigram. PRD mówi Levenshtein — trzymać się, chyba że plan zdecyduje inaczej.
4. **Reuse `RATE_LIMITED` vs nowy `EXTERNAL_API_UNAVAILABLE`** dla downstream Google/OL 429/błąd — drobna decyzja kontraktu API.
5. **Trigger matchingu**: extend `process.ts` (inline po detekcjach) vs nowy `POST /api/photos/[id]/match` (batch per zdjęcie, omija brak `id` w DetectionDTO) vs `POST /api/detections/[id]/match`. Rekomendacja: `POST /api/photos/[id]/match` (matchuje pending detekcje zdjęcia, query po `photo_id`, spójne z nestingiem `/process`).
6. **Progi 0.75/0.55 i polityka bez-ISBN** — start values, strojone z telemetrii korekt po ~1 mc (roadmap Open Q1/Q4). Nie blokuje implementacji, ale stałe nazwane.
7. **bbox reliability** — empiryczny sanity-check na 2-3 realnych zdjęciach (czy boxy lądują na właściwych grzbietach) ZANIM budujemy crop. Tani test, najlepiej na zdjęciu które dało 11 książek (jest ground truth).
