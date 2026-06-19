# Miniatura zdjęcia server-side — Krótki plan

> Pełny plan: `context/changes/thumbnail-server-side/plan.md`

## Co i dlaczego

Przenosimy generowanie miniatury zdjęcia z przeglądarki (canvas) na serwer
(`upload-file.ts`, photon). Powód: po wprowadzeniu proxy uploadu serwer już ma
pełny `buffer` pliku, a kliencki `createImageBitmap` na pełnym obrazie wywraca
kartę iOS Safari (HTTP LAN), zostawiając osierocone obiekty w storage bez wiersza
w `photos`.

## Punkt wyjścia

`upload-file` (proxy) zapisuje oryginał i zwraca `{storagePath, sha256}`. Miniaturę
robi klient (`browserThumb.ts` → canvas) i wysyła drugim requestem do
`upload-thumbnail`. Ten kliencki krok jest przyczyną crasha mobilnego i zbędnego
round-tripa; rationale „M15" pochodzi sprzed proxy (gdy serwer nie widział bajtów).

## Pożądany stan końcowy

Upload (desktop i mobile, też HTTP LAN) tworzy oryginał i miniaturę w jednym
żądaniu `upload-file`. Klient nie dotyka canvasu ani `upload-thumbnail`. Lista
pokazuje `<path>.thumb.jpg` jak dotąd; brak miniatury (HEIC/błąd) → fallback do
oryginału. Znika klasa osieroconych uploadów z crasha canvas.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Gdzie miniatura | Server-side w upload-file (photon 640px, q75) | Serwer ma `buffer`; znosi crash + round-trip | Plan |
| Błąd miniatury | Best-effort (nie blokuje 201 oryginału) | Zachowuje dzisiejszą semantykę | Plan |
| `upload-thumbnail.ts` | Usunąć (martwy) | Jedyny caller znika | Plan |
| `browserThumb.ts` + test | Usunąć (osierocone) | Jedyny importer znika | Plan |
| HEIC | Akceptacja degradacji (fallback do oryginału) | photon nie dekoduje HEIC; vision ma ten sam limit | Plan |
| Atomowość (scalić /api/photos) | Poza scope (follow-up) | Slice = miniatura; crash był realnym triggerem sieroctwa | Plan |
| Ścieżka miniatury | `<path>.thumb.jpg` bez zmian | Konsumenci `[id].ts`, `shelves/[id]/photos.ts` | Plan |

## Zakres

**W zakresie:** helper `deriveThumbnail` (photon) · best-effort wpięcie w upload-file ·
usunięcie kroku canvas z PhotoUploader · usunięcie browserThumb + unit test ·
usunięcie endpointu upload-thumbnail · aktualizacja E2E media-pack.

**Poza zakresem:** scalenie storage+wiersz w jeden request (atomowość) ·
dekodowanie HEIC server-side · zmiana kontraktu ścieżki/odpowiedzi · sprzątanie
istniejących osieroconych obiektów.

## Architektura / Podejście

`upload-file` (serwer): ma `buffer` → upload oryginału → **best-effort**
`deriveThumbnail(buffer)` photonem → upload `<path>.thumb.jpg`. Klient: tylko
`upload-file` → `POST /api/photos`. photon pozostaje workerd-only (`resize.ts`),
nie wchodzi do browser-bundle.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Server-side miniatura | `deriveThumbnail` + best-effort w upload-file | photon/HEIC dekodowanie → fallback (akceptowalny) |
| 2. Sprzątanie klienta | usunięcie browserThumb/endpointu, update E2E | E2E media-pack asercja drugiego requestu do przepisania |

**Wymagania wstępne:** brak (proxy upload już w branchu).
**Szacowany nakład pracy:** ~1 sesja, 2 fazy.

## Otwarte ryzyka i założenia

- photon może nie zdekodować HEIC z iPhone → miniatura nie powstanie (fallback do
  oryginału). Założenie: akceptowalne; oryginał i tak zapisany.
- Resztkowy gap orphan (klient ginie między upload-file a /api/photos z innego
  powodu) pozostaje do osobnego follow-upa (atomowość).

## Kryteria sukcesu (podsumowanie)

- Upload z telefonu po LAN kończy się wierszem w `photos` + widoczną miniaturą.
- Brak kroku canvas/`upload-thumbnail` po stronie klienta; unit + E2E zielone.
- Miniatury istniejące i nowe renderują się bez zmian kontraktu ścieżki.
