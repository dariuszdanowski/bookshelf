# Miniatura zdjęcia server-side — Plan implementacji

## Przegląd

Przenosimy generowanie miniatury zdjęcia z przeglądarki (canvas) na serwer.
Po wprowadzeniu proxy uploadu (`upload-file.ts`) serwer odbiera i trzyma pełny
`buffer` pliku — może wygenerować miniaturę photonem od razu obok oryginału,
bez angażowania klienta. Eliminuje to kruchy krok `createImageBitmap` na
urządzeniach mobilnych (przyczyna osieroconych uploadów) oraz zbędny drugi
round-trip do `upload-thumbnail`.

## Analiza stanu obecnego

- `POST /api/photos/upload-file` (`src/pages/api/photos/upload-file.ts`) odbiera
  plik jako multipart, liczy `buffer = await file.arrayBuffer()` (linia 54),
  SHA-256, dedup po `file_hash_sha256`, upload oryginału do bucketu `shelf-photos`,
  zwraca `{ storagePath, sha256 }` ze statusem 201.
- Miniatura jest robiona **na kliencie**: `src/lib/images/browserThumb.ts`
  (`makeThumbnailBlob` → `createImageBitmap(file)` → canvas 640px JPEG q0.75),
  a `PhotoUploader.tsx` (`doUpload`, ~263–276) wysyła ją drugim requestem do
  `POST /api/photos/upload-thumbnail`, który zapisuje `<storagePath>.thumb.jpg`.
- **Bug**: `createImageBitmap` na zdjęciu ~2.4 MB / ~12 MP alokuje ~48 MB bitmapy;
  iOS Safari (HTTP LAN) zrzuca/przeładowuje kartę — `try/catch` tego nie łapie
  (ginie cała strona). Oryginał trafia do storage (upload-file OK), ale kolejny
  krok `POST /api/photos` się nie wykonuje → osierocony obiekt bez wiersza w
  `photos`, UI wraca do idle, zero błędu. Potwierdzone: 2 osierocone obiekty w
  lokalnej DB (19:27, 22:13 dnia 2026-06-18, ~2.4 MB każdy).
