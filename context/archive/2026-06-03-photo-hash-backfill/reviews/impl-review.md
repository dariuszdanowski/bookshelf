# Impl-review — photo-hash-backfill

**Data:** 2026-06-06
**Reviewer:** agent (Opus), Fast track — auto-apply LOW/MEDIUM
**Zakres:** `scripts/backfill-photo-hashes.mjs` (commity `9feaa22` + `8a63650` na main, bez planu — change realizowany ad-hoc przed wdrożeniem pełnego cyklu)

## Kontekst

Change utknął w `status: in_progress` — implementacja istniała i była zmergowana na main,
ale bez impl-review i bez testów. Ten review domyka cykl retroaktywnie (bez retroaktywnego
planu — Outcome w `change.md` pełni rolę kontraktu).

## Findings

### F1 (HIGH, zaaplikowane) — shifting-window bug paginacji

Pętla stronicowała `WHERE file_hash_sha256 IS NULL` z `range(offset, …)` i przesuwała
`offset += PAGE_SIZE` po pełnej stronie. Po udanych UPDATE'ach wiersze **wypadają ze
zbioru filtra**, więc kursor przeskakiwał kolejne nieprzetworzone rekordy — pojedynczy
run zostawiał ~połowę zdjęć z `NULL` (zbieżność dopiero po wielokrotnych uruchomieniach).

**Fix:** kursor przesuwa się wyłącznie o wiersze, które po przetworzeniu strony nadal są
`NULL` (skip Storage / duplikat 23505 / błąd UPDATE). W `--dry-run` nic nie znika ze
zbioru — offset przesuwa się o pełną stronę (brak nieskończonej pętli).

### F2 (MEDIUM, zaaplikowane) — brak testów + monolityczny entrypoint

Skrypt wykonywał side-effects na top-level (load env, `process.exit`), nieimportowalny
w testach.

**Fix:** core wydzielony do eksportowanej `backfillPhotoHashes(supabase, { dryRun,
bucket, pageSize, log })`, CLI za guardem `import.meta.url === pathToFileURL(argv[1])`.
8 testów unit (`tests/unit/scripts/backfill-photo-hashes.test.ts`) z fake'iem klienta
Supabase odwzorowującym semantykę `IS NULL` + `range()` — w tym test regresyjny na F1,
dry-run, brak pliku w Storage, duplikat 23505 vs inny błąd UPDATE, zgodność hasha.

### Adaptacja literalna (oflagowana)

Błąd fetchu strony: w funkcji `throw` zamiast `process.exit(1)` (testowalność);
CLI łapie wyjątek i nadal kończy z exit 1 — kontrakt zachowany.

## Weryfikacja

- ✅ `npm run lint` — czysto (scripts/ poza zakresem ESLint; test file zgodny)
- ✅ `npm run typecheck` — 0 errors (astro check typuje .mjs przez JSDoc — doprecyzowane sygnatury)
- ✅ `npm run test` — 892/892 (w tym 8 nowych)
- ⏭ E2E — świadomie pominięte: zmiana nie dotyka UI/flow (skrypt ops, brak warstwy przeglądarkowej)

## Pozostaje user-only

Faktyczne uruchomienie na prod: `node scripts/backfill-photo-hashes.mjs --dry-run`
(podgląd), potem bez flagi. Wymaga `.dev.vars` z sekretami **remote** (service-role).
Deliverable change'a = skrypt; run to czynność operacyjna poza cyklem.
