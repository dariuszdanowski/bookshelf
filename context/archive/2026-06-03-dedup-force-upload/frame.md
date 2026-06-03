# Frame Brief: "Wgraj mimo to" vs UNIQUE constraint na hash

> Framing step before /10x-plan. Captures what is *actually* at issue, separated
> from what was initially assumed.

## Reported Observation

Po wykryciu duplikatu zdjęcia (ten sam SHA-256) UI pokazuje ostrzeżenie z opcją
„Wgraj mimo to". Po kliknięciu w Supabase Storage zostaje osierocony obiekt
(plik wgrany do bucketa `shelf-photos`, bez odpowiadającego rekordu w `photos`).

## Initial Framing (preserved)

- **User's stated cause or approach**: „sierota w Storage" — niespójność storage↔DB na ścieżce force-upload.
- **User's proposed direction**: posprzątać obiekt Storage przy tej ścieżce.
- **Pre-dispatch narrowing**:
  - Intencja dedupe: **jeden obraz = jedno zdjęcie** (ten sam plik to zawsze redundancja; UNIQUE constraint poprawny).
  - Wiodący objaw: **oba (sierota + ślepy zaułek) to jeden problem**.

## Dimension Map

1. **Granica Storage↔DB (brak atomowości)** — `supabase.storage.upload()` i `INSERT photos` to dwa nietransakcyjne kroki; 409 po udanym put = sierota. ← initial framing
2. **Spójność „Wgraj mimo to" vs constraint** — przycisk oferuje akcję, którą partial-unique index kategorycznie zabrania; klik = gwarantowana sierota + ślepy zaułek. ← **reframe**
3. **Model dedupe** — czy UNIQUE `(user_id, hash)` poprawny? Rozstrzygnięte przez usera: TAK (jeden obraz = jedno zdjęcie).
4. **Obsługa ścieżki błędu** — branch 409 w kodzie oznaczony jako „race condition", ale dla „Wgraj mimo to" to deterministyczny zakaz, nie wyścig.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Sierota = brak atomowości Storage/DB | `PhotoUploader.tsx:156-178` — put (`uploading`) przed POST; na 409 `setStage('duplicate'); return` bez cleanup | STRONG (mechanizm, nie root) |
| „Wgraj mimo to" niespójny z modelem (root) | `0013_photo_file_hash.sql:7-9` partial UNIQUE `(user_id, file_hash_sha256)`; `handleUploadAnyway` (240) woła tę samą `doUpload` → POST zawsze 23505→409 (`index.ts:63-64`) → brak success path | STRONG |
| Sprzeczność wbudowana na poziomie planu | `archive/.../photo-dedup/plan.md:23` wybrano „opcja 'mimo to'" odrzucając „hard block jako zbyt restrykcyjny"; `:89` 409 modelowane tylko jako race; `:93` test celowo mockuje POST→200 | STRONG |
| Test maskuje bug | `photo-dedup.spec.ts:106-139` — „Wgraj mimo to continues upload" mockuje POST→201; w prod constraint zwróci 409. Anty-wzorzec #1 M3L4 (mock chowa granicę ryzyka) | STRONG |
| Drugie źródło sierot (DELETE zdjęcia) | `[id].ts` ma tylko GET — photo DELETE nie istnieje (S-29 photos-crud proposed) | NONE (poza scope) |

## Narrowing Signals

- User: **jeden obraz = jedno zdjęcie** → constraint zostaje, nadpisuje pierwotne „zbyt restrykcyjne" z planu.
- User: **oba objawy = jeden problem** → fix musi zamknąć i sierotę, i ślepy zaułek, nie tylko sprzątać Storage.
- Kod: brak jakiejkolwiek ścieżki, w której „Wgraj mimo to" kończy się sukcesem przy istniejącym duplikacie.

## Cross-System Convention

Klasa „dwa nietransakcyjne kroki (object store + DB), drugi pada" rozwiązuje się
albo (a) eliminacją niemożliwej akcji u źródła, albo (b) kompensacją/cleanup przy
porażce drugiego kroku. Tu obie są potrzebne w różnych rolach: (a) usunięcie
„Wgraj mimo to" kasuje *deterministyczne* źródło sieroty; (b) cleanup Storage na
409 zostaje jako defense-in-depth dla jedynego pozostałego, *niedeterministycznego*
źródła — prawdziwego race przy współbieżnym uploadzie **nowego** obrazu (komentarz
`PhotoUploader.tsx:172` ten przypadek już nazywa).

## Reframed Problem Statement

> **The actual problem to plan around is**: „Wgraj mimo to" oferuje akcję
> (ponowny upload tego samego obrazu), którą partial-unique index na `(user_id,
> file_hash_sha256)` kategorycznie zabrania — więc na tej ścieżce upload do Storage
> zawsze się udaje, a INSERT zawsze pada (409), produkując gwarantowaną sierotę i
> UX ślepy zaułek. Sierota to objaw, nie choroba.

Pierwotny framing (cleanup Storage) leczy objaw i zostawia przycisk, który nigdy
nie może się udać. Skoro user potwierdza „jeden obraz = jedno zdjęcie", spójne
rozwiązanie usuwa niespójną afordancję u źródła, a cleanup Storage degraduje do
roli zabezpieczenia ścieżki race (gdzie 409 jest realnym, rzadkim wyścigiem).

## Confidence

**HIGH** — zbieżne dowody z kodu, migracji, archiwalnego planu i testu (wszystkie
z file:line); product-intent rozstrzygnięty przez usera. Reframe przetrwał
pressure-test (archiwalny plan potwierdził wbudowaną sprzeczność, nie obalił jej).

## What Changes for /10x-plan

Plan ma być o **rozwiązaniu sprzeczności przycisk↔constraint**, nie o samym
sprzątaniu Storage. Zakres do zaplanowania (kierunki, nie decyzje):
1. Usunięcie „Wgraj mimo to" z `duplicate-warning` (zostaje „Otwórz istniejące" + „Anuluj").
2. Cleanup obiektu Storage gdy POST `/api/photos` zwróci 409 — defense-in-depth dla race path.
3. Korekta `photo-dedup.spec.ts` — test „Wgraj mimo to continues upload" testuje fikcję (mock POST→201); zastąpić asercją realnego kontraktu (brak przycisku / dead-end zamknięty). Plus regression test sieroty na ścieżce race (M3L5).

## References

- `src/components/PhotoUploader.tsx:150-191, 237-251` (doUpload, handleUploadAnyway)
- `src/pages/api/photos/index.ts:53-72` (23505→409 DUPLICATE_PHOTO)
- `src/pages/api/photos/check-hash.ts` (browser-side dedupe pre-check)
- `supabase/migrations/0013_photo_file_hash.sql:7-9` (partial UNIQUE index)
- `tests/e2e/photo-dedup.spec.ts:106-139` (misleading test)
- `context/archive/2026-06-02-photo-dedup/plan.md:23,87-93,110` (wbudowana sprzeczność)
