# Hotfix: Photon OOM guard w pipeline zdjęć — Plan implementacji

## Przegląd

Produkcja zwraca sporadycznie `Error 1102` (Worker exceeded resource limits). Jedna z potwierdzonych przyczyn: `src/lib/images/resize.ts` i `src/lib/images/crop.ts` dekodują pełny bufor wejściowy przez Photon WASM (surowe piksele) **bez guarda rozmiaru wejścia** w dwóch z trzech miejsc użycia. Duże zdjęcie (do 15MB skompresowane = potencjalnie 100-200MB surowych pikseli) przekracza limit pamięci Workera (128MB, identyczny na Free i Paid) i **crashuje izolat** zamiast rzucić catchable exception — omija istniejący `try/catch` w `process.ts`/`refine.ts`. Ten fix domyka lukę guardu spójnie we wszystkich trzech miejscach i obniża globalny limit uploadu, żeby wyeliminować scenariusz „upload przechodzi, processing zawsze pada".

## Analiza stanu obecnego

Trzy funkcje derywujące obraz przez `@cf-wasm/photon/workerd`, wołane z różnych endpointów:

| Funkcja | Plik | Wołana z | Guard rozmiaru? |
|---|---|---|---|
| `deriveWorkingCopy` | `src/lib/images/resize.ts:20` | `process.ts:228` (hot path — każde przetwarzanie zdjęcia przed vision) | **Brak** |
| `deriveThumbnail` | `src/lib/images/resize.ts:59` | `upload-file.ts:121` (best-effort, po uploadzie) | Tak — zewnętrzny check w `upload-file.ts:114-118` (`THUMB_MAX_INPUT_BYTES = 8MB`) |
| `deriveDetectionCrop` | `src/lib/images/crop.ts:14` | `refine.ts:206` (refine pojedynczej detekcji) | **Brak** |

`upload-file.ts:110-113` już dokumentuje dokładnie ten mechanizm awarii w komentarzu: duże zdjęcia z komórki przekraczają limit pamięci Workera i „crashują izolat zamiast rzucić wyjątek, którego try/catch by złapał" — ale guard istnieje tylko dla ścieżki miniatury, nie dla `process.ts`/`refine.ts`, gdzie operacja jest obowiązkowa (nie best-effort).

Limit akceptowanego uploadu (`MAX_FILE_SIZE_BYTES = 15MB`) jest zduplikowany w trzech miejscach: `upload-file.ts:9`, `PhotoUploader.tsx:21` (komentarz tam już łączy 15MB z „photon pamięć Worker 128MB" — założenie, które ten incydent obala) i `CoverEditor.tsx:5` (`MAX_COVER_BYTES`, osobna, niepowiązana ścieżka — zob. „Czego NIE robimy").

Potwierdzone danymi produkcyjnymi z Cloudflare GraphQL Analytics (`workersInvocationsAdaptive`, 2026-07-12): burst `exceededResources` z `cpuTimeP99` do 842ms — charakterystyczne dla OOM w trakcie wykonania (WASM decode dużego obrazu), nie dla stałego capu CPU.

### Kluczowe odkrycia:

