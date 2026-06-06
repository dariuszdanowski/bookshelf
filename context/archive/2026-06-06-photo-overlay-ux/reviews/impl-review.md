# Impl-review — photo-overlay-ux (S-24)

**Data:** 2026-06-07
**Reviewer:** agent (Opus), Fast track
**Zakres:** commit `e12ee94` vs `plan.md`

## Zgodność plan ↔ implementacja

| Kontrakt | Stan |
| --- | --- |
| `PhotoLightbox` — props, ramki % z bbox 0..1, Esc/tło/✕, testidy | ✅ |
| Trigger: klik w img, guard edit/single-edit, klik-vs-drag 5 px (`lastPointerDownRef` — F1 z plan-review) | ✅ |
| `cursor-zoom-in` poza edycją; `visibleDetections` (fokus S-18/S-37) do lightboxa | ✅ |
| Testy: 6 PhotoLightbox + 4 overlay + 3 E2E | ✅ |

## Findings

### F1 (LOW, zaaplikowane w trakcie) — bąbelkowanie ✕ do backdropu

Klik ✕ propagował do backdropu → podwójny `onClose`. Fix: `stopPropagation`
w handlerze przycisku. Wykryte testem unit przed commitem.

## Weryfikacja

- ✅ lint · typecheck 0 err · unit **894/894** · E2E **133 passed / 0 failed**
- ⏳ Manual 1.5 (user-only): lightbox na realnym zdjęciu półki

## Werdykt

**PASS** — scope-reduced zgodnie z notą alignment roadmapy (toggle ramek istniał);
zero driftu kontraktowego.
