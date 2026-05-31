# Dwa tory identyfikacji książek — Plan Brief

> Full plan: `context/changes/image-identification-dual-path/plan.md`

## What & Why

Chcemy podnieść trafność identyfikacji książek i jednocześnie kontrolować koszt API Claude. Dlatego plan zakłada dwa tory:
- szybki zysk jakości przez detection-scoped fallback z drugim przebiegiem obrazu,
- równoległą walidację OCR bez LLM jako potencjalnej ścieżki redukcji kosztu.

## Starting Point

- Runtime produktu nie ma klasycznego OCR.
- Preprocessing runtime to resize + JPEG recompress.
- Badania pokazały, że część przypadków poprawia się po cropie, ale część wymaga najpierw poprawy lokalizacji bbox.

## Desired End State

Projekt ma gotowy, tani fallback dla trudnych detekcji oraz twarde dane z benchmarku, czy OCR bez LLM warto promować do produkcji. Decyzja architektoniczna ma być evidence-based.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Kolejność wdrożenia | Najpierw fallback LLM, potem benchmark OCR | szybszy ROI i mniejsze ryzyko |
| Zakres fallbacku | Detekcja-scoped, nie full-photo | kontrola kosztu i mniejsza złożoność |
| Warunek uruchomienia | Trigger + bbox quality gate | unikanie kosztu na przypadkach bez szans |
| OCR bez LLM | Najpierw benchmark offline | unikamy przedwczesnej złożoności produkcyjnej |

## Phases at a Glance

| Phase | What it delivers |
| --- | --- |
| 1 | Endpoint refine i crop preprocessing |
| 2 | Integracja fallbacku z matchingiem + guardy kosztowe |
| 3 | Benchmark OCR bez LLM i raport go/no-go |
| 4 | (Warunkowo) orchestrator hybrydowy |
