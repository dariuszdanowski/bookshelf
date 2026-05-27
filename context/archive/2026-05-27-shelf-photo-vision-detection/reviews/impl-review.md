<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-03 Upload zdjęcia półki + detekcja grzbietów (vision)

- **Plan**: context/changes/shelf-photo-vision-detection/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-05-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 4 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Niesprawdzony insert detekcji + flip statusu → cicha utrata danych

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability/Data safety)
- **Location**: src/pages/api/photos/[id]/process.ts:126-151
- **Detail**: `delete().eq('photo_id')` (126) i `insert(...)` (129) ignorują `{ error }`. Jeśli insert padnie (transient), linia 143 i tak flipuje `photos.status → 'processed'` z `detected_count` niezerowym, podczas gdy zero wierszy detekcji istnieje. Photo wygląda na przetworzone, ale GET zwraca pustą listę — cicha utrata danych + `detected_count` kłamie. Sibling `shelves/[id].ts` error-checkuje każdy call DB.
- **Fix**: Sprawdź `{ error }` na insert detekcji ORAZ na finalnym update 'processed'. Przy błędzie insertu ustaw `status='failed'` i zwróć INTERNAL_ERROR zamiast raportować sukces.
- **Decision**: FIXED (process.ts:128-150 + 168-175)

### F2 — PhotoUploader: brak recovery dla stale 'processing'; GET [id] nieużyty

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/PhotoUploader.tsx:253-278
- **Detail**: Plan #9 + F2 plan-review (plan.md:158) jawnie wymagały retry dla stanu `failed` LUB stale `processing`. Implementacja oferuje retry tylko ze stanu `error`. Brak logiki która po reloadzie czyta status z GET /api/photos/[id] i wznawia utknięte 'processing'. Efekt: endpoint GET [id] (plan.md:110) jest nieskonsumowany przez UI. Happy-path retry działa.
- **Fix A ⭐ Recommended**: Zarejestruj jako follow-up micro-slice (roadmap), zostaw S-03 as-is.
  - Strength: Happy-path retry działa; reload-recovery to refinement, nie blocker MVP. Zgodne z lessons.md „navigation/recovery jako follow-up micro-slice".
  - Tradeoff: GET [id] zostaje chwilowo nieużyty (dead endpoint do S-04+).
  - Confidence: HIGH — wzorzec micro-slice już stosowany (S-09, S-13).
  - Blind spot: User może utknąć w 'processing' po realnym disconnect aż do post-MVP slice'a.
- **Fix B**: Dorzuć useEffect który po mount fetchuje GET [id] i pokazuje retry gdy status==='processing'.
  - Strength: Domyka kontrakt planu w tym slice; konsumuje GET [id].
  - Tradeoff: Rozszerza scope Phase 4 po fakcie; wymaga persystencji photoId.
  - Confidence: MED — wymaga decyzji gdzie trzymać „ostatni photoId".
  - Blind spot: Bez persystencji photoId reload i tak gubi kontekst.
- **Decision**: Fix A — zarejestrowane jako follow-up micro-slice S-14 (roadmap.md), S-03 zostaje as-is

### F3 — Migracja 0005: polityki nie idempotentne (re-push 42710)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (Data safety)
- **Location**: supabase/migrations/0005_storage_shelf_photos.sql:16-40
- **Detail**: Trzy `create policy "..."` bez guardu. Postgres nie ma „create policy if not exists" → drugi `supabase db push` pada na 42710. Bucket insert ma `on conflict do nothing`, polityki nie. Sibling 0004 używa `drop ... if exists` przed create (recent precedent). Istotne bo ta migracja idzie post-merge `db push`.
- **Fix**: Dodaj `drop policy if exists "<name>" on storage.objects;` przed każdym create — zgodnie z precedensem 0004.
- **Decision**: FIXED (0005_storage_shelf_photos.sql:15-18)

### F4 — process.ts re-fetch: non-null assertions bez error-check → raw throw

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/photos/[id]/process.ts:154-175
- **Detail**: Po update 'processed' re-select photo (154) odrzuca `{ error }` i dereferencuje `updatedPhoto!.id`. Jeśli select padnie/zwróci null → raw TypeError → 500 omijające envelope, dla operacji która JUŻ się udała. `!` na niesprawdzonym wyniku ukrywa null-case.
- **Fix**: Error-checkuj re-fetch; przy błędzie zwróć czysty INTERNAL_ERROR lub złóż response z już-znanego stanu. Usuń `!`.
- **Decision**: FIXED (process.ts:177-199, usunięte non-null assertions)

### F5 — PhotoUploader: shelves fetch połyka błędy, dryf vs ShelvesIsland

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/PhotoUploader.tsx:75-83
- **Detail**: `.catch(() => {})` — przy błędzie selektor pokazuje „Ładowanie półek..." w nieskończoność. Sibling ShelvesIsland.tsx:22-26 sprawdza res.ok i surfuje body.error?.message. Główny flow upload/process poprawnie parsuje envelope.
- **Fix**: Zasurfuj błąd fetcha listy półek (stan + komunikat).
- **Decision**: FIXED (PhotoUploader.tsx:74-92 + shelves-error render)

### F6 — GET /api/photos/[id]: brak guardu locals.user (kosmetyczna niespójność)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/photos/[id].ts
- **Detail**: Brak `if (!locals.user)` jakie mają index.ts i process.ts. NIE jest to podatność — middleware zwraca 401 dla /api/* przed handlerem, RLS scope'uje query. Sibling shelves/[id].ts też pomija → precedens istnieje.
- **Fix**: Dodaj guard dla symetrii albo zostaw (poleganie na middleware OK).
- **Decision**: FIXED ([id].ts:19-23, dodany 401 guard)
