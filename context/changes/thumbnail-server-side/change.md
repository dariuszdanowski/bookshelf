# thumbnail-server-side

**Status:** implementing
**Updated:** 2026-06-19

## Opis

Przeniesienie generowania miniatury zdjęcia z przeglądarki (canvas) na serwer
(`upload-file.ts`, photon). Po wprowadzeniu proxy uploadu serwer już trzyma pełny
`buffer` pliku — robienie miniatury na kliencie to przeżytek sprzed proxy, który
na iOS Safari (HTTP LAN) wywraca kartę przez `createImageBitmap` na pełnym obrazie
i zostawia osierocone obiekty w storage bez wiersza w `photos`.

## Zakres

- Server-side helper `deriveThumbnail` w `src/lib/images/resize.ts` (photon, 640px, JPEG)
- Wpięcie best-effort generowania miniatury w `POST /api/photos/upload-file`
- Usunięcie kroku canvas z `PhotoUploader.tsx` (browserThumb + fetch upload-thumbnail)
- Usunięcie `src/lib/images/browserThumb.ts` + jej unit testu
- Usunięcie endpointu `src/pages/api/photos/upload-thumbnail.ts`
- Aktualizacja E2E `media-pack.spec.ts` (znika drugi request)

## Poza zakresem

- Scalenie `POST /api/photos` w upload-file (pełna atomowość storage+wiersz) — follow-up
- Wsparcie dekodowania HEIC server-side (photon nie obsługuje; fallback do oryginału)
- Zmiana kontraktu ścieżki miniatury (`<path>.thumb.jpg` zostaje)
- Sprzątanie istniejących osieroconych obiektów w storage (osobna czynność operacyjna)