- `resize.ts:1` i `crop.ts:1` importują `@cf-wasm/photon/workerd` — moduł **workerd-only**, nie może trafić do client bundle. Dlatego shared constant musi żyć w osobnym, czystym module bez tego importu.
- `deriveWorkingCopy`/`deriveThumbnail`/`deriveDetectionCrop` mają identyczny wzorzec `try { image = PhotonImage.new_from_byteslice(...); ...; } finally { image?.free(); ...; }` — guard rozmiaru musi rzucić PRZED `new_from_byteslice`, żeby nigdy nie wejść w WASM decode.
- `process.ts:227-247` i `refine.ts:203-219` już mają `try/catch` wokół wywołania derive-funkcji, które poprawnie obsługuje zwykłe rzucone `Error` (aktualizuje `vision_runs`/`photos`/zwraca 500) — rzucenie zwykłego `Error` z guardu wystarczy, nie trzeba zmieniać obsługi błędów w tych endpointach.
- `tests/unit/lib/images/resize.test.ts` mockuje `@cf-wasm/photon/workerd` przez `vi.mock` — nowe testy guardu powinny iść tym samym wzorcem i weryfikować, że `PhotonImage.new_from_byteslice` NIE zostało wywołane dla zbyt dużego bufora. `crop.ts:1` importuje 5 bindingów (`PhotonImage, crop, grayscale, resize, SamplingFilter`) vs. 3 w `resize.ts` — mock w nowym `crop.test.ts` musi pokryć wszystkie 5.
- `CoverEditor.tsx:68-70` uploaduje bezpośrednio `supabase.storage.from('book-covers').upload(...)` z przeglądarki — nigdy nie dotyka Photon ani serwera. Poza zakresem tego fixu.
- **Korekta po weryfikacji (plan-review)**: bezpieczeństwo importowania `limits.ts` po obu stronach (serwer + client island) wynika wprost z semantyki JS — plik bez ŻADNYCH importów nie może przeciągnąć kodu workerd-only, niezależnie od precedensu. `thumb.ts:3-5`'s komentarz „importują go browser-islands" jest **nieaktualny** — zweryfikowano grepem, że żaden client island obecnie nie importuje `thumb.ts` (importerzy to wyłącznie serwer: `upload-file.ts`, `[id].ts`, `[id]/image.ts`). `limits.ts` będzie pierwszym takim przypadkiem w repo, nie powtórzeniem sprawdzonego wzorca — co jest OK, bo gwarancja nie zależy od precedensu, tylko od tego, że plik pozostaje pusty w importach.

## Pożądany stan końcowy

Zdjęcie powyżej bezpiecznego progu (8MB skompresowane) nigdy nie trafia do Photon WASM — w każdym z trzech miejsc użycia rzucany jest zwykły, catchable `Error` z czytelnym komunikatem PL, obsługiwany przez już istniejące ścieżki błędów (endpoint zwraca 400/500 z jasnym komunikatem, żaden izolat nie crashuje). Upload odrzuca pliki >8MB od razu (klient + serwer), więc nie da się wgrać zdjęcia, które i tak nigdy nie przejdzie przetwarzania.

Weryfikacja: `npm run test` (nowe testy guardu w `resize.test.ts`/nowy `crop.test.ts` zielone), `npm run typecheck`, `npm run lint`, `npm run build`; ręcznie — spróbuj wgrać zdjęcie >8MB i zobacz czytelny komunikat zamiast crasha.

## Czego NIE robimy

- Nie zmieniamy `CoverEditor.tsx`/`MAX_COVER_BYTES` — ta ścieżka nigdy nie dotyka Photon/serwera (upload bezpośrednio do Supabase Storage z przeglądarki).
- Nie włączamy Workers Paid plan ani nie zmieniamy limitów CPU Cloudflare — to osobna decyzja billingowa użytkownika, poza zakresem zmiany kodu.
- Nie zmieniamy `TARGET_EDGE`/`THUMB_EDGE`/jakości JPEG ani logiki resize/crop — tylko dodajemy guard przed wejściem.
- Nie dodajemy dokładniejszej heurystyki (np. parsowanie wymiarów JPEG z nagłówka SOF bez pełnego dekodowania) — próg bajtowy 8MB jest wystarczający i już zwalidowany w kodzie; dokładniejsza heurystyka to potencjalny follow-up, nie hotfix.
- Nie dotykamy `deriveDetectionCrop`'s `maxEdge`/`paddingPx` API ani sygnatur publicznych — tylko wewnętrzny guard.

## Podejście do implementacji

