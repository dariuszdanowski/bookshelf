# S-04 external-match-and-proposals — Implementation Plan

## Overview

Po detekcji vision system odpytuje publiczne bazy książek (Google Books primary, OpenLibrary fallback dla ISBN), buduje rankowanych kandydatów z flagami duplikatów względem istniejącego katalogu i pokazuje propozycje na dedykowanej stronie review. Plus substrat danych pod przyszłą re-analizę fragmentów: klient wysyła oryginał, serwer derywuje kopię roboczą 1568px (photon-rs WASM), vision zwraca best-effort bounding boxy.

Granica twarda: **S-04 NIE pisze do `books`/`shelf_entries`** — accept→katalog należy w całości do S-05. S-04 kończy na `book_candidates` + `detections.status='matched'` + wyświetleniu propozycji.

## Current State Analysis

- **Vision pipeline działa na prod** (S-03): `POST /api/photos/[id]/process` pobiera obraz ze Storage, woła Claude Sonnet 4.6, waliduje Zod, idempotentnie (delete-then-insert) zapisuje `detections` (status `pending`), aktualizuje `photos`. Zmierzony koszt $0.0285/11 książek/20s.
- **Tabele matchingu istnieją w prod** (`0001` + RLS `0002`): `book_candidates` (FK `detection_id` ON DELETE CASCADE, `source`, `match_score numeric(4,3)`, `rank`), `books` (unique `books_user_isbn13`), RLS dwuhopowa dla `book_candidates` już skonfigurowana. **Zero pracy schematowej dla samego matchingu.**
- **Puste stuby**: `src/lib/books/` i `src/lib/matching/` zawierają tylko `.gitkeep`.
- **Klient external API — wzorzec**: `src/lib/vision/client.ts` (discriminated union `{ok}`, env z `cloudflare:workers` z `?? import.meta.env`, pojedyncza funkcja nie klasa, framework-agnostic dla `matching/` per `infrastructure.md:103`).
- **PhotoUploader.tsx**: obecnie resize'uje canvasem do 1568px PRZED uploadem; uploaduje skompresowany blob jako `storage_path`.
- **`GET /api/photos/[id]`**: istnieje, zwraca `PhotoDTO` + `DetectionDTO[]`, **dziś nieużywany** przez UI (czeka na S-14 i teraz na review page).
- **`DetectionDTO`** (`photos/schema.ts:22`) **nie ma pola `id`** — endpoint matchingu musi operować po `photo_id`, nie per-detection-id z klienta.
- **F-02** (`http/response.ts`): `ApiErrorCode` = `UNAUTHENTICATED|NOT_FOUND|VALIDATION_ERROR|INTERNAL_ERROR|RATE_LIMITED`.
- **Konto Cloudflare ma 0 zone'ów** → `cf.image` niedostępne → image processing przez photon-rs WASM.

## Desired End State

