---
change_id: mobile-upload-crash-recovery
title: Naprawy uploadu na mobile — crash recovery i stabilność
status: archived
archived_at: 2026-06-27T00:50:00Z
created: 2026-06-26
updated: 2026-06-27
---

## Opis

Seria napraw stabilności ścieżki upload/process/match na urządzeniach mobilnych (Android Chrome):
- `/process` konwertowany z blokującego HTTP na SSE streaming (system Android nie ubija SSE keepalive jak blokującego żądania)
- localStorage crash recovery: po reloadzie taba odzyskiwany stan pipeline'u (photo_id + etap + offset matchu)
- matchOffset persistowany i wznawia matching od przerwanego miejsca (nie od początku)
- clearStepLog na każdej pozytywnej ścieżce (brak fałszywych beaconów crash-recovery)
- pominięcie SHA-256 i miniatury dla plików >8 MB (zapobiega OOM przeglądarki mobilnej)
- diagnostyczny endpoint `/api/client-log` + panel debug w UI

## Outcome

Użytkownik może wgrać zdjęcie półki na telefonie (Android Chrome) i — nawet przy wielokrotnym zabiciu taba przez system lub utratą połączenia — wznowić pipeline od miejsca przerwania bez ponownego vision callbacking i bez restartu matchingu od 1/N.

## Pliki zmienione

- `src/components/PhotoUploader.tsx` — główne zmiany: SSE dla process, localStorage recovery, matchOffset, clearStepLog, beacon guard, skip SHA256/thumbnail >8MB, panel debug
- `src/lib/vision/runProcessSSE.ts` — nowy helper SSE client dla `/process`
- `src/pages/api/photos/[id]/process.ts` — refaktor na SSE streaming (event: started / done / error)
- `src/pages/api/client-log.ts` — nowy diagnostyczny endpoint (POST, max 10 KB, bez auth)
- `tests/unit/components/PhotoUploader.test.tsx` — testy SSE process + localStorage recovery + matchOffset resume

## Commits

| SHA | Opis |
|-----|------|
| `34526ba` | fix(upload): diagnoza OOM aparatu — client-log endpoint + skip SHA256 dla duzych plikow |
| `c4ef7b8` | debug(upload): dodaj logi wewnątrz doUpload + global error listeners |
| `595f642` | fix(upload): diagnostyka OOM aparatu — panel debug + localStorage crash recovery |
| `3604890` | fix(upload): resume effect polluje status zamiast retry /process na 'processing' |
| `3a049dc` | refactor(process): konwersja POST /process z blokującego HTTP na SSE streaming |
| `9529afa` | fix(upload): pomiń generowanie miniatury dla plików >8 MB + test zoom 16x |
| `32c0848` | fix(upload): wznów matching od zapisanego offsetu po reloadzie strony na mobile |
| `0375103` | fix(upload): wyczyść step log po pozytywnej ścieżce uploadu |
| `408309d` | fix(upload): nie wysyłaj beacon crash-recovery bez resume photo ID |

## Weryfikacja

- 18 testów jednostkowych PhotoUploader zielone (w tym nowy test matchOffset resume)
- Manualna weryfikacja na Android Chrome: reload w trakcie matchowania 3/11 → wznowienie od 4/11
- Crash-recovery beacon nie odpala się po czystym przepływie