Guard żyje **wewnątrz** trzech derive-funkcji (nie w wywołujących endpointach), żeby zamknąć lukę na granicy niskopoziomowej — żaden przyszły call site nie będzie mógł jej ominąć. Nowy moduł `src/lib/images/limits.ts` (bez importu `@cf-wasm/photon`) eksportuje jedną stałą `MAX_PHOTON_INPUT_BYTES`, importowaną zarówno przez `resize.ts`/`crop.ts` (serwer, Photon), jak i przez `upload-file.ts` (serwer, pre-check) i `PhotoUploader.tsx` (klient, walidacja przed wysyłką) — jedno źródło prawdy zamiast trzech zduplikowanych literałów `15 * 1024 * 1024`.

Faza 1 zamyka realny crash (guard w derive-funkcjach + testy). Faza 2 dostosowuje kontrakt uploadu (limit end-to-end 8MB), żeby nie było „martwych uploadów".

## Faza 1: Guard rozmiaru w derive-funkcjach Photon

### Przegląd

Nowy shared constant module + guard rzucający catchable `Error` przed wywołaniem Photon we wszystkich trzech funkcjach.

### Wymagane zmiany:

#### 1. Nowy moduł stałych

**Plik**: `src/lib/images/limits.ts` (nowy)

**Cel**: Jedno źródło prawdy dla bezpiecznego progu rozmiaru wejścia do Photon WASM. Zastępuje trzy zduplikowane literały `15 * 1024 * 1024` / lokalny `THUMB_MAX_INPUT_BYTES = 8 * 1024 * 1024`.

