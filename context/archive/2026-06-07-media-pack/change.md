---
change_id: media-pack
title: "Pakiet B2: media (M15, M16)"
status: archived
created: 2026-06-07
updated: 2026-06-07
archived_at: 2026-06-07T12:50:00Z
---

## Notes

Pakiet B2 z rundy 2 manualnych testów (M13–M23, raport sesji 2026-06-07).
Przyczyny zweryfikowane przed startem:

- **M15** (zdjęcia ładują się wolno): `GET /api/shelves/[id]/photos` podpisywał
  URL-e **pełnych oryginałów** (`createSignedUrls(storagePaths)`) jako
  `thumbnail_url` — lista ściągała wielomegabajtowe pliki. Brak `loading="lazy"`.
- **M16** (desktop mały kadrowany kwadrat): `sm:h-16 sm:w-16` + `object-cover`
  — 64px crop na desktopie.

Decyzja architektoniczna M15: miniatura generowana **w przeglądarce** przy
uploadzie (canvas, max 640px, JPEG q0.75) → `<storage_path>.thumb.jpg`.
Odrzucone alternatywy: Supabase transform (wymaga planu Pro), photon
server-side w upload path (browser→Storage jest bezpośredni; server musiałby
ściągać oryginał z powrotem — koszt CPU/transfer Workers). Best-effort:
HEIC/decode-fail → null → lista fallbackuje do oryginału (legacy zdjęcia
też). DELETE sprząta `.thumb.jpg` razem z oryginałem.

**Pułapka wykryta w trakcie**: wartościowy import z `lib/photos/schema.ts`
do island wciąga **zod do bundle'a przeglądarki** (Vite 404 na stale dep w
działającym dev serverze + bloat) — stała `THUMB_SUFFIX` wylądowała w
zod-free `lib/photos/thumb.ts`. Druga: fixture `test-shelf.jpg` (1×1
grayscale 1-komponentowy JPEG) nie dekoduje się przez `createImageBitmap`
w chromium — nowy fixture `test-shelf-rgb.jpg` dla happy-path.

## Outcome

1. **M15**: upload wgrywa oryginał + miniaturę; lista zdjęć podpisuje
   `[...thumbPaths, ...originals]` jednym batchem i preferuje miniaturę;
   `<img loading="lazy" decoding="async">`.
2. **M16**: desktop (sm+) `h-28 w-auto max-w-56 object-contain` — większy
   podgląd bez kadrowania; mobile bez zmian (S-28 full-width cover).
3. Testy: +4 unit browserThumb (skalowanie, cap, null-paths), +2 unit
   endpointu (prefer thumb, 2N batch), fix asercji DELETE (thumb cleanup);
   nowy E2E `media-pack.spec.ts` (3 testy: dwa uploady Storage,
   lazy+contain desktop, cover mobile).
