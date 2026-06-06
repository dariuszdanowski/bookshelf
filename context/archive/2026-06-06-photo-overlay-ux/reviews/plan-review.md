<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-24 photo-overlay-ux (lightbox)

- **Plan**: context/changes/photo-overlay-ux/plan.md
- **Mode**: Quick (scope S, pure UI)
- **Date**: 2026-06-06
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 1 observation

## Grounding

3/3 paths ✓ (PhotoDetectionOverlay.tsx — viewport/pan/img czytane bezpośrednio;
ConfirmDialog pattern; PhotoDetectionOverlay.test.tsx istnieje). Zweryfikowane:
pan-drag startuje TYLKO przy `zoom > 1` (`handleContainerPointerDown:314`),
markery non-edit `pointer-events-none` (klik trafia w img), bbox 0..1 → % positioning.

## Findings

### F1 — Trigger klik-vs-drag: dragStateRef jest gated na zoom>1

- **Severity**: 🔍 OBSERVATION · **Impact**: 🏃 LOW
- **Detail**: plan wskazywał `dragStateRef.startX/Y` jako źródło pozycji pointerdown,
  ale ref jest wypełniany tylko przy zoom>1 — przy zoom 1 klik miałby stale dane.
- **Fix**: własny `lastPointerDownRef` ustawiany na POCZĄTKU `handleContainerPointerDown`
  (przed wszystkimi guardami); próg 5 px w handlerze click.
- **Decision**: FIXED (auto-apply, Fast track)
