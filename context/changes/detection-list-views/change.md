---
change_id: detection-list-views
title: Tryby prezentacji listy detekcji w review — Karty / Lista / Kafelki
status: implementing
created: 2026-05-31
updated: 2026-05-31
archived_at: null
---

## Notes

S-25 z roadmapy. W górnej belce strony review przełącznik trybu prezentacji: Karty (obecny widok — pełna karta z okładką, kandydatami, akcjami), Lista (1 linia/książka: `#N tytuł — autor | badge pewności | [Akceptuj][Odrzuć][Popraw]`), Kafelki (siatka: okładka + tytuł + badge + mini-akcje). Wybór persystowany w `localStorage`; domyślnie Karty na desktopie, Lista na mobilnej szerokości. W trybie Lista/Kafelki `Popraw` otwiera modal, nie inline.

Pierwszy slice fazy 1 „dopracowanie interfejsu przed screenshotami README" (cert). Idzie przed S-24 (lightbox) i S-28 (mobile zależy od trybu Lista jako domyślnego na wąskim ekranie). Refaktor `DetectionCard` na 3 tryby musi zachować istniejące `data-testid` i pełną funkcjonalność.
