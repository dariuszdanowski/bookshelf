# "Wgraj mimo to" vs UNIQUE constraint — Plan Brief

> Full plan: `context/changes/dedup-force-upload/plan.md`
> Frame brief: `context/changes/dedup-force-upload/frame.md`

## What & Why

„Wgraj mimo to" oferuje akcję (ponowny upload tego samego obrazu), którą partial-unique
index na `(user_id, file_hash_sha256)` kategorycznie zabrania — więc upload do Storage
zawsze się udaje, a INSERT zawsze pada (409), produkując gwarantowaną sierotę w Storage
i UX ślepy zaułek. Sierota to objaw, nie choroba; usuwamy niespójną afordancję u źródła.

## Starting Point

Browser liczy SHA-256, pyta `check-hash`, przy duplikacie pokazuje warning z „Otwórz /
Wgraj mimo to / Anuluj". „Wgraj mimo to" woła `doUpload`, które wgrywa plik do Storage,
potem POST `/api/photos` → 23505 → 409, a kod robi `setStage('duplicate'); return`
zostawiając obiekt w buckecie. Sprzeczność jest wbudowana już w planie photo-dedup
(dodał constraint *i* „mimo to", modelując 409 tylko jako race).

## Desired End State

Warning duplikatu pokazuje wyłącznie „Otwórz istniejące" + „Anuluj" — brak ścieżki,
która wgrywa obraz tylko po to, by dostać 409. Gdy zdarzy się prawdziwy race (dwa
współbieżne uploady nowego obrazu), server kasuje świeżo wgrany obiekt zanim zwróci 409.
Zero sierot z obu źródeł.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Model dedupe | UNIQUE zostaje (jeden obraz = jedno zdjęcie) | User potwierdził intencję | Frame |
| „Wgraj mimo to" | Usunąć przycisk + ścieżkę force | Akcja niemożliwa przy constraint | Frame |
| Gdzie cleanup sieroty | Server-side w `index.ts` na 23505 | Robustniej (działa po zamknięciu tab); bez service-role (polityka `shelf_photos_delete_own`) | Plan |
| Mylący e2e test | Przepisać (mockuje POST→201 = fikcja) | Anty-wzorzec #1 M3L4 | Frame |
| Test-first cleanup | Phase 2 red→green | User: M3L5 test-driven bugfixing | Plan |

## Scope

**In scope:** usunięcie „Wgraj mimo to" (UI + ścieżka); server-side Storage cleanup na 23505; korekta `photo-dedup.spec.ts`; component + unit testy.

**Out of scope:** zmiana UNIQUE constraint; service-role; photo DELETE / S-29 photos-crud; kontrakt odpowiedzi POST; browser-side `check-hash`.

## Architecture / Approach

Dwie atomowe fazy. P1: czysto front-end + e2e — usuwa afordancję, kasuje deterministyczne
źródło sieroty i ślepy zaułek. P2: czysto server — `index.ts` na `23505` kasuje obiekt
Storage (`storage_path` z body, polityka RLS pozwala) przed zwróceniem 409; test-first.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Usuń afordancję | Warning bez „Wgraj mimo to"; e2e naprawiony | Pominięcie martwego stanu (`pendingFile/Hash`) → lint/typecheck złapie |
| 2. Server cleanup (test-first) | Brak sieroty na ścieżce race | Best-effort remove — błąd cleanup nie może zmienić odpowiedzi 409 |

**Prerequisites:** brak (hook M3L3 aktywny na main; branch `change/dedup-force-upload`).
**Estimated effort:** ~1 sesja, 2 fazy.

## Open Risks & Assumptions

- Race-409 po usunięciu przycisku pokazuje generyczny warning + tylko „Anuluj" (`duplicatePhotoId=null`) — akceptowalne dla rzadkiego race.
- Cleanup best-effort (try/catch): jeśli `storage.remove` padnie, logujemy, ale zwracamy 409 (sierota teoretycznie możliwa tylko gdy i INSERT, i remove padną — skrajnie rzadkie).
- Cleanup zakłada, że jedyny unique index na `photos` to hash (23505 ⇒ kolizja hash). Dodanie kolejnego unique constraint wymaga rewizji cleanup (F3).

## Success Criteria (Summary)

- Upload duplikatu → tylko „Otwórz istniejące" + „Anuluj", brak „Wgraj mimo to"
- POST z kolizją hash kasuje obiekt Storage przed 409 (test jednostkowy zielony)
- `photo-dedup.spec.ts` testuje realny kontrakt, nie fikcję; cała suita zielona
