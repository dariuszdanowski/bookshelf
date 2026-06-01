import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { classifyCropQuality } from '../lib/matching/fallbackPolicy';
import type { DetectionWithCandidatesDTO } from '../lib/photos/schema';

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

type Props = {
  photoUrl: string | null;
  detections: DetectionWithCandidatesDTO[];
  focusedDetectionId?: string | null;
};

export default function PhotoDetectionOverlay({ photoUrl, detections, focusedDetectionId = null }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [zoom, setZoom] = useState(1);
  const wheelViewportRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  const dragStateRef = useRef({
    dragging: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });

  // Keep zoomRef in sync so the native wheel handler never captures stale zoom.
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // React 17+ registers onWheel as passive — preventDefault() is ignored and warns.
  // Attach a native non-passive listener instead.
  useEffect(() => {
    const el = wheelViewportRef.current;
    if (!el) return;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const viewport = event.currentTarget as HTMLDivElement;
      const direction = event.deltaY < 0 ? 1 : -1;
      const currentZoom = zoomRef.current;
      const nextZoom = Math.max(1, Math.min(4, currentZoom + direction * 0.15));
      if (nextZoom === currentZoom) return;

      const rect = viewport.getBoundingClientRect();
      const focusX = event.clientX - rect.left;
      const focusY = event.clientY - rect.top;
      const ratio = nextZoom / currentZoom;

      setZoom(nextZoom);
      viewport.scrollLeft = Math.max(0, (viewport.scrollLeft + focusX) * ratio - focusX);
      viewport.scrollTop = Math.max(0, (viewport.scrollTop + focusY) * ratio - focusY);
    }

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  if (!photoUrl) return null;
  const resolvedPhotoUrl = photoUrl;

  const withBbox = detections.filter((d) => d.bbox !== null);
  const focused = focusedDetectionId ? detections.find((d) => d.id === focusedDetectionId) ?? null : null;
  const visibleDetections = focusedDetectionId ? withBbox.filter((d) => d.id === focusedDetectionId) : withBbox;

  function changeZoom(next: number) {
    setZoom(Math.max(1, Math.min(4, next)));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (zoom <= 1) return;

    const viewport = event.currentTarget;
    dragStateRef.current = {
      dragging: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
    // wheelViewportRef already points to this element via ref prop — no need to reassign.
    if (viewport.setPointerCapture) {
      viewport.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = dragStateRef.current;
    if (!state.dragging || state.pointerId !== event.pointerId || !wheelViewportRef.current) return;

    event.preventDefault();
    const viewport = wheelViewportRef.current;
    viewport.scrollLeft = state.startScrollLeft - (event.clientX - state.startX);
    viewport.scrollTop = state.startScrollTop - (event.clientY - state.startY);
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    const state = dragStateRef.current;
    if (state.pointerId !== event.pointerId) return;

    state.dragging = false;
    state.pointerId = -1;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function renderMarkers() {
    if (!imgLoaded || imgError || !showBoxes) return null;

    return visibleDetections.map((det) => {
      const b = det.bbox!;
      const x1 = clamp(b.x1);
      const y1 = clamp(b.y1);
      const x2 = clamp(b.x2);
      const y2 = clamp(b.y2);
      const w = Math.max(0, x2 - x1);
      const h = Math.max(0, y2 - y1);
      if (w === 0 || h === 0) return null;

      return (
        <div
          key={det.id}
          data-testid={`bbox-marker-${det.position_index}`}
          style={{
            position: 'absolute',
            left: `${x1 * 100}%`,
            top: `${y1 * 100}%`,
            width: `${w * 100}%`,
            height: `${h * 100}%`,
          }}
          className="pointer-events-none border-2 border-blue-500"
        >
          <span className="absolute -top-5 left-0 rounded bg-blue-500 px-1 py-0.5 text-xs leading-none font-bold text-white">
            #{det.position_index}
          </span>
        </div>
      );
    });
  }

  function renderPhotoLayer(withLoadHandlers: boolean) {
    return (
      <div className="relative block" style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
        <img
          src={resolvedPhotoUrl}
          alt="Zdjęcie półki z wykrytymi książkami"
          className="block h-auto w-full"
          onLoad={
            withLoadHandlers
              ? () => {
                  setImgLoaded(true);
                  setImgError(false);
                }
              : undefined
          }
          onError={
            withLoadHandlers
              ? () => {
                  setImgError(true);
                  setImgLoaded(false);
                }
              : undefined
          }
        />

        <div className="pointer-events-none absolute inset-0">{renderMarkers()}</div>
      </div>
    );
  }

  return (
    <div data-testid="photo-overlay" className="mb-4">
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="toggle-bboxes-button"
          onClick={() => setShowBoxes((v) => !v)}
          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {showBoxes ? 'Ukryj ramki' : 'Pokaż ramki'}
        </button>
        <button
          type="button"
          data-testid="zoom-out-button"
          onClick={() => changeZoom(zoom - 0.25)}
          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          -
        </button>
        <button
          type="button"
          data-testid="zoom-reset-button"
          onClick={() => setZoom(1)}
          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          data-testid="zoom-in-button"
          onClick={() => changeZoom(zoom + 0.25)}
          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          +
        </button>
      </div>

      <div
        ref={wheelViewportRef}
        data-testid="photo-overlay-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        className="scrollbar-hidden max-h-[72vh] w-full overflow-auto rounded-lg border border-gray-200 bg-gray-100 p-3 cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
      >
        {renderPhotoLayer(true)}
      </div>

      {withBbox.length > 0 && (
        <div className="mt-1 space-y-1 text-xs text-gray-400">
          <p>Numery ramek odpowiadają pozycjom (#N) na liście poniżej.</p>
          {focused && focused.bbox && (
            <p data-testid="focused-bbox-diagnostics">
              Fokus: #{focused.position_index} | bbox [{focused.bbox.x1.toFixed(3)}, {focused.bbox.y1.toFixed(3)}, {focused.bbox.x2.toFixed(3)}, {focused.bbox.y2.toFixed(3)}] | quality: {classifyCropQuality(focused.bbox)}
            </p>
          )}
          {focused && !focused.bbox && (
            <p data-testid="focused-bbox-missing">Fokus: #{focused.position_index} | brak bbox dla tej detekcji.</p>
          )}
        </div>
      )}
    </div>
  );
}
