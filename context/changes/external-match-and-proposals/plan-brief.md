# S-04 external-match-and-proposals — Plan Brief

> Full plan: `context/changes/external-match-and-proposals/plan.md`
> Research: `context/changes/external-match-and-proposals/research.md`

## What & Why

Po detekcji vision (S-03) system automatycznie matchuje każdą wykrytą książkę z publicznymi bazami (Google Books primary, OpenLibrary fallback), buduje rankowanych kandydatów z flagami duplikatów i pokazuje propozycje użytkownikowi. To przedostatni krok łańcucha do gwiazdy przewodniej S-05 (akceptacja→katalog). Plus substrat pod przyszłą re-analizę fragmentów: upload oryginału + bbox.

## Starting Point

Vision pipeline działa na prod (`/process` → `detections` status `pending`). Tabele `book_candidates`/`books` + RLS już istnieją (`0001`/`0002`) — zero pracy schematowej dla matchingu. `src/lib/books/` i `src/lib/matching/` to puste stuby. `GET /api/photos/[id]` istnieje, dziś nieużywany. PhotoUploader resize'uje canvasem przed uploadem.

## Desired End State

Użytkownik wgrywa zdjęcie → vision wykrywa → system matchuje → redirect na read-only stronę review `/photos/[id]` gdzie widzi per książka: najlepszego kandydata + 2-4 alternatywy, tierowane (≥0.75 zielony / 0.55-0.75 amber / <0.55 „brak pewnego matchu") + flagi duplikatów. Akcje accept/correct przychodzą w S-05.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Źródła matchingu | Google primary, OL fallback (ISBN-enrichment) | OL zwraca 0 wyników dla polskich tytułów (live-test) | Research |
| Image processing | photon-rs WASM | cf.image zablokowane (0 zone'ów); Supabase transforms brak crop | Research |
| Trigger matchingu | Osobny `POST /photos/[id]/match` | Idempotentny niezależnie, omija brak `id` w DetectionDTO | Plan |
| UI propozycji | Nowa strona `/photos/[id]` (read-only) | Reload-safe (GET istnieje), S-05 dobuduje accept | Plan |
| Kandydaci w UI | Tierowane, zawsze pokazuj najlepszych | Zgodne z PRD/roadmap (najlepszy + 2-4 alt) | Plan |
| Latencja | Parallel `allSettled`, wait-all | await fetch ≈ 0 CPU; 11 równoległych w limicie Google | Plan |
| bbox | Best-effort persist, nie blokuj | Spatial reasoning Claude „limited"; position primary | Plan |
| Błąd matchingu | Per-detekcja graceful degrade | Jedna padnięta detekcja nie psuje reszty | Plan |
| storage_path | Repurpose na oryginał; working-copy 1568px in-memory | Jedno źródło-oryginał, derive-on-demand; bez nowej kolumny | Plan |
| Scoring | Levenshtein, formuła PRD §10, progi jako stałe | PRD explicite; progi strojone z telemetrii | Research |

## Scope

**In scope:** klienci Google/OL (Zod-validated), scoring+dedupe+isbn (framework-agnostic), `POST /photos/[id]/match`, bbox best-effort + migracja, upload oryginału + photon working-copy, read-only review page, chain process→match→redirect.

**Out of scope:** accept→katalog (S-05), manual entry (S-05), pipeline re-analizy fragmentu (osobny slice), persistencja working-copy, `bbox_source`/`analysis_pass`, KV cache, series bonus, cost cap, custom domain, nav entry (follow-up micro-slice).

## Architecture / Approach

Trzy fazy: substrat → silnik → prezentacja. F1 zmienia kontrakt uploadu (oryginał + photon resize server-side) i dokłada bbox. F2 to czysty framework-agnostic silnik matchingu + endpoint orkiestrujący parallel matching. F3 spina w review page. Klienci/moduły mirrorują `vision/client.ts` (discriminated union, Zod-walidacja, env dual-read). `src/lib/matching/` bez CF/Supabase importów.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Image substrate | Upload oryginału + photon 1568px + bbox capture | photon pamięć/CPU na dużych JPEG (mityg.: cap 15MB) |
| 2. Matching engine | Klienci + scoring + dedupe + `/match` endpoint | Google 1000/dzień quota; jakość matchu polskich tytułów |
| 3. Proposals UI | Review page tierowana + chain flow | bbox/UI churn; reload-safety |

**Prerequisites:** S-03 (done); `GOOGLE_BOOKS_API_KEY` w `.dev.vars`+Worker Secrets przed prod smoke; `@cf-wasm/photon` dependency.
**Estimated effort:** ~3 sesje (faza per sesja), atomic commit per faza.

## Open Risks & Assumptions

- Progi 0.75/0.55 i polityka bez-ISBN nietestowane na realnych danych — strojenie z telemetrii korekt (roadmap Risk).
- photon CPU/pamięć na realnych dużych zdjęciach — zweryfikować manualnie na prod-sized pliku.
- bbox z Claude może być niedokładny — best-effort, `position` zostaje primary; CV swap możliwy później.
- cf.image niedostępne bez custom domain — gdyby kiedyś doszła domena, czystsza ścieżka.

## Success Criteria (Summary)

- Po wgraniu zdjęcia użytkownik widzi tierowane propozycje (najlepszy + alternatywy) z okładkami na stronie review.
- `book_candidates` zapełnione z `match_score`+`rank`, `detections.status='matched'`, idempotentnie.
- Flagi duplikatów działają względem istniejącego katalogu.
