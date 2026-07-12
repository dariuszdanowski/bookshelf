# Domyślna półka przy "dodaj zdjęcie" — Plan implementacji

## Przegląd

Link „Dodaj zdjęcie" (desktop header) i „Skanuj półkę" (mobile nav) w globalnej nawigacji linkują do gołego `/upload`, tracąc kontekst bieżącej półki. `PhotoUploader.tsx` poprawnie obsługuje preset (`?shelf=<id>` → `presetShelfId` prop), ale gdy go brak, domyślnie wybiera `list[0].id` — zawsze „Zakupione" (auto-tworzona jako pierwsza półka przy signup). Fix: nawigacja dołącza `?shelf=<currentShelfId>`, gdy user aktualnie jest na `/shelves/<id>`.

## Analiza stanu obecnego

- `src/pages/shelves/[id].astro:50` — przycisk „+ Dodaj zdjęcie" **w widoku półki** już poprawnie linkuje do `/upload?shelf=${id}`. Ten fix nie dotyczy tego miejsca.
- `src/layouts/Layout.astro:130-132` — globalny desktopowy link nawigacyjny „Dodaj zdjęcie" linkuje do gołego `href="/upload"`, bez parametru `shelf`. `currentPath = Astro.url.pathname` (linia 29) już jest w scope.
- `src/components/MobileNav.tsx:11` — analogiczny link „Skanuj półkę" w `LINKS_AFTER` (statyczna tablica `href: '/upload'`), też bez `shelf`. Komponent już przyjmuje prop `currentPath` (linia 25).
- `src/components/PhotoUploader.tsx:206-315` — kontrakt zostaje niezmieniony: `presetShelfId` prop, walidacja `list.some((s) => s.id === presetShelfId)`, fallback `list[0].id`. Ten plan NIE zmienia tego pliku — problem jest wyłącznie w tym, że nawigacja nie dostarcza `presetShelfId`, nie w samej logice `PhotoUploader`.
- `src/pages/upload.astro:8-9` — `presetShelfId` już poprawnie parsowany z `Astro.url.searchParams.get('shelf')` przez `parseUuidParam`. Ten plan nie dotyka tego pliku.
- **Weryfikacja promienia rażenia (plan-review)**: inne miejsca linkujące do `/upload` — `src/components/AddPurchaseIsland.tsx:87` i `src/pages/photos/[id].astro:61` już poprawnie dołączają `?shelf=` (własny mechanizm, niezależny od `currentPath`; nietknięte tym planem). `ShelvesDropdown.tsx` (importowany w `Layout.astro:6`) potwierdzone pełnym odczytem: nie ma żadnego linku do `/upload` — nietknięty.
- **Trzecie miejsce w zakresie (zgłoszone przez usera po weryfikacji)**: `src/components/PhotoListIsland.tsx:333` — empty-state link „Wgraj pierwsze →" (widoczny gdy półka nie ma jeszcze zdjęć) linkuje do gołego `/upload`, mimo że komponent **już ma `shelfId` jako prop** (`type Props = { shelfId: string; shelfName: string }`, linia 13) — najprostszy przypadek z trzech, zero regexu, tylko interpolacja istniejącego propa.
- **Świadomie POZA zakresem** (zweryfikowane): `src/components/CatalogSearchIsland.tsx:419` (empty-state na `/library` — globalny katalog, brak kontekstu JAKIEJKOLWIEK konkretnej półki) i `src/components/ShelvesIsland.tsx:121` (empty-state na `/shelves` widoczny tylko gdy user ma ZERO półek — nie ma czego preselekcjonować). Oba linkują do gołego `/upload`, ale żaden nie ma dostępnej konkretnej półki do podpięcia.

### Kluczowe odkrycia:

- `Layout.astro` już ma `currentPath` w scope (linia 29) — punkt derywacji `currentShelfId` (server-side, jednorazowo).
- `src/lib/http/response.ts` (źródło `UUID_REGEX`/`parseUuidParam`) nie ma żadnych importów — bezpieczny do importu z `.astro` frontmatter; już importowany analogicznie w `upload.astro:5`. `MobileNav.tsx` (client island) NIE importuje tego modułu ani nie pisze własnego regexu — dostaje gotowy `currentShelfId` jako prop z `Layout.astro` (zob. „Podejście do implementacji").
- `src/pages/purchase.astro` / mobile link „Dodaj zakup" (`MobileNav.tsx:12`) ma ten sam wzorzec (brak przekazywania kontekstu półki), ale NIE był zgłoszony — poza zakresem tego planu (zob. „Czego NIE robimy").

## Pożądany stan końcowy

Gdy user jest na `/shelves/<id>` i klika globalny link nawigacyjny „Dodaj zdjęcie" (desktop) lub „Skanuj półkę" (mobile), trafia na `/upload?shelf=<id>` — `PhotoUploader` preselekcjonuje tę samą półkę, na której user właśnie był. Gdy user NIE jest na stronie konkretnej półki (np. `/library`, `/shelves` lista), link zachowuje się jak dotychczas (goły `/upload`, fallback na pierwszą półkę).

