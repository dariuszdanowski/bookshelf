# Impl-review — book-to-detection-focus (S-37)

**Data:** 2026-06-06
**Reviewer:** agent (Opus), Fast track
**Zakres:** commity `ce02c06` (p1) + `05a5737` (p2) vs `plan.md`

## Zgodność plan ↔ implementacja

| Kontrakt z planu | Stan |
| --- | --- |
| P1: `detection_id` w ShelfBookDTO/CatalogBookDTO (required, nullable) | ✅ `src/lib/books/schema.ts` |
| P1: SELECT + mapper w `shelves/[id]/books` i `books/search` (pattern photo_id) | ✅ |
| P1: testy unit endpointów + fixture BookCard (F1 z plan-review) | ✅ 41 testów touched-set |
| P2: BookCard href `?detection=` gdy detection_id, fallback bez query | ✅ |
| P2: `[id].astro` → `parseUuidParam(searchParams)` → prop island, śmieci→null | ✅ |
| P2: DetectionReview `initialFocusedDetectionId` — fokus + scroll (rAF, 3 tryby) | ✅ one-shot ref guard |
| P2: testy unit (4 DR + 1 BC) + E2E 3 scenariusze (golden/nieznane id/zły UUID) | ✅ |

## Findings

### F1 (OBSERVATION, przyjęte) — fixture testowe wymagały photo_url

Overlay zwraca `null` bez `photo_url` (`PhotoDetectionOverlay.tsx:205`) — testy fokusu
używają lokalnego `makePhotoResponseWithUrl()`. Zgodne z intencją planu; bez zmian kodu
produkcyjnego.

### Adaptacja środowiskowa (oflagowana, poza kodem)

Stały dev server usera na :4321 był w stanie broken-workerd (HTTP 500 na każdej stronie
SSR, /api/health 200) — E2E uruchomione na drugim dev serverze :4322 przez sesyjny
config `playwright.local-ipv6.config.ts` (NIE commitowany, usunięty po sesji).
CI wykona E2E standardowo na własnym serwerze.

## Weryfikacja

- ✅ lint 0 err · typecheck 0 err · unit 889/889 · **E2E 133 passed / 2 skipped / 0 failed** (pełna regresja, w tym book-source-photo-link, detection-list-views)
- ⏳ Manual 2.5 (user-only): deep-link na realnej kolekcji

## Werdykt

**PASS** — brak driftu kontraktowego, zero adaptacji wymagających powrotu do planu.
