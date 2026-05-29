---
change_id: external-match-and-proposals
status: archived
created: 2026-05-28
updated: 2026-05-29
implemented_at: 2026-05-28
archived_at: 2026-05-29T06:37:28Z

roadmap_ref: S-04
---

# external-match-and-proposals (S-04)

Matching detekcji do publicznych baz książek (Google Books / OpenLibrary), scoring, deduplikacja względem istniejącego katalogu, propozycje z flagami duplikatów. Outcome (roadmap): użytkownik widzi propozycje z bazy publicznej + flagi duplikatów. PRD refs: FR-015–018; formuła scoringu PRD §10, dedup PRD §11.

**Rozszerzony zakres (decyzja 2026-05-28, rozmowa po wdrożeniu S-03 na prod)** — zob. memory `s04-detection-spatial-region-model`:
- Bounding boxy znormalizowane 0..1 w vision prompt + schemacie `detections`.
- Klient zawsze wysyła oryginał pełnej rozdzielczości; cała obróbka obrazu po stronie serwera (derywacja kopii 1568px + przyszłe cropy/enhancement).
- `photos.original_path` + model danych regionu pod przyszłą re-analizę fragmentów.

Zakres re-analizy fragmentów (crop+enhance+ponowny vision call) — sam pipeline odroczony do osobnego slice'a; S-04 dostarcza tylko substrat danych (bbox + oryginał + region reference).
