---
change_id: photo-dedup
title: Wykrywanie duplikatów zdjęć przy uploadzie
status: planned
created: 2026-06-02
updated: 2026-06-02
---

## Plan Brief

**Problem:** Użytkownik może wielokrotnie uploadować to samo zdjęcie bez żadnego ostrzeżenia — każde wgranie generuje nowy UUID w Storage i nowy wiersz `photos`, co powoduje zduplikowane koszty vision i zaśmiecony katalog.

**Podejście:** SHA-256 pliku obliczany w przeglądarce (SubtleCrypto, przed uploadem do Storage) → sprawdzenie przez dedykowany endpoint → ostrzeżenie UI z linkiem do istniejącego zdjęcia → opcja "i tak wgraj" lub anuluj. Hash przechowywany w kolumnie `photos.file_hash_sha256` (unique per user). Serwer obsługuje wyścig przez SQLSTATE 23505 → `DUPLICATE_PHOTO`.

**Zakres:** Nowa kolumna DB + migracja, nowy endpoint check-hash, zmiana PhotoUploader (hash + UI warning). Bez zmian w vision/matching pipeline.

**Decyzje:**
| Decyzja | Wybór | Alternatywa |
|---|---|---|
| Gdzie liczyć hash | Browser (przed uploadem) — zero kosztów przy duplikacie | Server-side po Storage upload — za późno |
| Persist hash kiedy | POST /api/photos w body | Podczas /process — zbyt późno na sprawdzenie |
| Duplikat cross-user | NIE — unique per (user_id, hash) | Global — niezgodne z RLS filozofią |
| Co gdy duplikat | Ostrzeżenie + link + opcja "mimo to" | Hard block — zbyt restrykcyjne |

---

## Scope

**Pliki do zmiany:**
- `supabase/migrations/0013_photo_file_hash.sql` (nowy)
- `src/lib/photos/schema.ts` — `RecordPhotoSchema` + `PhotoDTO` + `PhotoCheckDuplicateSchema`
- `src/lib/http/response.ts` — dodaj `DUPLICATE_PHOTO` do `ApiErrorCode` union
- `src/pages/api/photos/check-hash.ts` (nowy endpoint)
- `src/pages/api/photos/index.ts` — przyjmij `file_hash_sha256`, obsłuż 23505
- `src/components/PhotoUploader.tsx` — oblicz hash, sprawdź, pokaż warning

**Pliki do testów:**
- `tests/unit/pages/api/photos/check-hash.test.ts` (nowy)
- `tests/unit/pages/api/photos/index.test.ts` — nowe przypadki 23505 + hash
- `tests/e2e/photo-dedup.spec.ts` (nowy)

---

## Progress

### Phase 1: DB migration

#### Automated
- [x] 1.1 Utwórz `supabase/migrations/0013_photo_file_hash.sql`: kolumna `file_hash_sha256 text`, unique partial index `(user_id, file_hash_sha256) WHERE file_hash_sha256 IS NOT NULL`
- [x] 1.2 `npm run typecheck` — 0 errors

#### Manual
- [x] 1.M Zweryfikuj migrację lokalnie: `npx supabase db reset` (lub `migration up`) — brak błędów, kolumna widoczna w Studio

---

### Phase 2: API — schema + check endpoint + POST update

#### Automated
- [ ] 2.1 `src/lib/photos/schema.ts` — dodaj `file_hash_sha256?: z.string().regex(/^[0-9a-f]{64}$/).optional()` do `RecordPhotoSchema`; dodaj pole do `PhotoDTO`; nowy `CheckDuplicateSchema = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) })`
- [ ] 2.2 `src/lib/http/response.ts` — dodaj `DUPLICATE_PHOTO` do `ApiErrorCode` union
- [ ] 2.3 Nowy `src/pages/api/photos/check-hash.ts`:
  - `GET /api/photos/check-hash?hash=<sha256-hex>`
  - Auth guard (401 dla anonimowych)
  - Walidacja `hash` param (Zod)
  - Query: `SELECT id, shelf_id, created_at FROM photos WHERE user_id = $user AND file_hash_sha256 = $hash LIMIT 1`
  - Odpowiedź: `{ data: { photo: { id, shelf_id, created_at } } }` lub `{ data: { photo: null } }`
