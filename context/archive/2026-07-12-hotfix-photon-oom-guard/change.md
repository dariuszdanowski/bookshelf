---
change_id: hotfix-photon-oom-guard
title: Hotfix — Photon OOM guard w pipeline zdjęć (Error 1102 produkcja)
status: archived
created: 2026-07-12
updated: 2026-07-12
archived_at: 2026-07-12T11:56:12Z
---

## Notes

Hotfix: Error 1102 (Worker exceeded resource limits) w produkcji — src/pages/api/photos/[id]/process.ts woła deriveWorkingCopy(originalBuffer) z src/lib/images/resize.ts bez guarda rozmiaru wejścia. Photon WASM dekoduje pełny JPEG do surowych pikseli (do 15MB skompresowane = potencjalnie 100-200MB surowych pikseli), co przekracza limit pamięci Workera (128MB) i crashuje izolat (OOM) zamiast rzucić catchable exception — omija istniejący try/catch w process.ts. Analogiczny guard już istnieje w upload-file.ts (THUMB_MAX_INPUT_BYTES = 8MB, best-effort, skip miniatury) ale NIE w process.ts, gdzie deriveWorkingCopy jest na hot path (każde przetwarzanie zdjęcia przed vision). Ten sam wzorzec (Photon na pełnym originalBuffer bez guarda) występuje też w refine.ts (deriveDetectionCrop).

Kontekst incydentu (2026-07-12): Cloudflare GraphQL Analytics (workersInvocationsAdaptive) pokazał dwa różne bursty exceededResources tego dnia — jeden z cpuTime do 842ms (charakterystyczne dla OOM w trakcie wykonania, pasuje do tego bugu), drugi z cpuTime dokładnie 10-17ms (charakterystyczne dla twardego limitu CPU Workers Free plan — konto nie miało aktywnej subskrypcji Workers Paid mimo że docs/plan-implementacji.md zakładał 30s limit paid-plan w rejestrze ryzyk). Workers Paid włączany osobno przez dashboard (poza zakresem tej zmiany kodu). Ten change-id dotyczy WYŁĄCZNIE guard'u Photon/pamięci w kodzie — niezależny fix, potrzebny na obu planach (limit pamięci 128MB jest identyczny na Free i Paid).

Decyzja z rundy pytań: obniżyć globalny limit uploadu z 15MB do 8MB (spójny z już zwalidowanym w kodzie bezpiecznym progiem THUMB_MAX_INPUT_BYTES), żeby zamknąć oba potwierdzone miejsca crasha (process.ts + refine.ts) i uniknąć "martwych uploadów" (plik przechodzi upload, ale zawsze crashuje processing).
