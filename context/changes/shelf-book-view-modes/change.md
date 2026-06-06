---
change_id: shelf-book-view-modes
roadmap_slice: S-34
status: plan_reviewed
created: 2026-06-06
updated: 2026-06-06
---

# S-34 (rozszerzony) — Nowoczesna prezentacja katalogu książek z pełnym CRUD

Tryby widoku książek (Karty / Lista / Kafelki) na `/shelves/[id]` i `/library`, wzorowane
na S-25 (detection-list-views), ALE rozszerzone (decyzja usera 2026-06-06) o spójną,
nowoczesną prezentację obejmującą PEŁNY CRUD i operacje dodatkowe w każdym układzie:
edycja (BookModal), toggle przeczytania, przeniesienie między półkami, **usuń** (świeży
DELETE /api/books/[id] + ConfirmDialog, już na main), oraz operacje z BookModal — „Szukaj
w sieci" (Google) i „Wyszukaj po danych" (GB/OL/BN). Wspólny przełącznik wynoszony z S-25
do reużywalnego komponentu (DetectionReview przepięty na wspólny). Czysty frontend, bez migracji.