- [ ] 2.4 `src/pages/api/photos/index.ts` — accept `file_hash_sha256` w body, persist do DB insert; SQLSTATE 23505 → `apiError({ code: 'DUPLICATE_PHOTO', status: 409, message: 'Zdjęcie już istnieje w katalogu.' })`
- [ ] 2.5 Unit testy `check-hash.test.ts` — auth guard, invalid hash param, found/not-found cases
- [ ] 2.6 Unit testy `index.test.ts` — nowe przypadki: hash persist, 23505 → 409 DUPLICATE_PHOTO
- [ ] 2.7 `npm run test` — wszystkie green
- [ ] 2.8 `npm run typecheck` — 0 errors
- [ ] 2.9 `npm run lint` — 0 errors

#### Manual
- [ ] 2.M Sprawdź `curl /api/photos/check-hash?hash=<valid-hex>` — odpowiedź `{ data: { photo: null } }` dla nieistniejącego hasha

---

### Phase 3: PhotoUploader — hash + UI warning

#### Automated
- [ ] 3.1 `src/components/PhotoUploader.tsx` — nowa funkcja `computeSha256(file: File): Promise<string>` używająca `crypto.subtle.digest('SHA-256', await file.arrayBuffer())`; wywoływana po walidacji rozmiaru pliku, przed Storage upload
- [ ] 3.2 Po obliczeniu hasha: `GET /api/photos/check-hash?hash=<sha256>` → jeśli `photo !== null` → ustaw nowy stan `stage: 'duplicate'` z `duplicatePhotoId`; wyświetl warning:
  - Komunikat: „To zdjęcie jest już w katalogu (dodane <data>)."
  - Przycisk: „Otwórz istniejące" → link do `/photos/<duplicatePhotoId>`
  - Przycisk: „Wgraj mimo to" → kontynuuj upload z `file_hash_sha256` w body
  - Przycisk: „Anuluj" → wróć do `idle`
- [ ] 3.3 Upload stage: `file_hash_sha256` przekazany w body `POST /api/photos`; obsługa 409 `DUPLICATE_PHOTO` (wyścig race condition) — traktuj jak znaleziony duplikat, pokaż link do `/photos/<id>` z body odpowiedzi (jeśli dostępny) lub komunikat generyczny
- [ ] 3.4 E2E test `photo-dedup.spec.ts`:
  - Mock `GET /api/photos/check-hash` → `{ data: { photo: { id: '...', shelf_id: '...', created_at: '...' } } }`
  - Upload pliku → oczekuj stage `duplicate` + komunikat ostrzeżenia widoczny
  - Klik „Wgraj mimo to" → mock `POST /api/photos` (200) → weryfikuj, że upload kontynuuje
  - Klik „Otwórz istniejące" → nawigacja do `/photos/<id>`
  - Klik „Anuluj" → powrót do `idle`
  - Scenariusz bez duplikatu: `check-hash` → `{ photo: null }` → upload normalny (bez warning)
- [ ] 3.5 `npm run test` — wszystkie green
- [ ] 3.6 `npm run typecheck` — 0 errors
- [ ] 3.7 `npm run lint` — 0 errors
- [ ] 3.8 `npx playwright test tests/e2e/photo-dedup.spec.ts` — zielone

#### Manual
- [ ] 3.M Wgraj to samo zdjęcie dwa razy ręcznie w przeglądarce: przy drugim wgraniu powinien pojawić się komunikat ostrzeżenia z datą pierwszego uploadu i linkiem

---

## Success Criteria

1. Drugie wgranie tego samego pliku → komunikat z linkiem do istniejącego zdjęcia, bez kosztów vision
2. Upload po kliknięciu „Wgraj mimo to" → działa normalnie (bez blokady)
3. Różne pliki przez tego samego usera → brak ostrzeżeń
4. Ten sam plik przez różnych userów → brak ostrzeżeń (unique per user_id)
5. `npm run test` — 0 failures; `npx playwright test photo-dedup.spec.ts` — zielone
6. `npm run typecheck && npm run lint` — 0 errors

## Open Questions

(brak — podejście zweryfikowane przez research)
