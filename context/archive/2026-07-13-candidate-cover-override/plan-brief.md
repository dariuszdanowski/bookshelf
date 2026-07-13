# Candidate cover override — Krótki plan

> Pełny plan: `context/changes/candidate-cover-override/plan.md`

## Co i dlaczego

Zgłoszone na produkcji: rematch trafił poprawny tytuł, ale kandydat nie miał okładki (źródło zewnętrzne jej nie miało). User chce móc wskazać link/wgrać zdjęcie okładki JUŻ na etapie kandydata (przed zatwierdzeniem do katalogu), zamiast dopiero po.

## Punkt wyjścia

Dziś okładkę można edytować wyłącznie po zatwierdzeniu (`BookModal mode="edit"`, pełny `CoverEditor` — 3 sloty + upload). Widok kandydata (`mode="propose"`) jest w 100% read-only.

## Pożądany stan końcowy

W podglądzie kandydata (Karty i Kafelki) user widzi ten sam `CoverEditor` co w `edit` i może zapisać okładkę dedykowanym przyciskiem „Zapisz okładkę" — bez zatwierdzania detekcji. Wartość natychmiast widoczna na karcie i automatycznie trafia do katalogu przy późniejszym zatwierdzeniu.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Architektura zapisu | Nowy endpoint PATCH-ujący istniejącą kolumnę `book_candidates.cover_url` | Kolumna + RLS UPDATE już istnieją — zero migracji, `confirm.ts`/`correct.ts` bez zmian (czytają świeżo z bazy) | Plan |
| UI edycji okładki | Pełny `CoverEditor` (3 sloty + upload), nie lekkie pole URL | User explicite wybrał parytet z `edit` mode zamiast uproszczonego UI | Plan |
| Widoczność | Zawsze widoczne, nawet gdy kandydat ma auto-okładkę | Pozwala nadpisać złą/nieaktualną automatyczną okładkę, nie tylko brakującą | Plan |
| Zakres widoków | Tylko Karty + Kafelki (gdzie podgląd kandydata już istnieje) | Lista nie ma dziś podglądu kandydata w ogóle — osobna, nieodkryta w tej zmianie luka | Plan |
| Bulk-accept | Bez zmian | User ustawia link przed bulk-accept, wchodząc w pojedynczą detekcję; bulk zostaje szybki | Plan |
| Mechanizm zapisu | Dedykowany przycisk „Zapisz okładkę" (nie auto-save) | Przewidywalne, brak przypadkowych zapisów przy pisaniu URL, spójne z jawnym „Zapisz" w add/edit | Plan |

## Zakres

**W zakresie:**
- Nowy endpoint `PATCH /api/detections/[id]/cover`
- `CoverEditor` widoczny w `BookModal mode="propose"` + dedykowany zapis
- Wiring w `DetectionReview.tsx` (Karty + Kafelki) z optimistic update przez istniejący `onRefined`

**Poza zakresem:**
- Widok Lista (brak podglądu kandydata w ogóle — nieodkryta wcześniej luka)
- Bulk-accept UI
- Model 3 slotów (`user_cover_url`/`cover_photo_url`/`cover_source`) na `book_candidates` — jedna kolumna wystarcza na etapie tymczasowego kandydata

## Architektura / Podejście

`book_candidates.cover_url` (istnieje od migracji 0001, RLS UPDATE od 0002) staje się edytowalne PRZED zatwierdzeniem przez nowy mały endpoint. `confirm.ts`/`correct.ts` już czytają tę kolumnę świeżo przy każdym zatwierdzeniu — zero zmian tam. `BookModal` reużywa istniejący `CoverEditor`/`pickCover()` (dziś w add/edit) w trybie propose, z osobnym przyciskiem zapisu obok (reszta formularza zostaje read-only). Zmiana propaguje się do karty przez już istniejący callback `onRefined`.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Endpoint | `PATCH /api/detections/[id]/cover` na istniejącej kolumnie | Niska — wzorzec 1:1 z `confirm.ts` |
| 2. BookModal | `CoverEditor` + dedykowany zapis w trybie propose | Średnia — nowy handler/stan w już złożonym komponencie |
| 3. Wiring | `candidateToDetail()` + `onCoverSaved` w Karty/Kafelki | Niska — reużywa istniejący `onRefined` |
| 4. Testy | Unit (endpoint + BookModal) + E2E pełnego przepływu | Niska |

**Wymagania wstępne:** brak (zero migracji, zero zmian w confirm/correct).
**Szacowany nakład pracy:** ~1 sesja w 4 fazach.

## Otwarte ryzyka i założenia

- Zakładamy, że user nie oczekuje tej funkcji w widoku Lista (brak podglądu kandydata tam w ogóle) — jeśli to okaże się potrzebne, to osobny follow-up.

## Kryteria sukcesu (podsumowanie)

- User widzi `CoverEditor` w podglądzie dowolnego kandydata (Karty/Kafelki) i może zapisać okładkę bez zatwierdzania detekcji
- Zapisana okładka jest natychmiast widoczna na karcie i automatycznie trafia do katalogu po zatwierdzeniu