Weryfikacja: nowy/rozszerzony test jednostkowy dla ekstrakcji shelf-id z `currentPath`; E2E potwierdzający, że nawigacja z widoku półki preselekcjonuje właściwą półkę na `/upload`.

## Czego NIE robimy

- Nie zmieniamy `PhotoUploader.tsx` — kontrakt `presetShelfId` i fallback `list[0].id` zostają identyczne; naprawiamy tylko brakujące wywołanie tego kontraktu z nawigacji.
- Nie zmieniamy przycisku „+ Dodaj zdjęcie" w `src/pages/shelves/[id].astro:50` — już działa poprawnie.
- Nie dotykamy linku „Dodaj zakup" (`/purchase`) mimo analogicznego wzorca — niezgłoszone, osobny temat jeśli user potwierdzi że to też problem.
- Nie zmieniamy fallbacku `list[0].id` w `PhotoUploader.tsx` na nic „inteligentniejszego" (np. ostatnio odwiedzana półka z localStorage) — to inny, szerszy mechanizm niż zgłoszony bug; obecny fallback jest OK, gdy user faktycznie nie ma kontekstu żadnej konkretnej półki.

## Podejście do implementacji

**Korekta po weryfikacji (plan-review)**: zamiast duplikować regex UUID w dwóch miejscach, `Layout.astro` derywuje `currentShelfId` **raz, server-side**, reużywając istniejący `UUID_REGEX`/`parseUuidParam` z `src/lib/http/response.ts:61,68` (moduł ma zero importów — bezpieczny do importu z `.astro` frontmatter; już importowany analogicznie w `upload.astro:5`). Wyprowadzony `currentShelfId: string | null` jest przekazywany jako zwykły prop do `<MobileNav currentShelfId={currentShelfId} ... />` — `MobileNav.tsx` NIE pisze własnego regexu, tylko konsumuje gotową wartość. To eliminuje duplikację logiki walidacji UUID (ten sam principle co `MAX_PHOTON_INPUT_BYTES` w poprzednim hotfixie — jedno źródło prawdy zamiast dwóch kopii).

## Faza 1: Kontekstowy link „Dodaj zdjęcie” w nawigacji i empty-state

### Przegląd

Desktop (`Layout.astro`) i mobile (`MobileNav.tsx`) linki do `/upload` dołączają `?shelf=<id>`, gdy user jest na stronie konkretnej półki. Empty-state link w `PhotoListIsland.tsx` używa już dostępnego `shelfId` propa zamiast gołego `/upload`.

### Wymagane zmiany:

#### 1. Desktop nav link

**Plik**: `src/layouts/Layout.astro`

**Cel**: Link „Dodaj zdjęcie” (linia ~130) dołącza `?shelf=<id>`, gdy `currentPath` pasuje do `/shelves/<uuid>`.

**Kontrakt**: W sekcji frontmatter (obok istniejącego `const currentPath = Astro.url.pathname;` linia 29), zaimportuj `parseUuidParam` (lub reużyj `UUID_REGEX`) z `../lib/http/response` (wzorzec identyczny jak w `upload.astro:5`) i wyprowadź `currentShelfId: string | null` przez dopasowanie `currentPath` do `/^\/shelves\/(.+)$/` + walidację wyodrębnionego segmentu przez `parseUuidParam` (dokładne dopasowanie całego segmentu, nie prefiks — `/shelves/<uuid>/cokolwiek` NIE powinno dopasować). `href` linku „Dodaj zdjęcie” (linia ~130) staje się `currentShelfId ? \`/upload?shelf=${currentShelfId}\` : '/upload'`. `navCls('/upload')`/`aria-current` logic (dopasowanie po `/upload` prefiksie) zostaje bez zmian. Przekaż `currentShelfId` jako nowy prop do `<MobileNav currentShelfId={currentShelfId} ... />`.

#### 2. Mobile nav link

**Plik**: `src/components/MobileNav.tsx`

**Cel**: Link „Skanuj półkę” w `LINKS_AFTER` dołącza `?shelf=<id>`, gdy otrzymany `currentShelfId` prop jest niepusty. Komponent NIE derywuje shelf-id samodzielnie — dostaje gotową wartość z `Layout.astro` (jedno źródło prawdy dla walidacji UUID, zob. „Podejście do implementacji”).

**Kontrakt**: Dodaj nowy opcjonalny prop `currentShelfId?: string | null` do sygnatury komponentu (obok istniejącego `currentPath`). `LINKS_AFTER` zostaje statyczną tablicą bez zmian; w miejscu renderowania (`.map()` po `LINKS_AFTER`, linia ~170) specjalnie potraktuj wpis `/upload` — gdy `l.href === '/upload' && currentShelfId`, użyj `href={`/upload?shelf=${currentShelfId}`}`, w przeciwnym razie `l.href` bez zmian. `isActive('/upload')` (dopasowanie po prefiksie ścieżki, linia 39) zostaje bez zmian.

#### 3. Empty-state link w widoku zdjęć półki

**Plik**: `src/components/PhotoListIsland.tsx`

