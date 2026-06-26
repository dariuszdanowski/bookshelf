# Mobile Upload Crash Recovery — Krótki plan

> Retrospektywny — zmiana realizowana przez iteracyjne debugowanie, nie przez formalny /10x-plan.

## Co i dlaczego

Android Chrome agresywnie zabija zakładki podczas długich operacji (SSE match ~30s, process ~15s). Skutek: użytkownik wgrywa zdjęcie, czeka na detekcję i matching, tab ginie — i musi zaczynać od nowa. Przy 11 książkach na zdjęciu retry od 1/11 jest frustrujący; przy retry od pełnego vision call jest kosztowny.

Dodatkowe symptomy na mobilnym sprzęcie: OOM przeglądarki przy SHA-256 dużych plików i generowaniu miniatur, brak crash-recovery beaconu wskazującego gdzie pipeline padł.

## Punkt wyjścia

`/api/photos/:id/process` zwracał blokujący HTTP response (system Android ubijał tab po ~6–8s bez aktywności). `PhotoUploader` przechowywał `resume_photo_id` w `sessionStorage` (nie przeżywa ubicia taba). Matching startował zawsze od `offset=0` przy recovery.

## Pożądany stan końcowy

1. `/process` streamuje SSE (`event: started → done/error`) — system traktuje SSE keepalive inaczej niż blokujące żądanie
2. `localStorage` z 30-min TTL zastępuje `sessionStorage` dla RESUME_KEY — przeżywa ubicie taba
3. `matchOffset` zapisywany po każdym przetworzonym detection — wznowienie od przerwanego miejsca
4. `clearStepLog()` wywoływane na każdej pozytywnej ścieżce — brak fałszywych crash-recovery beaconów
5. Beacon guard: beacon tylko gdy RESUME_KEY obecny — old stale log nie powoduje fałszywego alarmu
6. Skip SHA-256 / thumbnail dla plików >8 MB — brak OOM na mobile

## Kluczowe decyzje

| Decyzja | Wybór | Dlaczego |
|---|---|---|
| Transport dla /process | SSE zamiast polling | Android system nie ubija SSE jak blokujące HTTP |
| Storage dla resume | localStorage (30 min TTL) | sessionStorage ginie przy ubiciu taba przez OS |
| matchOffset persistence | Dołożone do RESUME_KEY entry | Jeden klucz LS, atomic z photo ID |
| SHA-256 próg | Skip dla >8 MB | OOM na mobilnym JS heap; dedup niedostępny ale lepszy niż crash |
| Miniatura próg | Skip dla >8 MB | Zbieżny z SHA-256 — jeden warunek |

## Fazy (ex post)

| Faza | Co dostarcza |
|---|---|
| 1. Diagnostyka | client-log endpoint + panel debug + skip SHA-256/thumbnail |
| 2. SSE streaming | /process jako SSE, runProcessSSE helper, resume polling |
| 3. Matching resume | matchOffset persistence + clearStepLog + beacon guard |