- Rationale client-side (komentarz „M15" w `browserThumb.ts` / `thumb.ts`) jest
  nieaktualny — powstał gdy przeglądarka uploadowała oryginał **bezpośrednio** do
  Storage (serwer nie widział bajtów). Po proxy bajty są na serwerze.

### Kluczowe odkrycia:

- Server-side resize photonem już istnieje: `deriveWorkingCopy` w
  `src/lib/images/resize.ts:11` (`@cf-wasm/photon/workerd`, `resize` Lanczos3,
  `get_bytes_jpeg`, leak-guard `image.free()/resized.free()` w `finally`).
  Miniatura = ten sam wzorzec, target 640 px zamiast 1568.
- `THUMB_SUFFIX = '.thumb.jpg'` (`src/lib/photos/thumb.ts:8`) — moduł celowo
  zod-free (importują go islandy). Konsumenci ścieżki miniatury:
  `src/pages/api/photos/[id].ts`, `src/pages/api/shelves/[id]/photos.ts` —
  kontrakt `<path>.thumb.jpg` MUSI zostać.
- Jedyny importer `browserThumb`: `PhotoUploader.tsx` (+ unit
  `tests/unit/lib/images/browserThumb.test.ts`). Jedyny caller
  `upload-thumbnail`: `PhotoUploader.tsx` (+ E2E `tests/e2e/media-pack.spec.ts`
  mockuje i asercjuje ten request).
- photon jest **workerd-only** — `resize.ts`/`crop.ts` nie wolno importować do
  browser-islandów (i odwrotnie). Helper miniatury zostaje w `resize.ts`.

## Pożądany stan końcowy

Upload (desktop i mobile, też HTTP LAN) tworzy oryginał **oraz** miniaturę w
jednym żądaniu `upload-file`. Klient nie dotyka już canvasu ani
`upload-thumbnail`. Lista zdjęć (`/photos/[id]`, `shelves/[id]/photos`) pokazuje
miniaturę `<path>.thumb.jpg` tak jak dotąd; przy braku miniatury (HEIC/błąd
photon) fallbackuje do oryginału. Brak nowych osieroconych uploadów z przyczyny
crasha canvas. Weryfikacja: zielone unit/E2E + ręczny upload z telefonu kończy
się wierszem w `photos` i widoczną miniaturą.

## Czego NIE robimy

- Nie scalamy `POST /api/photos` w `upload-file` (pełna atomowość storage+wiersz)
  — osobny follow-up. Usunięcie crasha canvas znosi realny trigger sieroctwa;
  resztkowy gap (klient ginie z innego powodu między upload-file a /api/photos)
  jest rzadki i zaadresujemy go oddzielnie.
- Nie dodajemy dekodowania HEIC server-side (photon nie obsługuje) — degradacja
  do braku miniatury (fallback do oryginału) jest akceptowalna.
- Nie zmieniamy kontraktu ścieżki miniatury ani kształtu odpowiedzi upload-file.
- Nie sprzątamy istniejących osieroconych obiektów w storage (czynność operacyjna
  poza kodem).

## Podejście do implementacji

Dwie fazy: (1) dodać server-side helper + wpiąć best-effort w upload-file
(funkcjonalnie kompletne — miniatury powstają na serwerze, stary klient dalej
działa). (2) sprzątnąć martwy kod klienta i endpoint, zaktualizować testy.
Rozdział pozwala zweryfikować, że server-side miniatura działa, zanim usuniemy
ścieżkę kliencką.

> **F4 — wdrażać obie fazy w jednym slice.** W stanie „tylko Phase 1" serwer i
> klient OBA zapisują `<path>.thumb.jpg` z `upsert:false` → drugi zapis (kliencki
> `upload-thumbnail`) dostaje duplikat → best-effort `console.warn` (nieszkodliwe).
> Przy ręcznej weryfikacji Phase 1 ten warn jest oczekiwany; znika po Phase 2.

## Faza 1: Server-side generowanie miniatury w upload-file

### Przegląd

Dodajemy `deriveThumbnail` (photon, 640 px JPEG) i wołamy go best-effort w
`upload-file.ts` po udanym uploadzie oryginału; zapisujemy `<storagePath>.thumb.jpg`.

### Wymagane zmiany:

#### 1. Helper miniatury (photon)

**Plik**: `src/lib/images/resize.ts`

**Cel**: Dodać eksport `deriveThumbnail(input)` skalujący do max 640 px po dłuższym
boku i kodujący JPEG — server-side odpowiednik `makeThumbnailBlob`. Reużywa wzorca
`deriveWorkingCopy` (ten sam photon, ten sam leak-guard).

**Kontrakt**: `export async function deriveThumbnail(input: ArrayBuffer): Promise<Uint8Array>`
— zwraca bajty JPEG miniatury. Stałe: max edge 640 (= dotychczasowy
`THUMB_MAX_EDGE`). Jakość JPEG: photon `get_bytes_jpeg` przyjmuje **int 1–100**
(jak `deriveWorkingCopy` → 85), więc użyj **75** — NIE 0.75 (kliencki canvas brał
float 0.75; do photonu 0.75 zaokrągli się do 0 = śmieci). Rzuca przy
nie-dekodowalnym wejściu (HEIC/uszkodzony/nietypowy JPEG) — caller łapie.

> **F3/F5**: powierzchnia dekodowania photonu ≠ przeglądarka (np. 1×1 grayscale
> JPEG nie dekoduje się — stąd `tests/fixtures/test-shelf-rgb.jpg` w E2E). Unit
> test musi użyć fixture realnie dekodowalnego przez photon.

#### 2. Wpięcie w upload-file (best-effort)

**Plik**: `src/pages/api/photos/upload-file.ts`

**Cel**: Po udanym `storage.upload` oryginału wygenerować miniaturę z już
posiadanego `buffer` i wgrać ją pod `<storagePath>${THUMB_SUFFIX}`. Błąd
generowania/uploadu miniatury logujemy (`console.warn`) i ignorujemy — nie wpływa
na 201 i `{ storagePath, sha256 }`.

**Kontrakt**: Import `deriveThumbnail` z `../../../lib/images/resize` i
`THUMB_SUFFIX` z `../../../lib/photos/thumb`. Brak zmian w kształcie odpowiedzi.
Miniatura wgrywana tym samym `locals.supabase.storage.from('shelf-photos')`,
`contentType: 'image/jpeg'`, `upsert: false`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- [ ] Unit testy nowego helpera przechodzą: `npm run test:unit` (skalowanie do 640,
      JPEG output, błąd → rzut)
- [ ] Typecheck: `npm run typecheck`
- [ ] Lint: `npm run lint`
- [ ] Build: `npm run build`

#### Weryfikacja ręczna:

- [ ] Upload z desktopu → w storage powstaje `<path>` i `<path>.thumb.jpg`,
      miniatura widoczna na liście
- [ ] Upload z telefonu (HTTP LAN) → wiersz w `photos` powstaje, miniatura widoczna

---

## Faza 2: Usunięcie ścieżki klienckiej i martwego kodu

### Przegląd

Klient przestaje generować i wysyłać miniaturę; usuwamy osierocony moduł, endpoint
i aktualizujemy testy.

### Wymagane zmiany:

#### 1. PhotoUploader — usunięcie kroku miniatury

**Plik**: `src/components/PhotoUploader.tsx`

**Cel**: Usunąć import `makeThumbnailBlob`, blok generowania miniatury i `fetch`
do `upload-thumbnail` (~263–276) w `doUpload`. Flow: `upload-file` → `POST /api/photos`
bez kroku pośredniego.

**Kontrakt**: Po zmianie `doUpload` nie odwołuje się do `browserThumb` ani
`/api/photos/upload-thumbnail`. Reszta flow (stage transitions, dedup 409,
recording) bez zmian.

#### 2. Usunięcie modułu browserThumb + testu

**Plik**: `src/lib/images/browserThumb.ts`, `tests/unit/lib/images/browserThumb.test.ts`

**Cel**: Usunąć (osierocone po zmianie #1).

**Kontrakt**: Brak innych importerów (zweryfikowane grepem). `THUMB_MAX_EDGE` /
`THUMB_JPEG_QUALITY` jeśli używane tylko tu — przenieść wartości jako stałe do
`resize.ts` (helper miniatury).

#### 3. Usunięcie endpointu upload-thumbnail

**Plik**: `src/pages/api/photos/upload-thumbnail.ts`

**Cel**: Usunąć (martwy — jedyny caller usunięty w #1).

**Kontrakt**: Brak. Czytelnicy miniatur (`[id].ts`, `shelves/[id]/photos.ts`)
nie wołają tego endpointu — czytają obiekt ze storage po ścieżce.

#### 4. Aktualizacja komentarza thumb.ts

**Plik**: `src/lib/photos/thumb.ts`

**Cel**: Zaktualizować komentarz „generowana w przeglądarce" → „generowana
server-side w upload-file (photon)". `THUMB_SUFFIX` bez zmian.

#### 5. Aktualizacja E2E media-pack

**Plik**: `tests/e2e/media-pack.spec.ts`

**Cel**: Spec **mockuje `upload-file`** (`page.route`, linia ~34) — serwerowy
photon NIE wykonuje się w tym E2E. Zmiany: usunąć `page.route` dla
`**/api/photos/upload-thumbnail` + asercję `uploadThumbnailCallCount === 1`
(request już nie leci). Zostawić `uploadFileCallCount === 1` oraz istniejące
asercje renderu miniatury (osobny mock-route `/mock-storage/thumb-*`, linia ~136).

> **F1/F2 — granica pokrycia.** Ponieważ E2E mockuje `upload-file`, automaty NIE
> weryfikują samego server-side generowania miniatury. Rdzeń zmiany pokrywają:
> (a) unit `deriveThumbnail` (skalowanie/JPEG), (b) ręczna weryfikacja Phase 1
> (obiekt `<path>.thumb.jpg` realnie w storage). E2E weryfikuje TYLKO że klient
> przestał wołać `upload-thumbnail`. NIE dodawać asercji „obiekt thumb istnieje" w
> tym specu — byłaby niewykonalna przy zamockowanym upload-file.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- [ ] Brak referencji do `browserThumb` / `upload-thumbnail` w `src/`: `npm run lint` + grep czysty
- [ ] Unit suite zielony (bez usuniętego testu): `npm run test:unit`
- [ ] E2E zielone lokalnie: `npm run test:e2e` (media-pack + upload-flow + photo-dedup + upload-skip-process + shelf-photo-pipeline-ui + photos-crud)
- [ ] Typecheck + build: `npm run typecheck && npm run build`

#### Weryfikacja ręczna:

- [ ] Pełny upload (desktop + telefon) działa end-to-end, miniatura widoczna,
      brak nowych osieroconych obiektów

---

## Strategia testowania

### Testy jednostkowe:

- `deriveThumbnail`: skalowanie do 640 px po dłuższym boku, output JPEG (magic
  bytes / niepusty `Uint8Array`), zachowanie przy małym obrazie (no upscale),
  rzut przy nie-dekodowalnym wejściu.

### Testy integracyjne / E2E:

- `media-pack.spec.ts` zaktualizowany: upload przez `upload-file`, miniatura
  powstaje server-side (brak drugiego requestu).
- Regresja: `upload-flow`, `photo-dedup`, `upload-skip-process`,
  `shelf-photo-pipeline-ui`, `photos-crud` pozostają zielone.

### Kroki testowania ręcznego (user-only):

1. Upload zdjęcia z desktopu → miniatura na liście + `<path>.thumb.jpg` w storage.
2. Upload z telefonu po IP LAN (HTTP) → wiersz w `photos` + miniatura; brak
   osieroconego obiektu.
3. Upload HEIC (iPhone) → oryginał zapisany, miniatura może brakować → lista
   fallbackuje do oryginału (akceptowalne).

## Uwagi dotyczące wydajności

Resize 640 px photonem jest tańszy niż istniejący resize 1568 px w
`deriveWorkingCopy` (ścieżka vision) — mieści się w budżecie CPU Workera.
Dekodowanie wejścia (photon) to dodatkowy koszt w upload-file, ale best-effort i
jednorazowy per upload.

## Uwagi dotyczące migracji

Brak migracji DB. Istniejące miniatury (`<path>.thumb.jpg`) pozostają ważne —
ścieżka i format bez zmian. Istniejące osierocone obiekty z buga nie są sprzątane
w tym slice.

## Referencje

- Wzorzec resize: `src/lib/images/resize.ts:11` (`deriveWorkingCopy`)
- Konwencja ścieżki: `src/lib/photos/thumb.ts:8` (`THUMB_SUFFIX`)
- Dowód buga: osierocone obiekty w lokalnym `storage.objects` (2026-06-18)

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Server-side generowanie miniatury w upload-file

#### Automatyczne

- [x] 1.1 Unit testy `deriveThumbnail` przechodzą (`npm run test:unit`) — c9d3f6a
- [x] 1.2 Typecheck (`npm run typecheck`) — c9d3f6a
- [x] 1.3 Lint (`npm run lint`) — c9d3f6a
- [x] 1.4 Build (`npm run build`) — c9d3f6a

#### Ręczne

- [x] 1.5 Upload desktop → oryginał + `<path>.thumb.jpg` w storage, miniatura widoczna — c9d3f6a
- [x] 1.6 Upload telefon (HTTP LAN) → wiersz w `photos`, miniatura widoczna — c9d3f6a

### Faza 2: Usunięcie ścieżki klienckiej i martwego kodu

#### Automatyczne

- [x] 2.1 Grep/lint: brak referencji `browserThumb` / `upload-thumbnail` w `src/` — cad1781
- [x] 2.2 Unit suite zielony bez usuniętego testu (`npm run test:unit`) — cad1781
- [x] 2.3 E2E zielone lokalnie (`npm run test:e2e`) — cad1781
- [x] 2.4 Typecheck + build (`npm run typecheck && npm run build`) — cad1781

#### Ręczne

- [x] 2.5 Pełny upload (desktop + telefon) end-to-end, miniatura widoczna, brak nowych sierot — cad1781
