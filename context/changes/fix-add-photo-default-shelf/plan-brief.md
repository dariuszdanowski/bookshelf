# Domyślna półka przy "dodaj zdjęcie" — Krótki plan

> Pełny plan: `context/changes/fix-add-photo-default-shelf/plan.md`

## Co i dlaczego

User na widoku konkretnej półki klika globalny link nawigacyjny „Dodaj zdjęcie" — oczekuje, że selektor półki na `/upload` pokaże tę samą półkę. Zamiast tego zawsze pokazuje „Zakupione" (pierwsza auto-tworzona półka przy signup). Realny UX bug dla użytkowników, którzy nie sprawdzają selektora ręcznie.

## Punkt wyjścia

`PhotoUploader.tsx` już poprawnie obsługuje preset przez `?shelf=<id>` → `presetShelfId` prop, z fallbackiem na pierwszą półkę gdy brak presetu. Przycisk „+ Dodaj zdjęcie" **w widoku półki** (`shelves/[id].astro`) i `AddPurchaseIsland.tsx` już poprawnie dołączają `?shelf=`. Ale trzy miejsca nie przekazują kontekstu mimo że powinny/mogłyby: globalne linki nawigacyjne (desktop header, mobile hamburger menu) linkują do gołego `/upload`, a empty-state w widoku zdjęć półki (`PhotoListIsland.tsx`) linkuje do gołego `/upload` mimo że **ma `shelfId` jako prop już pod ręką**.

## Pożądany stan końcowy

Klik globalnego linku „Dodaj zdjęcie"/„Skanuj półkę" lub empty-state „Wgraj pierwsze →" z widoku konkretnej półki preselekcjonuje tę półkę na `/upload`. Z innych stron (np. `/library`) zachowanie bez zmian.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Zakres | `/upload` linki z 3 miejsc (nav desktop/mobile + empty-state), nie `/purchase` | Dokładnie zgłoszony symptom; `/purchase` ma ten sam wzorzec ale niezgłoszony | Plan |
| Detekcja półki (nav) | `Layout.astro` derywuje raz server-side (reużywa `parseUuidParam`), przekazuje jako prop do `MobileNav` | Jedno źródło prawdy zamiast duplikowanego regexu w kliencie — znalezione w plan-review | Plan-review |
| Empty-state fix | Czysta interpolacja istniejącego `shelfId` propa, zero regexu | `PhotoListIsland.tsx` już ma `shelfId` w scope — zgłoszone przez usera po pierwszym przeglądzie planu | User |

## Zakres

**W zakresie:**
- `src/layouts/Layout.astro` — desktop nav link „Dodaj zdjęcie" + derywacja `currentShelfId`
- `src/components/MobileNav.tsx` — mobile nav link „Skanuj półkę" (konsumuje `currentShelfId` prop)
- `src/components/PhotoListIsland.tsx` — empty-state „Wgraj pierwsze →"
- Test jednostkowy walidacji shelf-id + E2E (mobile + desktop) potwierdzające preselekcję

**Poza zakresem:**
- `PhotoUploader.tsx` (kontrakt `presetShelfId`/fallback niezmieniony)
- Link „Dodaj zakup" (`/purchase`) — ten sam wzorzec, ale niezgłoszony
- Przycisk „+ Dodaj zdjęcie" w widoku półki, `AddPurchaseIsland.tsx` (już działają poprawnie)
- `CatalogSearchIsland.tsx`/`ShelvesIsland.tsx` empty-state linki — zweryfikowane: brak dostępnego kontekstu konkretnej półki (globalny katalog / zero półek)

## Architektura / Podejście

`Layout.astro` derywuje `currentShelfId` raz (server-side, reużywając istniejący `parseUuidParam`) i przekazuje w dół jako prop — `MobileNav.tsx` nie duplikuje logiki walidacji UUID. `PhotoListIsland.tsx` to czysta interpolacja już posiadanego propa.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Kontekstowy link nawigacji i empty-state | Nav desktop/mobile + empty-state przekazują kontekst półki | Walidacja musi dopasowywać dokładnie cały segment (nie prefiksowo), żeby nie łapać przyszłych podścieżek `/shelves/<id>/...` |

**Wymagania wstępne:** brak
**Szacowany nakład pracy:** ~1 sesja, 1 faza

## Otwarte ryzyka i założenia

- Zakładamy, że `/purchase` (ten sam wzorzec) nie jest w zakresie tego zgłoszenia — do potwierdzenia z userem jako osobny temat, jeśli okaże się problemem.

## Kryteria sukcesu (podsumowanie)

- Nawigacja z widoku półki → `/upload` preselekcjonuje tę półkę, nie „Zakupione".
- Zero regresji dla nawigacji bez kontekstu półki (np. z `/library`).
