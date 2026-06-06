# S-24: Lightbox zdjęcia w review — Plan Brief

> Full plan: `context/changes/photo-overlay-ux/plan.md`

## What & Why

S-24 scope-reduced: z dwóch części Outcome'u roadmapy (a: toggle ramek, b: lightbox)
część (a) już istnieje (`toggle-bboxes-button`, zoom/pan 1–4×). Dowozimy (b):
pełnoekranowy podgląd zdjęcia z ramkami po kliknięciu obrazu w review.

## Key Decisions Made (Fast track — zawetuj wyjątki)

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Scope | Tylko lightbox (b); (a) done inną drogą | Nota alignment w roadmapie 2026-06-06; nie duplikujemy istniejącego |
| Komponent | Nowy `PhotoLightbox` (React, fixed div) zamiast natywnego `<dialog>` | Konwencja repo: modale React (ConfirmDialog/BookModal pattern); spójny dark-mode styling |
| Ramki w lightboxie | Pozycjonowanie % z bbox 0..1, read-only | Zero pomiarów DOM, zero edycji — prosty komponent prezentacyjny |
| Klik vs pan-drag | Próg 5 px od pointerdown (`dragStateRef`) | Pan to przeciągnięcie; klik bez ruchu — standardowy disambiguator |
| Tryby edycji | Klik NIE otwiera lightboxa w `isEditing`/`singleEdit` | Klik w obraz rysuje/edytuje bbox — kolizja intencji |
| Fokus S-18/S-37 | Lightbox dostaje `visibleDetections` (przy fokusie 1 ramka) | Spójność z aktualnym stanem overlay |

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. PhotoLightbox + trigger + testy | Cały slice | klik-vs-drag na różnych urządzeniach |

**Prerequisites:** S-18 (done) · **Estimated effort:** 1 sesja, 1 faza (S)

## Success Criteria (Summary)

- Klik w zdjęcie → modal z obrazem + numerowane ramki; Esc/tło/✕ zamyka
- W trybach edycji klik nie otwiera; pan-drag nie otwiera
- Lint/typecheck/unit/E2E zielone