**Kontrakt**: `export const MAX_PHOTON_INPUT_BYTES = 8 * 1024 * 1024;` z komentarzem wyjaśniającym matematykę OOM (skompresowany JPEG → surowe piksele → limit pamięci Workera 128MB), przeniesionym z istniejącego komentarza w `upload-file.ts:110-113`. **Twardy niezmiennik**: ten plik ma ZERO importów, zawsze — to jedyna rzecz, która czyni go bezpiecznym do importu zarówno z serwera (`resize.ts`, `crop.ts`, `upload-file.ts`), jak i z client bundle (`PhotoUploader.tsx`); dodaj komentarz-strażnik w kodzie („nie dodawaj tu żadnych importów — moduł musi być bezpieczny do client bundle, patrz plan-review hotfix-photon-oom-guard"). Nie ma automatycznej weryfikacji tego niezmiennika (`npm run build` przechodzący NIE jest tego dowodem — zob. Faza 2 Kryteria sukcesu) — bezpieczeństwo wynika wyłącznie z konstrukcji pliku, nie z istniejącego precedensu w repo (zweryfikowano: żaden client island obecnie nie importuje analogicznego `thumb.ts`).

#### 2. Guard w `deriveWorkingCopy` i `deriveThumbnail`

**Plik**: `src/lib/images/resize.ts`

**Cel**: Obie funkcje rzucają czytelny `Error` PRZED `PhotonImage.new_from_byteslice`, jeśli `input.byteLength > MAX_PHOTON_INPUT_BYTES`. Usuwa potrzebę zewnętrznego guardu rozmiaru w `upload-file.ts` przed `deriveThumbnail` (guard teraz żyje w funkcji — defense-in-depth, wywołujący może zostawić swój check albo go usunąć, zob. Faza 2).

**Kontrakt**: Import `MAX_PHOTON_INPUT_BYTES` z `./limits`. Na początku obu funkcji (przed `const bytes = new Uint8Array(input)` lub zaraz po, przed `PhotonImage.new_from_byteslice`): `if (input.byteLength > MAX_PHOTON_INPUT_BYTES) throw new Error('Zdjęcie jest za duże do przetworzenia (max 8 MB). Użyj mniejszego pliku lub skompresuj je przed wgraniem.');` Komunikat po polsku, spójny z istniejącymi (`upload-file.ts:52`).

#### 3. Guard w `deriveDetectionCrop`

**Plik**: `src/lib/images/crop.ts`

**Cel**: Identyczny guard jak w punkcie 2, przed `PhotonImage.new_from_byteslice` w `deriveDetectionCrop`.

**Kontrakt**: Import `MAX_PHOTON_INPUT_BYTES` z `./limits`. Ten sam warunek i komunikat co w Fazie 1.2 (ewentualnie doprecyzowany kontekstowo, np. „...do dopracowania detekcji (max 8 MB)." — implementator dobiera brzmienie spójne z resztą `refine.ts`).

#### 4. Testy jednostkowe guardu

**Plik**: `tests/unit/lib/images/resize.test.ts` (rozszerzenie) + nowy `tests/unit/lib/images/crop.test.ts`

**Cel**: Zweryfikować, że zbyt duży bufor wejściowy rzuca PRZED wywołaniem `PhotonImage.new_from_byteslice` (czyli WASM nigdy nie dostaje szansy na OOM) i że bufor w granicach progu przechodzi normalnie.

**Kontrakt**: Nowe `describe('size guard', ...)` w obu plikach testowych, wzorowane na istniejącym mockowaniu `@cf-wasm/photon/workerd` w `resize.test.ts:24-30`. Przypadki: (a) `new ArrayBuffer(MAX_PHOTON_INPUT_BYTES + 1)` → `await expect(deriveWorkingCopy(buf)).rejects.toThrow()` + `expect(PhotonImage.new_from_byteslice).not.toHaveBeenCalled()`; (b) bufor dokładnie na granicy (`MAX_PHOTON_INPUT_BYTES`) → przechodzi normalnie (nie rzuca). Analogicznie dla `deriveThumbnail` i `deriveDetectionCrop` (nowy plik `crop.test.ts` potrzebuje własnego mocka `@cf-wasm/photon/workerd` z `crop`/`grayscale`/`resize`, wzorowanego na `crop.ts`'s importy).

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Nowe i istniejące testy jednostkowe przechodzą: `npm run test -- resize crop`
- Pełny unit suite przechodzi: `npm run test`
- Sprawdzanie typów przechodzi: `npm run typecheck`
- Linting przechodzi: `npm run lint`

#### Weryfikacja ręczna:

- (odłożone do końca Fazy 2 — pełny test end-to-end wgrania dużego zdjęcia sensowny dopiero po dostosowaniu limitu uploadu)

---

## Faza 2: Wyrównanie limitu uploadu (15MB → 8MB) i sprzątnięcie duplikatów

### Przegląd

Obniża globalny akceptowany rozmiar uploadu do progu bezpiecznego dla Photon, eliminując „martwe uploady", i zamienia zduplikowane literały na import z `src/lib/images/limits.ts`.

### Wymagane zmiany:

#### 1. Serwerowy limit uploadu

**Plik**: `src/pages/api/photos/upload-file.ts`

**Cel**: `MAX_FILE_SIZE_BYTES` (linia 9) i `THUMB_MAX_INPUT_BYTES` (linia 114) zastąpione importem `MAX_PHOTON_INPUT_BYTES` z `../../../lib/images/limits` — jeden limit zamiast dwóch nazw dla tej samej wartości. Komunikat błędu (linia 52) zaktualizowany do „max 8 MB".

**Kontrakt**: Usuń lokalne stałe `MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024` i `THUMB_MAX_INPUT_BYTES = 8 * 1024 * 1024`; zastąp obie użycia importowanym `MAX_PHOTON_INPUT_BYTES`. Guard przy `deriveThumbnail` (linia 115: `if (file.size > THUMB_MAX_INPUT_BYTES)`) może zostać jako defense-in-depth (teraz redundantny z guardem wewnątrz `deriveThumbnail` z Fazy 1, ale nieszkodliwy — unika samego wywołania funkcji dla dużych plików) — zaktualizuj tylko referencję do stałej.

#### 2. Kliencki limit uploadu

**Plik**: `src/components/PhotoUploader.tsx`

**Cel**: `MAX_FILE_SIZE_BYTES` (linia 21) zastąpiony importem `MAX_PHOTON_INPUT_BYTES` z `../lib/images/limits`. Komunikat błędu (linia 656) i tekst UI (linia 876) zaktualizowane do „max 8 MB".

**Kontrakt**: Import z `../lib/images/limits` (moduł zod-free, bez photon — bezpieczny do bundlowania w client island). Usuń lokalną definicję `MAX_FILE_SIZE_BYTES`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Pełny unit suite przechodzi: `npm run test`
- Sprawdzanie typów przechodzi: `npm run typecheck`
- Linting przechodzi: `npm run lint`
- Build przechodzi (zwykły smoke test — **nie** jest dowodem, że `limits.ts` pozostał wolny od importów; ta własność wynika z konstrukcji pliku, zob. Faza 1.1 „Twardy niezmiennik"): `npm run build`
- E2E golden path bez regresji: `npm run test:e2e`

#### Weryfikacja ręczna:

- Spróbuj wgrać zdjęcie >8MB przez UI — zobacz czytelny komunikat „Plik jest za duży (max 8 MB)" zamiast crasha lub cichej porażki.
- Spróbuj wgrać i przetworzyć zdjęcie w granicach nowego limitu (np. 5-7MB) — pełny flow (upload → miniatura → vision → detekcje) działa jak dotychczas.

**Uwaga implementacyjna**: Po zakończeniu tej fazy i przejściu wszystkich automatycznych weryfikacji, zatrzymaj się tutaj, aby uzyskać ręczne potwierdzenie od człowieka, że testy ręczne zakończyły się sukcesem.

---

## Strategia testowania

### Testy jednostkowe:

- Guard rzuca dla bufora > 8MB, PRZED konstrukcją `PhotonImage` (weryfikowane przez `not.toHaveBeenCalled()` na mocku).
- Guard NIE rzuca dla bufora dokładnie na granicy / poniżej.
- Istniejące testy `resize.test.ts` (resize logic, EXIF, free() calls) nadal przechodzą bez zmian w zachowaniu dla normalnych rozmiarów.

### Testy integracyjne:

- Brak nowych — endpoint-level error handling (`process.ts`/`refine.ts` `try/catch`) jest już pokryty istniejącymi testami tych endpointów; guard tylko dorzuca nowy typ rzucanego błędu, obsługiwany tą samą ścieżką.

### Kroki testowania ręcznego:

1. Wgraj zdjęcie >8MB przez `/shelves/[id]` UI → oczekiwany czytelny komunikat błędu, brak crasha strony.
2. Wgraj zdjęcie 5-7MB → pełny flow (upload → miniatura → vision → detekcje → confirm) działa normalnie.
3. Sprawdź Cloudflare Analytics (`workersInvocationsAdaptive`) po deployu — brak nowych `exceededResources` z `cpuTime` w setkach ms (sygnatura OOM) na `process.ts`/`refine.ts`.

## Referencje

- Kontekst incydentu: `context/changes/hotfix-photon-oom-guard/change.md`
- Istniejący (częściowy) guard, wzorzec do naśladowania: `src/pages/api/photos/upload-file.ts:110-118`
- Istniejące testy, wzorzec mockowania: `tests/unit/lib/images/resize.test.ts:1-46`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków.

### Faza 1: Guard rozmiaru w derive-funkcjach Photon

#### Automatyczne

- [x] 1.1 Nowe i istniejące testy jednostkowe resize/crop przechodzą
- [x] 1.2 Pełny unit suite przechodzi
- [x] 1.3 Typecheck przechodzi
- [x] 1.4 Lint przechodzi

### Faza 2: Wyrównanie limitu uploadu (15MB → 8MB) i sprzątnięcie duplikatów

#### Automatyczne

- [ ] 2.1 Pełny unit suite przechodzi
- [ ] 2.2 Typecheck przechodzi
- [ ] 2.3 Lint przechodzi
- [ ] 2.4 Build przechodzi
- [ ] 2.5 E2E golden path bez regresji

#### Ręczne

- [ ] 2.6 Upload >8MB → czytelny komunikat błędu, brak crasha
- [ ] 2.7 Upload 5-7MB → pełny flow działa normalnie
