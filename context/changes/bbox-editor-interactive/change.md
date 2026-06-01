---
change_id: bbox-editor-interactive
title: Interaktywny edytor bbox na zdjęciu z opcją re-analizy vision
status: plan_reviewed
created: 2026-06-01
updated: 2026-06-01
archived_at: null
---

## Notes

Pełna edycja ramek detekcji bezpośrednio na zdjęciu:
- Dodawanie nowych ramek (rysowanie prostokąta na overlay)
- Usuwanie istniejących ramek
- Edycja 4 współrzędnych rogów każdego bbox (zawsze pełny prostokąt)
- Interakcja wizualna na zdjęciu (nie formularz z liczbami)

Po vision user dostaje pierwszą propozycję książek + ramki. Może je modyfikować,
a następnie wybrać jedną z opcji:
1. Refine (OCR z obszaru) — tylko dla zaznaczonego bbox
2. Re-analiza vision rozszerzona — przepuść całe zdjęcie przez LLM już z
   użytkownikowymi obszarami jako hints/constraints