Użytkownik wgrywa zdjęcie półki → vision wykrywa książki → system automatycznie matchuje każdą detekcję z Google Books/OpenLibrary → użytkownik zostaje przekierowany na stronę review gdzie widzi, per książka: najlepszego kandydata + 2-4 alternatywy, otagowane progiem pewności (≥0.75 zielony / 0.55-0.75 amber / <0.55 „brak pewnego matchu") oraz flagi duplikatów („duplikat z półki X" / „masz inną edycję"). Strona jest read-only (akcje accept/reject/correct przychodzą w S-05) i reload-safe.

Weryfikacja: na prod, po wgraniu realnego zdjęcia, `book_candidates` ma wiersze z `match_score` i `rank`, `detections.status='matched'`, a strona `/photos/[id]` renderuje tierowane propozycje.

### Key Discoveries:

- Tabele `book_candidates`/`books` + RLS już w prod (`0001`/`0002`) — tylko nowa migracja na bbox.
- Claude widzi obraz ≤1568px (`platform.claude.com/.../vision`) → working copy 1568px daje koordynaty bbox 1:1; konwencja Anthropic cookbook = znormalizowane 0..1 `[x1,y1,x2,y2]` top-left (= memory `s04-detection-spatial-region-model`).
- `book_candidates` ma ON DELETE CASCADE na `detection_id` (`0001:64`) → matching MUSI być idempotentny per detekcja (delete-then-insert), mirror S-03; confirmed state (S-05) idzie do `books`/`shelf_entries` które przeżywają.
- CF 30s = limit CPU nie wall-clock; `await fetch` ≈ 0 CPU (research S-03) → synchroniczny `/match` z parallel fetch OK, bez Queues.
- OpenLibrary zwraca 0 wyników dla polskich tytułów (live-test) → Google primary, OL tylko ISBN-enrichment.
- photon-rs `crop()`/`resize()` działają na workerd; decode dużego JPEG = realny CPU + pamięć (limit 128MB) → cap uploadu.

## What We're NOT Doing

- **Accept/reject/correct → katalog** (`books`/`shelf_entries`) — to S-05.
- **Ręczna edycja detekcji / manual entry przy braku matchu** — UI w S-04 pokazuje placeholder „wpisz ręcznie (krok potwierdzania)", sam input to S-05.
- **Pipeline re-analizy fragmentu** (crop+enhance+ponowny vision) — osobny późniejszy slice; S-04 dostarcza tylko substrat (bbox + oryginał w Storage). Nie dodajemy `bbox_source`/`analysis_pass` (YAGNI — dojdą gdy re-analiza będzie projektowana).
- **Persistencja kopii roboczej 1568px** — derywowana in-memory per `/process` (nie zapisywana); `storage_path` trzyma oryginał.
- **KV cache dla Google Books**, **series-number bonus**, **Opus eskalacja**, **per-user cost cap** — wszystkie post-MVP.
- **Custom domain / cf.image** — odłożone (photon-rs wystarcza).
- **Nav entry do review page** — rejestrowany jako follow-up micro-slice w roadmapie (per lessons.md), nie w scope S-04.

## Implementation Approach

Trzy fazy budują substrat → silnik matchingu → prezentację. Faza 1 zmienia kontrakt uploadu (oryginał zamiast resize'a) i dokłada bbox — fundamenty których reszta nie odwróci. Faza 2 to czysty, framework-agnostic silnik matchingu + endpoint orkiestrujący. Faza 3 spina to w read-only review page i łańcuchuje flow.

Klienci external API i moduły matchingu mirrorują wzorzec `vision/client.ts`: pojedyncze funkcje, discriminated-union wyniki, Zod-walidacja odpowiedzi, env dual-read. `src/lib/matching/` zostaje framework-agnostic (czysty TS, zero CF/Supabase importów) — testowalne unitami bez mocków runtime.

## Critical Implementation Details

- **`storage_path` repurpose**: klient wysyła teraz ORYGINAŁ pod `storage_path` (semantyka się zmienia — to już nie kopia 1568px). Kopia robocza 1568px derywowana in-memory w `/process` przez photon, NIE zapisywana. To świadoma adaptacja vs dwukolumnowy szkic w memory `s04-detection-spatial-region-model` (jedno źródło-oryginał, derive-on-demand) — re-analiza fragmentu (przyszły slice) też kropuje z tego oryginału. Bez nowej kolumny `original_path`.
- **photon-rs pamięć/CPU**: decode oryginału do raw RGBA przy 15MB JPEG (~10MP) ≈ 40MB, plus overhead — w limicie Worker 128MB pod warunkiem **cap uploadu ~15MB** (walidacja klient + serwer). Decode+resize ≈ 2-5s realnego CPU (liczy się do 30s, ale vision await ≈ 0 CPU → łączny budżet bezpieczny). Import z `@cf-wasm/photon/workerd`.
- **bbox coordinate space**: prompt instruuje Claude o znormalizowanych 0..1 `[x1,y1,x2,y2]`; ponieważ wysyłamy working copy 1568px (= to co Claude i tak widzi), koordynaty są 1:1, bez rescalingu. Best-effort: `safeParse` opcjonalnego pola, null gdy brak/niepoprawne — NIGDY nie blokuje persistencji detekcji.
- **Idempotencja kandydatów**: `/match` przed insertem usuwa istniejące `book_candidates` dla każdej matchowanej detekcji (delete-then-insert per `detection_id`) — re-match nie duplikuje, mirror S-03.
- **Graceful degrade**: `Promise.allSettled` per detekcja; rejected/empty → detekcja bez kandydatów (status zostaje `pending`), nie błąd requestu. `RATE_LIMITED` (429) zwracane tylko gdy WSZYSTKIE calle padły na rate-limit.

## Phase 1: Image substrate (upload oryginału + photon working-copy + bbox capture)

### Overview

Klient wysyła oryginał, serwer derywuje 1568px przez photon-rs, vision zwraca best-effort bbox persistowane w `detections`.

### Changes Required:

#### 0. WASM bundling spike (GATE — wykonać PRZED resztą Fazy 1)

**File**: tymczasowy minimalny endpoint (np. `src/pages/api/_wasm-spike.ts`, usuwany po weryfikacji) + `@cf-wasm/photon` w `package.json`

**Intent**: Zweryfikować, że `@cf-wasm/photon/workerd` faktycznie bundluje się i działa w runtime pod Astro 6 + @astrojs/cloudflare v13.5.x — ZANIM zbudujemy na nim pipeline. Udokumentowany failure mode (Astro issue #15511): WASM z pakietu npm emitowany do `dist/client/_astro/` niedostępny dla `dist/_worker.js` → runtime crash; status fixa w v13.5.5 niepotwierdzony.

**Contract**: install `@cf-wasm/photon`; minimalny endpoint robi `PhotonImage.new_from_byteslice(...)` → `resize(...)` → `get_bytes_jpeg(...)` → `.free()` na małym obrazie. `astro build` → sprawdź czy `.wasm` ląduje w `_worker.js` (nie tylko `dist/client/_astro/`). `astro dev` (Astro 6 = realny workerd) → hit endpoint → brak crasha, poprawny output. **Gdy spike pada**: workaround przez manual init (`/others` subpath + `initPhoton()` z jawnym importem `.wasm`) lub — jeśli nieosiągalne — eskalacja do usera (fallback: client-side resize dla working-copy + odroczenie server-crop, albo custom domain + cf.image). Endpoint spike usunąć po zielonej weryfikacji.

#### 1. Migracja bbox

**File**: `supabase/migrations/0006_detection_bbox.sql`

**Intent**: Dodać znormalizowane koordynaty bbox do `detections` pod highlight UI i przyszłą re-analizę. Idempotentna (precedens 0004/0005).

**Contract**: `alter table detections add column if not exists` dla `bbox_x1, bbox_y1, bbox_x2, bbox_y2 numeric(5,4)` (nullable, zakres 0..1). Brak `bbox_source`/`analysis_pass` (YAGNI). RLS bez zmian (dziedziczona z `detections`).

#### 2. photon-rs working-copy module

**File**: `src/lib/images/resize.ts` (nowy) + `@cf-wasm/photon` w `package.json`

**Intent**: Server-side derywacja kopii roboczej 1568px z oryginału. Izolowany moduł (jedyne miejsce importu photon).

**Contract**: `async function deriveWorkingCopy(input: ArrayBuffer): Promise<{ bytes: Uint8Array; mediaType: 'image/jpeg' }>` — `PhotonImage.new_from_byteslice` → `resize(..., SamplingFilter.Lanczos3)` do longest-edge 1568 → `get_bytes_jpeg(85)`; `.free()` na obu PhotonImage. Import z `@cf-wasm/photon/workerd`.

#### 3. Vision prompt + schema — bbox

**File**: `src/lib/vision/prompt.ts`, `src/lib/vision/schema.ts`

**Intent**: Poprosić Claude o znormalizowany bbox per książka; dodać opcjonalne pole do schematu (best-effort).

**Contract**: Prompt dokłada pole `bbox: [x1,y1,x2,y2]` floats 0..1 (top-left origin, względem całego obrazu) z instrukcją „pomiń jeśli niepewny". `DetectionItemSchema` dostaje `bbox: z.tuple([...]).nullable().optional()` lub obiekt — null gdy brak. Format JSON w przykładzie promptu zaktualizowany.

#### 4. process.ts — derive + persist bbox

**File**: `src/pages/api/photos/[id]/process.ts`

**Intent**: Pobrać oryginał, zderywować working-copy przez photon, wysłać ją do vision, zapisać bbox w detekcjach.

**Contract**: Krok download (obecnie `storage.download(storage_path)` → blob) przepuszcza bytes przez `deriveWorkingCopy` przed `toBase64`. **`mediaType` hardcode `'image/jpeg'`** (photon `get_bytes_jpeg` zawsze zwraca JPEG niezależnie od formatu oryginału) — NIE używać `detectMediaType(storage_path)` dla working-copy path (oryginał może być .png/.webp → mismatch media_type → błąd Anthropic). Insert detekcji mapuje `d.bbox` → `bbox_x1..y2` (null gdy brak). Reszta pipeline'u bez zmian.

#### 5. PhotoUploader — upload oryginału

**File**: `src/components/PhotoUploader.tsx`

**Intent**: Usunąć client-side resize; wysyłać oryginał; wymusić cap rozmiaru.

**Contract**: Usuń `resizeToBlob`/canvas; upload oryginalnego `File` do Storage (`contentType` z `file.type`). Walidacja `file.size <= 15MB` z błędem UI gdy przekroczony. `storage_path` ext z realnego typu pliku. `detectMediaType` w process.ts już obsługuje jpeg/png/webp.

#### 6. DTO update

**File**: `src/lib/photos/schema.ts`

**Intent**: `DetectionDTO` niesie bbox dla przyszłego highlightu.

**Contract**: Dodać `bbox: { x1,y1,x2,y2 } | null` do `DetectionDTO`; mapowanie w `GET /api/photos/[id]` i w odpowiedzi `/process`.

### Success Criteria:

#### Automated Verification:

- WASM spike GATE: po `astro build` `.wasm` jest w `_worker.js`; `astro dev` (workerd) resize endpoint zwraca poprawny output bez crasha
- Migracja aplikuje się czysto lokalnie (dry parse / `supabase db diff` bez błędu)
- Unit: `deriveWorkingCopy` resize'uje do ≤1568px longest edge (mock photon lub mały realny obraz)
- Unit: `DetectionItemSchema` parsuje detekcję z bbox i bez bbox (null)
- Unit: `process.ts` persistuje bbox gdy obecny, null gdy brak (rozszerzony `process.test.ts`)
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Build: `npm run build`

#### Manual Verification:

- Upload realnego zdjęcia na dev → working copy idzie do vision, detekcje się pojawiają
- Cap 15MB: próba uploadu >15MB pokazuje błąd UI
- bbox sanity-check na zdjęciu z 11 książek (prod ground truth): czy zwrócone boxy z grubsza lądują na właściwych grzbietach (informacyjny — nie blokuje)

---

## Phase 2: Matching engine (klienci + scoring + dedupe + endpoint)

### Overview

Framework-agnostic silnik matchingu + endpoint orkiestrujący parallel matching wszystkich pending detekcji zdjęcia.

### Changes Required:

#### 1. Google Books client

**File**: `src/lib/books/googleBooks.ts` + `src/lib/books/schema.ts`

**Intent**: Odpytać Google Books volumes, zwalidować Zod, zmapować na kandydatów. Primary źródło.

**Contract**: `async function searchGoogleBooks(query: {title, author, isbn?}): Promise<BookSearchResult>` (discriminated union `{ok:true, candidates}|{ok:false, reason:'rate_limited'|'network'|'empty'}`). URL `https://www.googleapis.com/books/v1/volumes?q=...&printType=books&maxResults=10&country=PL` + `&key=` z env (`GOOGLE_BOOKS_API_KEY`, optional, dual-read). Kaskada query: `isbn:` → `intitle:+inauthor:` → free-text `q=` (tokeny dla OCR-garbled). Zod schema na `items[].volumeInfo.{title,authors,publisher,publishedDate,industryIdentifiers,imageLinks}`. Mapowanie ISBN z `industryIdentifiers[].type`.

#### 2. OpenLibrary client (fallback)

**File**: `src/lib/books/openLibrary.ts`

**Intent**: ISBN-enrichment, NIE title-search fallback. Research: OL zwraca 0 wyników dla polskich tytułów → title-search OL marnuje calle bez wartości.

**Contract**: `async function searchOpenLibrary(query): Promise<BookSearchResult>`. **Wołane TYLKO gdy dostępny jest ISBN** (z detekcji lub z kandydata Google) — `isbn=` lookup; NIE jako title-search fallback dla title-only PL queries. URL `https://openlibrary.org/search.json?isbn=...&fields=key,title,author_name,first_publish_year,isbn,cover_i,language,publisher&limit=5`, header `User-Agent: BookshelfCatalog/1.0 (...)`. Cover URL z `cover_i` (`covers.openlibrary.org/b/id/{cover_i}-M.jpg`). Mapowanie `language` 639-2→porównywalne. W `match.ts`: gdy Google pusty dla title-only PL i brak ISBN → detekcja bez kandydatów (NIE wołaj OL title-search).

#### 3. ISBN utils

**File**: `src/lib/matching/isbn.ts`

**Intent**: Walidacja/normalizacja/konwersja ISBN dla scoringu i dedupe.

**Contract**: `validateIsbn10/13`, `isbn10to13`, `isbn13to10` (979 → null), `normalizeIsbn` (strip `[-\s]`). Czyste funkcje, framework-agnostic.

#### 4. Scoring

**File**: `src/lib/matching/score.ts`

**Intent**: Implementacja formuły PRD §10.

**Contract**: `scoreCandidate(detection, candidate): number` = `0.65*titleSim + 0.30*authorSim + 0.05*isbnBonus`. `titleSim = 1 - levenshtein(norm(a),norm(b))/max(len)` (norm = NFD strip-diacritics lowercase); `authorSim` = max nad authors[], brak detection.author → 0.5; `isbnBonus` = 0.05 gdy kandydat ma ISBN. Progi jako **nazwane stałe** `MATCH_HIGH=0.75`, `MATCH_MID=0.55`.

#### 5. Dedupe

**File**: `src/lib/matching/dedupe.ts`

**Intent**: Wykryć duplikat względem istniejącego katalogu usera (PRD §11) + reconcile kandydatów z dwóch źródeł.

**Contract**: `dedupeCandidates(candidates): BookCandidate[]` (grupuj po isbn_13, wyższy score wygrywa, remis→Google; bez-ISBN po levenshtein title<3). `checkCatalogDuplicate(candidate, existingBooks): {type:'exact'|'edition'|null, shelfHint?}` — ISBN-13 exact match w `books` → `exact`; różny ISBN ale fuzzy title+author → `edition`. Czyste funkcje (existingBooks wstrzykiwane).

#### 6. Match endpoint

**File**: `src/pages/api/photos/[id]/match.ts` (nowy)

**Intent**: Orkiestracja: pending detekcje zdjęcia → parallel matching → persist kandydatów → status.

**Contract**: `POST`. Guard `locals.user`, `parseUuidParam`. Query WSZYSTKICH detekcji zdjęcia po `photo_id` (bez `rejected`; NIE tylko `pending` — inaczej re-match po pierwszym przebiegu, który flipuje status na `matched`, byłby no-op). `Promise.allSettled` per detekcja: Google primary (kaskada query, stop na pierwszym niepustym) → OL TYLKO dla ISBN-enrichment gdy jest ISBN (nie title fallback) → score → dedupe → top-N. Idempotentny persist: delete `book_candidates` dla detection_id → insert z `match_score`+`rank` (delete-then-insert czyni re-match bezpiecznym niezależnie od statusu). Dedup-check vs `books` usera (jeden select wszystkich książek usera, wstrzyknięty do `checkCatalogDuplicate`). `detections.status='matched'`. Per-detekcja graceful degrade; `RATE_LIMITED` tylko gdy wszystkie rate-limited. Zwraca `{data:{matched: N, detections: [...z kandydatami i flagami]}}` w F-02 envelope. SQLSTATE mapping jak w CRUD pattern.

#### 7. Env typing

**File**: `src/env.d.ts`, `.env.example`, `.dev.vars`

**Intent**: `GOOGLE_BOOKS_API_KEY` jako optional secret.

**Contract**: Dodać do `Cloudflare.Env` interface (optional), `.env.example` dokumentuje, `.dev.vars` lokalnie.

### Success Criteria:

#### Automated Verification:

- Unit: `isbn.ts` (walidacja 10/13 checksum, konwersja, 979-edge, normalizacja)
- Unit: `score.ts` (titleSim exact=1, garbled<1, brak-autora=0.5 neutral, isbnBonus, progi)
- Unit: `dedupe.ts` (reconcile po ISBN, fuzzy bez-ISBN, exact/edition catalog match)
- Unit: `googleBooks.ts`/`openLibrary.ts` z mockowanym `fetch` (kaskada query, Zod-walidacja, rate_limited/empty)
- Unit: `match.ts` endpoint z mockowanymi klientami + Supabase (idempotencja, graceful degrade, all-rate-limited→RATE_LIMITED, status→matched)
- Typecheck / lint / build zielone

#### Manual Verification:

- `GOOGLE_BOOKS_API_KEY` w `.dev.vars`; realny `/match` na detekcjach zwraca sensownych kandydatów
- Polski tytuł z OCR-garbled (np. z prod „PRZECIRZTA ADEPT") → Google znajduje poprawny; OL fallback dla ISBN
- Idempotencja: dwukrotny `/match` nie duplikuje `book_candidates` (Supabase Studio)

---

## Phase 3: Proposals UI (review page)

### Overview

Read-only strona review pokazująca tierowane propozycje + flagi duplikatów; `/upload` łańcuchuje process→match→redirect.

### Changes Required:

#### 1. GET rozszerzony o kandydatów

**File**: `src/pages/api/photos/[id].ts`, `src/lib/photos/schema.ts`

**Intent**: Zwrócić kandydatów + flagi per detekcja, by review page miała komplet jednym fetchem (reload-safe).

**Contract**: Gdy `status` w {`matched`,`processed`}, dołącz `book_candidates` per detekcja (order by `rank`) + flagę duplikatu. Nowy `DetectionWithCandidatesDTO` (hand-written type): detekcja + `candidates: BookCandidateDTO[]` + `duplicate: {type,shelfHint}|null`. `BookCandidateDTO` w `src/lib/books/schema.ts`.

#### 2. Review page

**File**: `src/pages/photos/[id].astro` (nowy)

**Intent**: Server page z auth guardem, montuje React island.

**Contract**: `prerender=false`, auth guard (redirect /login), fetch wstępny lub przekazanie `photoId` do island. `<DetectionReview client:load photoId={...} />`.

#### 3. DetectionReview island

**File**: `src/components/DetectionReview.tsx` (nowy)

**Intent**: Read-only prezentacja propozycji, tierowana po `match_score`, z flagami duplikatów.

**Contract**: Ładuje przez `GET /api/photos/[id]` (wzorzec error-surface jak PhotoUploader). Per detekcja: best candidate + 2-4 alternatywy; tier wizualny ≥0.75 zielony/„pre-zaznaczone" / 0.55-0.75 amber/„potwierdź" / <0.55 „brak pewnego matchu"; zero kandydatów → „brak matchu — wpisz ręcznie (krok potwierdzania)"; flagi „duplikat z półki X"/„masz inną edycję". Okładki z `cover_url`. Bez akcji accept (S-05).

#### 4. Chain /upload → review

**File**: `src/components/PhotoUploader.tsx`

**Intent**: Po `/process` wywołać `/match`, potem redirect na `/photos/[id]`.

**Contract**: `processPhoto` rozszerzony: po sukcesie process → `POST /api/photos/[id]/match` → `window.location.href = /photos/${photoId}`. Stage labels dla matchingu.

#### 5. Roadmap — nav follow-up

**File**: `context/foundation/roadmap.md`

**Intent**: Zarejestrować nav entry do review page jako proposed micro-slice (lessons.md „nowa strona → nav entry point").

**Contract**: Dodać wiersz S-15 (lub kolejny) `proposed` w Stream E.

### Success Criteria:

#### Automated Verification:

- Unit: `DetectionReview` renderuje tiery (green/amber/none) wg score, flagi duplikatów, placeholder przy zero kandydatów (jsdom + mock fetch)
- Unit: `GET /api/photos/[id]` dołącza kandydatów + flagę przy status matched (rozszerzony `id.test.ts`)
- E2E (Playwright, mock vision+external): upload → detect → match → redirect → review pokazuje propozycje
- Typecheck / lint / build zielone

#### Manual Verification:

- Pełny flow na prod (po merge + `GOOGLE_BOOKS_API_KEY` w Worker Secrets): upload realnego zdjęcia → review pokazuje tierowane propozycje z okładkami
- Reload strony review zachowuje propozycje (GET reload-safe)
- Flaga duplikatu pojawia się gdy książka już w katalogu (wymaga S-05 do zapełnienia katalogu — lub ręczny insert testowy)

---

## Testing Strategy

### Unit Tests:
- `isbn`/`score`/`dedupe` — czyste funkcje, bogate edge case'y (checksum, garbled title, brak autora, ISBN vs fuzzy dedupe)
- Klienci Google/OL — mockowany `fetch`, kaskada query, Zod-walidacja, rate_limited/empty/network
- Endpointy `match`/`process`/`[id]` — mockowane klienci + Supabase (wzorzec `vi.hoisted`+`vi.mock`), F-02 envelope, idempotencja, graceful degrade
- `deriveWorkingCopy`, `DetectionReview` (jsdom)

### Integration Tests:
- `match.ts` end-to-end z mockowanymi external + in-memory Supabase mock: pełna ścieżka detekcje→kandydaci→status

### Manual Testing Steps:
1. Upload realnego zdjęcia na dev (oryginał, working-copy derive)
2. `/match` na detekcjach z prawdziwym `GOOGLE_BOOKS_API_KEY` — sprawdź kandydatów
3. Review page: tiery, alternatywy, flagi, okładki
4. Idempotencja re-match (Supabase Studio)
5. Cap 15MB, bbox sanity-check

## Performance Considerations

- **photon decode**: realny CPU (~2-5s) + pamięć (~40MB przy 15MB cap) — w limitach Worker (30s CPU / 128MB) dzięki cap'owi uploadu. Vision await ≈ 0 CPU.
- **Parallel matching**: `Promise.allSettled` na N detekcjach — `await fetch` ≈ 0 CPU; 11 równoległych w Google 100/100s.
- **Google quota (realna)**: kaskada query (isbn→intitle→free-text) to do 3 calli/detekcja, ALE **stop na pierwszym niepustym wyniku** (ogranicza średnią). Worst-case 3×11 = 33 calli/zdjęcie → ~30 zdjęć/dzień na quocie 1000/dzień (nie ~90). Kolekcja usera ~67 zdjęć = ~2-3 dni katalogowania lub bump quoty w Cloud Console. KV cache po `external_id` post-MVP gdy potrzeba większego wolumenu.

## Migration Notes

- `0006_detection_bbox.sql` — `supabase db push` DOPIERO po merge do main (branch rule; nieodwracalne w prod DB).
- `storage_path` repurpose: istniejące wiersze `photos` (z S-03 smoke) trzymają stare 1568px-resize'y — nieszkodliwe; nowe uploady to oryginały. Bez backfill.
- `GOOGLE_BOOKS_API_KEY` → Worker Dashboard Secrets + `.dev.vars` przed prod smoke F2/F3.

## References

- Research: `context/changes/external-match-and-proposals/research.md`
- Memory: `s04-detection-spatial-region-model` (bbox 0..1, photon decyzja, granica S-04/S-05)
- Wzorzec klienta: `src/lib/vision/client.ts:14-104`
- Idempotencja: `src/pages/api/photos/[id]/process.ts:126-155`
- F-02: `src/lib/http/response.ts:11-66`
- RLS dwuhop: `supabase/migrations/0002_rls_policies.sql:44-78`
- Formuła scoringu: `docs/prd.md` §10; dedup §11

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Image substrate

#### Automated

- [x] 1.1 WASM spike GATE: photon bundla się do _worker.js + astro dev (workerd) resize bez crasha
- [x] 1.2 Migracja 0006 aplikuje się czysto (dry parse / db diff)
- [x] 1.3 Unit: deriveWorkingCopy resize ≤1568px longest edge
- [x] 1.4 Unit: DetectionItemSchema parsuje z bbox i bez (null)
- [x] 1.5 Unit: process.ts persistuje bbox gdy obecny, null gdy brak
- [x] 1.6 Typecheck zielony
- [x] 1.7 Lint zielony
- [x] 1.8 Build zielony

#### Manual

- [ ] 1.9 Upload realnego zdjęcia na dev → working copy → vision → detekcje
- [ ] 1.10 Cap 15MB pokazuje błąd UI przy przekroczeniu
- [ ] 1.11 bbox sanity-check na zdjęciu z 11 książek (informacyjny)

### Phase 2: Matching engine

#### Automated

- [x] 2.1 Unit: isbn.ts (checksum 10/13, konwersja, 979-edge, normalizacja)
- [x] 2.2 Unit: score.ts (titleSim, authorSim neutral, isbnBonus, progi)
- [x] 2.3 Unit: dedupe.ts (reconcile ISBN, fuzzy bez-ISBN, exact/edition catalog)
- [x] 2.4 Unit: googleBooks/openLibrary z mock fetch (kaskada, Zod, rate_limited/empty)
- [x] 2.5 Unit: match.ts endpoint (idempotencja, graceful degrade, all-rate-limited, status→matched)
- [x] 2.6 Typecheck zielony
- [x] 2.7 Lint zielony
- [x] 2.8 Build zielony

#### Manual

- [ ] 2.9 Realny /match z GOOGLE_BOOKS_API_KEY zwraca sensownych kandydatów
- [ ] 2.10 Polski OCR-garbled tytuł → Google znajduje poprawny
- [ ] 2.11 Idempotencja: dwukrotny /match bez duplikatów (Supabase Studio)

### Phase 3: Proposals UI

#### Automated

- [ ] 3.1 Unit: DetectionReview renderuje tiery + flagi + placeholder zero-match
- [ ] 3.2 Unit: GET /api/photos/[id] dołącza kandydatów + flagę przy matched
- [ ] 3.3 E2E: upload→detect→match→redirect→review pokazuje propozycje (mock)
- [ ] 3.4 Typecheck zielony
- [ ] 3.5 Lint zielony
- [ ] 3.6 Build zielony

#### Manual

- [ ] 3.7 Pełny flow na prod (po merge + Worker Secret): review z tierowanymi propozycjami + okładkami
- [ ] 3.8 Reload review page zachowuje propozycje
- [ ] 3.9 Flaga duplikatu pojawia się dla książki w katalogu