**Cel**: Link „Wgraj pierwsze →” (linia 333, widoczny gdy półka nie ma jeszcze zdjęć) dołącza `?shelf=<shelfId>` — komponent już ma `shelfId` jako prop (linia 13), więc to czysta interpolacja, bez żadnej ekstrakcji/regexu.

**Kontrakt**: `href=”/upload”` (linia 333) → `href={`/upload?shelf=${shelfId}`}`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Nowy test jednostkowy dla ekstrakcji/walidacji shelf-id z `currentPath` w `Layout.astro` (wzorzec dopasowania/niedopasowania, w tym `/shelves/<uuid>/cokolwiek` → brak dopasowania)
- Nowy test E2E (mobile): rozszerz `tests/e2e/mobile-responsive.spec.ts` (już steruje `mobile-nav-toggle`/`mobile-nav-panel`) o asercję preselekcji z widoku półki
- Nowy test E2E (desktop): rozszerz `tests/e2e/upload-flow.spec.ts`, wzorując się na konwencji z `tests/e2e/add-purchase-flow.spec.ts:82-90` (asercja `href` przez `getByTestId(...).toHaveAttribute('href', ...)`, prawdziwe shelf-id z SSR, nie zahardkodowany UUID)
- Pełny unit suite przechodzi: `npm run test`
- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- E2E golden path bez regresji: `npm run test:e2e`

#### Weryfikacja ręczna:

- Wejdź na dowolną półkę (`/shelves/<id>`), kliknij globalny link „Dodaj zdjęcie” w headerze (desktop) — sprawdź, że selektor półki na `/upload` pokazuje tę samą półkę, nie „Zakupione”.
- To samo na mobile (hamburger menu → „Skanuj półkę”) przy widoku szerokości < 768px.
- Wejdź na półkę bez żadnych zdjęć, kliknij empty-state „Wgraj pierwsze →” — sprawdź preselekcję tej samej półki.
- Wejdź na `/library` (bez kontekstu półki), kliknij „Dodaj zdjęcie” — zachowanie bez zmian (fallback na pierwszą półkę, jak dotychczas).

**Uwaga implementacyjna**: Po zakończeniu tej fazy i przejściu wszystkich automatycznych weryfikacji, zatrzymaj się tutaj, aby uzyskać ręczne potwierdzenie od człowieka, że testy ręczne zakończyły się sukcesem.

---

## Strategia testowania

### Testy jednostkowe:

- Ekstrakcja shelf-id z `currentPath`: dopasowanie dla `/shelves/<valid-uuid>`, brak dopasowania dla `/shelves`, `/shelves/<uuid>/cokolwiek`, `/library`, pusty string, `/shelves/<not-a-uuid>`.

### Testy integracyjne:

- Brak nowych — to czysto frontendowa zmiana linków, bez zmian API/DB.

### Kroki testowania ręcznego:

1. Z widoku konkretnej półki, kliknij globalny nav „Dodaj zdjęcie” (desktop) → sprawdź preselekcję.
2. To samo na mobile.
3. Z widoku półki bez zdjęć, kliknij empty-state „Wgraj pierwsze →” → sprawdź preselekcję.
4. Z `/library` (brak kontekstu półki), kliknij „Dodaj zdjęcie” → potwierdź brak regresji (zachowanie jak przed zmianą).

## Referencje

- Zgłoszenie: `context/changes/fix-add-photo-default-shelf/change.md`
- Poprawnie działający precedens do naśladowania: `src/pages/shelves/[id].astro:50`, `src/components/AddPurchaseIsland.tsx:87`
- Kontrakt `presetShelfId` (niezmieniany): `src/components/PhotoUploader.tsx:206-315`
- Konwencja testu E2E dla `?shelf=` href: `tests/e2e/add-purchase-flow.spec.ts:82-90`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków.

### Faza 1: Kontekstowy link „Dodaj zdjęcie” w nawigacji i empty-state

#### Automatyczne

- [x] 1.1 Nowy test jednostkowy ekstrakcji/walidacji shelf-id z currentPath (Layout.astro) przechodzi
- [x] 1.2 Nowy test E2E mobile (rozszerzony mobile-responsive.spec.ts) przechodzi
- [x] 1.3 Nowy test E2E desktop (rozszerzony upload-flow.spec.ts) przechodzi
- [x] 1.4 Pełny unit suite przechodzi
- [x] 1.5 Typecheck przechodzi
- [x] 1.6 Lint przechodzi
- [x] 1.7 E2E golden path bez regresji — 16/16 zielone po naprawie środowiska (WSL keepalive session — VM wyłączał się między poszczególnymi `wsl -e` komendami, restartując Docker/Supabase; `sleep infinity` w tle rozwiązuje to trwale)

#### Ręczne

- [x] 1.8 Desktop: nav „Dodaj zdjęcie” z widoku półki preselekcjonuje właściwą półkę
- [x] 1.9 Mobile: „Skanuj półkę” z widoku półki preselekcjonuje właściwą półkę
- [x] 1.10 Empty-state „Wgraj pierwsze →” z widoku półki bez zdjęć preselekcjonuje właściwą półkę
- [x] 1.11 Brak regresji: nav „Dodaj zdjęcie” z `/library` zachowuje dotychczasowy fallback
