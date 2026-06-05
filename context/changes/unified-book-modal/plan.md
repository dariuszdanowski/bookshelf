# Ujednolicone modalne okno książki (add / edit / propose) — Implementation Plan

## Overview

Skonsolidować rozproszone dziś ścieżki pracy z książką w **jeden duży, reużywalny komponent
modalny** (`BookModal`) z trybem `add | edit | propose`. Okno pozwala wpisać dowolny podzbiór
danych (nawet sam ISBN lub sam tytuł) i z poziomu okna uruchomić: „Wyszukaj po danych"
(identyfikacja z baz), „Wyszukaj okładki", „Szukaj w sieci", override okładki. Cel: użytkownik
jest ostateczną instancją — automaty/propozycje to tylko przyspieszacze, a definiowanie
zawartości półek (z lub bez zdjęć) odbywa się w jednym spójnym miejscu.

## Current State Analysis

Po S-33 (branch `change/byok-pipeline`) istnieją rozdzielone elementy:

- **`src/components/BookDetailModal.tsx`** — duże okno dla książki ZATWIERDZONEJ i (read-only)
  kandydata. Zawiera już: `MetadataEditor` (edycja tytuł/autorzy/wydawca/rok/ISBN), `IdentifyPanel`
  („Szukaj po tytule" → `POST /api/books/[id]/identify` search/apply), `CoverEditor` (3 sloty +
  flaga + „sprawdź automatycznie"), `CoverThumb`, akcje „Szukaj w sieci" + „Źródłowe zdjęcie".
  Props: `editableBookId`, `coverSlots`, `sourcePhotoId`, `onCoverUpdated`.
- **`src/components/ManualAddBook.tsx`** — OSOBNY formularz dodawania (toggle → form →
  `POST /api/books` z `shelf_id`). Brak akcji wyszukiwania/identyfikacji/okładki.
- **`DetectionReview.tsx`** — karty kandydatów; klik w okładkę kandydata otwiera `BookDetailModal`
  w trybie read-only (przez `candidateToDetail`).
- Endpointy: `POST /api/books` (add, `AddPurchaseSchema` z `shelf_id`+`cover_url`),
  `PATCH /api/books/[id]` (edit — is_read + okładka + metadane), `POST /api/books/[id]/identify`
  (search/apply, **wymaga istniejącego book id**), `GET /api/books/[id]/cover-suggestion`.
- Silnik wyszukiwania: `src/lib/matching/findCandidates.ts` `findBookCandidates(title, author, isbn)`
  (GB+OL+BN, score, filtr autora, dedup, enrich okładki) — czysty, bezDB.

**Luka kluczowa:** identyfikacja („Wyszukaj po danych") działa tylko dla istniejącej książki
(endpoint pod `/[id]/`). W trybie **add** (książka jeszcze nie istnieje) nie ma jak wyszukać
po wpisanych danych / samym ISBN. Dodatkowo logika formularza (MetadataEditor vs ManualAddBook)
i akcji jest zduplikowana w dwóch komponentach.

## Desired End State

Jeden komponent `BookModal` (duży, modalny) używany w 3 miejscach:

- **add** (np. przycisk „+ Dodaj książkę ręcznie" na półce) → puste pola, wszystkie akcje aktywne;
  „Wyszukaj po danych"/„po ISBN" prefiluje pola z wybranego kandydata; „Zapisz" = `POST /api/books`
  z `shelf_id`.
- **edit** (klik w książkę na półce/w katalogu) → pola prefilled; „Zapisz" = `PATCH /api/books/[id]`;
  pełen override okładki + identyfikacja (re-identify) + „sprawdź okładki".
- **propose** (klik kandydata w review) → metadane read-only + okładka + „Szukaj w sieci"
  (akcja akceptacji kandydata zostaje w `DetectionReview`, modal to podgląd).

Weryfikacja: dodanie książki na półkę z poziomu okna (z samym ISBN → „Wyszukaj po danych" →
wybór → Zapisz), edycja istniejącej (zmiana pól + okładki), podgląd kandydata. Zero regresji
w istniejących przepływach (toggle read, move, identyfikacja edycyjna, manual add).

### Key Discoveries

- `findBookCandidates` (`src/lib/matching/findCandidates.ts`) jest bezDB i reużywalny — wystarczy
  bezksiążkowy endpoint, by włączyć identyfikację w trybie add.
- `BookDetailModal` już hostuje 3 sub-panele (Metadata/Identify/Cover) — `BookModal` to ich
  re-aranżacja pod wspólny `mode`, nie pisanie od zera.
- Storage RLS `book-covers` sprawdza tylko pierwszy segment ścieżki = `auth.uid()` (migracja 0018),
  więc upload okładki działa też BEZ bookId (ścieżka `{uid}/{uuid}.ext`) → override okładki możliwy
  w trybie add.
- `POST /api/books` (`AddPurchaseSchema`) przyjmuje już `cover_url` + `shelf_id` → apply w add-mode
  bez nowego endpointu zapisu.

## What We're NOT Doing

- Nie zmieniamy modelu danych / migracji (reuse istniejących kolumn i endpointów; jedyny nowy
  artefakt to bezksiążkowy endpoint wyszukiwania — read-only, bez DB-write).
- Nie przenosimy akcji akceptacji kandydata (confirm/correct) do modala — `DetectionReview` zostaje
  właścicielem decyzji katalogowych; propose-mode to podgląd.
- Nie robimy crop/edycji obrazu okładki.
- Nie dotykamy pipeline'u vision / BYOK.
- Nie budujemy osobnego „dodaj książkę do wielu półek naraz".

## Implementation Approach

Refaktor-konsolidacja: wynieść wspólne pola/akcje do `BookModal(mode)`, dodać bezksiążkowy
endpoint identyfikacji, podmienić użycia (manual add, klik książki, klik kandydata), usunąć
duplikaty (`ManualAddBook`, rozjeżdżające się panele). Sekwencja: najpierw backend (endpoint),
potem komponent, potem podmiana użyć + sprzątanie.

## Phase 1: Bezksiążkowy endpoint wyszukiwania kandydatów

### Overview
Umożliwić identyfikację po wpisanych danych / samym ISBN ZANIM książka istnieje (tryb add).

### Changes Required

#### 1. Endpoint search-only

**File**: `src/pages/api/books/candidates.ts` (new)

**Intent**: Bezksiążkowe wyszukiwanie kandydatów po częściowych danych (tytuł i/lub autor i/lub
ISBN). Reużywa `findBookCandidates`; gdy podano sam ISBN — wyszukuje po ISBN; auto-ekstrakcja
autora z „Tytuł — Imię Nazwisko" jak w identify.

**Contract**: `POST /api/books/candidates`, body `{ title?, author?, isbn? }` (min. jedno z
title/isbn wymagane). 200 `{ data: { candidates: ScoredCandidate[] } }`, 429 rate_limited, 400
walidacja. Auth wymagany (spójność + ochrona przed otwartym proxy do API). Reuse:
`findBookCandidates` (`src/lib/matching/findCandidates.ts`), `extractAuthorFromTitle`.

#### 2. Schemat zapytania

**File**: `src/lib/books/schema.ts`

**Intent**: Walidacja body dla `/candidates` — co najmniej tytuł lub ISBN.

**Contract**: `SearchCandidatesSchema` (z.object + refine „title || isbn").

### Success Criteria

#### Automated Verification:
- Unit endpointu `/candidates` (sam ISBN / sam tytuł / tytuł+autor / brak → 400 / rate_limited 429): `npm run test`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

#### Manual Verification:
- (objęte Fazą 3 — endpoint sam w sobie bez UI)

---

## Phase 2: Komponent `BookModal(mode)`

### Overview
Jeden duży modal hostujący wspólne pola + akcje, sterowany trybem.

### Changes Required

#### 1. Komponent BookModal

**File**: `src/components/BookModal.tsx` (new — konsoliduje BookDetailModal + ManualAddBook)

**Intent**: Duże okno modalne z polami (tytuł, autorzy, wydawca, rok, ISBN-13/10 — dowolny
podzbiór, walidacja przy zapisie), sekcją okładki (3 sloty + flaga + „Wyszukaj okładki"),
panelem „Wyszukaj po danych" (lista kandydatów → wybór prefiluje pola + okładkę) oraz akcjami
„Szukaj w sieci" i (gdy dotyczy) „Źródłowe zdjęcie". Tryb steruje: zapisem (`add`→`POST /api/books`
z shelf_id, `edit`→`PATCH /api/books/[id]`), źródłem wyszukiwania (`add`/`edit` przed zapisem →
`POST /api/books/candidates`; `edit` na istniejącej → może użyć `/[id]/identify`), oraz read-only
w `propose`. Po zapisie: `onSaved` (rodzic odświeża listę / zamyka).

**Contract**: Props `mode: 'add'|'edit'|'propose'`, `shelfId?` (add), `book?` (edit/propose: dane
+ sloty okładki + id + photoId), `onSaved?`, `onClose`. Reuse istniejącej logiki z BookDetailModal
(CoverEditor/CoverThumb/IdentifyPanel/MetadataEditor — wyniesione lub zaadaptowane). Upload okładki
w add: ścieżka `{uid}/{uuid}.ext` (RLS po uid). „Wyszukaj okładki" = `GET /cover-suggestion` (edit,
po id) lub po ISBN klient-side fallback w add.

#### 2. Wydzielenie wspólnych pól (opcjonalnie)

**File**: `src/components/book/BookFields.tsx` (new, opcjonalne)

**Intent**: Wspólny zestaw inputów metadanych (DRY między trybami) — jeśli redukuje duplikację.

**Contract**: kontrolowane inputy (title/authors/publisher/year/isbn13/isbn10) + walidacja klientowa.

### Success Criteria

#### Automated Verification:
- Unit `BookModal` (3 tryby: render, pola, walidacja, „Wyszukaj po danych" → prefill, zapis add vs edit, propose read-only): `npm run test`
- Typecheck + lint
- Build: `npm run build`

#### Manual Verification:
- (objęte Fazą 3 — integracja w stronach)

---

## Phase 3: Podmiana użyć + sprzątanie + E2E

### Overview
Podpiąć `BookModal` w realne miejsca, usunąć duplikaty, e2e.

### Changes Required

#### 1. Półka — dodawanie i edycja przez BookModal

**File**: `src/components/ShelfBooksIsland.tsx`, `src/components/BookCard.tsx`

**Intent**: „+ Dodaj książkę ręcznie" otwiera `BookModal mode=add` (z shelfId); klik w okładkę
książki otwiera `BookModal mode=edit`. Po zapisie — odświeżenie listy (`loadBooks`) / patch karty.
Usunąć `ManualAddBook` i bezpośrednie użycie `BookDetailModal` dla zatwierdzonych.

**Contract**: ShelfBooksIsland renderuje add-trigger + edit-modal; BookCard deleguje klik do
`BookModal mode=edit`. Zachować istniejące `data-testid` gdzie to możliwe (regresja e2e).

#### 2. Katalog i review

**File**: `src/components/CatalogSearchIsland.tsx`, `src/components/DetectionReview.tsx`

**Intent**: CatalogSearchIsland — edit przez BookModal. DetectionReview — klik kandydata otwiera
`BookModal mode=propose` (podgląd; akcje confirm zostają na karcie).

**Contract**: podmiana propsów; `propose` read-only.

#### 3. Sprzątanie

**File**: `src/components/BookDetailModal.tsx`, `src/components/ManualAddBook.tsx`

**Intent**: Usunąć `ManualAddBook`; `BookDetailModal` wchłonięty przez `BookModal` (usunąć lub
pozostawić cienką re-eksportową kompatybilność, jeśli używany gdzie indziej). Zaktualizować testy.

**Contract**: brak martwego kodu; testy przeniesione/zaktualizowane.

### Success Criteria

#### Automated Verification:
- Pełny unit zielony (przeniesione testy modala/manual-add): `npm run test`
- Typecheck + lint + build
- E2E (dodanie ręczne przez modal, edycja, „Wyszukaj po danych" mock, propose podgląd): `npx playwright test` (w CI — lokalnie patrz pamięć `workerd-dist-lock-build-e2e`)

#### Manual Verification:
- Dodanie książki na półkę z poziomu dużego okna: sam ISBN → „Wyszukaj po danych" → wybór → pola+okładka prefilled → Zapisz → książka na półce.
- Edycja istniejącej (pola + okładka + re-identyfikacja).
- Podgląd kandydata w review (read-only) + „Szukaj w sieci".
- Brak regresji: toggle read, przenoszenie, wyszukiwarka katalogu.

---

## Testing Strategy

### Unit Tests:
- `/api/books/candidates`: ISBN-only, title-only, title+author, brak → 400, 429.
- `BookModal`: tryby add/edit/propose; walidacja częściowych danych; „Wyszukaj po danych" prefill;
  zapis (POST vs PATCH); upload okładki w add (ścieżka {uid}); flaga okładki.
- Regresja: BookCard/islands po podmianie (testid zachowane).

### Integration / E2E:
- add przez modal (mock /candidates + POST), edit (mock PATCH), propose (read-only).

### Manual Testing Steps (user-only):
1. Półka → „+ Dodaj" → wpisz sam ISBN → „Wyszukaj po danych" → „Użyj" → Zapisz.
2. Klik książki → „Edytuj" pola + „Zmień okładkę" + „Wyszukaj po danych".
3. Review → klik kandydata → podgląd + „Szukaj w sieci".

## Migration Notes
Brak migracji — reuse istniejących endpointów i kolumn (S-33). Jedyny nowy artefakt to read-only
endpoint wyszukiwania (bez DB-write).

## References
- Prereq slice (dostarcza bazę): `context/changes/byok-pipeline/` (S-33, branch `change/byok-pipeline`)
- Silnik wyszukiwania: `src/lib/matching/findCandidates.ts`
- Istniejące panele do konsolidacji: `src/components/BookDetailModal.tsx`, `src/components/ManualAddBook.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bezksiążkowy endpoint wyszukiwania kandydatów

#### Automated
- [ ] 1.1 Unit endpointu /candidates (ISBN-only / title-only / title+author / 400 / 429)
- [ ] 1.2 Typecheck
- [ ] 1.3 Lint

### Phase 2: Komponent BookModal(mode)

#### Automated
- [ ] 2.1 Unit BookModal (3 tryby: render/pola/walidacja/prefill/zapis/propose)
- [ ] 2.2 Typecheck + lint
- [ ] 2.3 Build

### Phase 3: Podmiana użyć + sprzątanie + E2E

#### Automated
- [ ] 3.1 Pełny unit zielony (testy przeniesione)
- [ ] 3.2 Typecheck + lint + build
- [ ] 3.3 E2E (add/edit/propose, „Wyszukaj po danych" mock)

#### Manual
- [ ] 3.4 Dodanie książki na półkę z okna (sam ISBN → wyszukaj → wybór → zapis)
- [ ] 3.5 Edycja istniejącej (pola + okładka + re-identyfikacja)
- [ ] 3.6 Podgląd kandydata (read-only) + „Szukaj w sieci"; brak regresji toggle/move/search
