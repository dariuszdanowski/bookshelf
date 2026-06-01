import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { classifyCropQuality } from '../lib/matching/fallbackPolicy';
import type { BboxCoords, BboxEditSet, DetectionWithCandidatesDTO } from '../lib/photos/schema';
import ConfirmDialog from './ConfirmDialog';


function MarkerTooltip({ det }: { det: DetectionWithCandidatesDTO }) {
  const top = det.candidates[0];
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-[11px] font-semibold text-gray-500">#{det.position_index} — odczyt</p>
      <p className="mt-0.5 truncate text-sm font-bold text-gray-900">
        {det.raw_title || <span className="italic text-gray-400">brak tytułu</span>}
      </p>
      {top ? (
        <div className="mt-1.5 border-t border-gray-100 pt-1.5">
          <p className="text-[11px] font-semibold text-gray-500">Top propozycja</p>
          <p className="mt-0.5 truncate text-xs font-medium text-gray-800">{top.title}</p>
          {top.authors.length > 0 && (
            <p className="truncate text-[11px] text-gray-500">{top.authors.join(', ')}</p>
          )}
          <p className="mt-1 text-[11px] font-semibold text-green-600">
            Dopasowanie: {Math.round(top.matchScore * 100)}%
          </p>
        </div>
      ) : (
        <p className="mt-1 text-[11px] italic text-gray-400">brak propozycji</p>
      )}
    </div>
  );
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_FIELDS: Record<ResizeHandle, { x1?: true; y1?: true; x2?: true; y2?: true }> = {
  nw: { x1: true, y1: true },
  n: { y1: true },
  ne: { x2: true, y1: true },
  e: { x2: true },
  se: { x2: true, y2: true },
  s: { y2: true },
  sw: { x1: true, y2: true },
  w: { x1: true },
};

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
  e: 'e-resize', se: 'se-resize', s: 's-resize',
  sw: 'sw-resize', w: 'w-resize',
};

const HANDLE_STYLE: Record<ResizeHandle, React.CSSProperties> = {
  nw: { top: 0, left: 0, transform: 'translate(-50%, -50%)' },
  n: { top: 0, left: '50%', transform: 'translate(-50%, -50%)' },
  ne: { top: 0, left: '100%', transform: 'translate(-50%, -50%)' },
  e: { top: '50%', left: '100%', transform: 'translate(-50%, -50%)' },
  se: { top: '100%', left: '100%', transform: 'translate(-50%, -50%)' },
  s: { top: '100%', left: '50%', transform: 'translate(-50%, -50%)' },
  sw: { top: '100%', left: 0, transform: 'translate(-50%, -50%)' },
  w: { top: '50%', left: 0, transform: 'translate(-50%, -50%)' },
};

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandle[];

type Props = {
  photoUrl: string | null;
  detections: DetectionWithCandidatesDTO[];
  focusedDetectionId?: string | null;
  onClearFocus?: () => void;
  isEditing?: boolean;
  onEditingChange?: (v: boolean) => void;
  onApplyEdits?: (changes: BboxEditSet) => Promise<void>;
  onMarkerContextMenu?: (detectionId: string) => void;
};

export default function PhotoDetectionOverlay({
  photoUrl,
  detections,
  focusedDetectionId = null,
  onClearFocus,
  isEditing = false,
  onEditingChange,
  onApplyEdits,
  onMarkerContextMenu,
}: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [hoveredDetId, setHoveredDetId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit mode — accumulated changes for current session
  const [updatedBboxes, setUpdatedBboxes] = useState<Record<string, BboxCoords>>({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [addedBboxes, setAddedBboxes] = useState<BboxCoords[]>([]);
  const [draft, setDraft] = useState<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const wheelViewportRef = useRef<HTMLDivElement | null>(null);
  const imgContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  const isEditingRef = useRef(isEditing);
  const resizingRef = useRef<{
    id: string;
    handle: ResizeHandle;
    original: BboxCoords;
    startNorm: { x: number; y: number };
  } | null>(null);
  const movingRef = useRef<{
    id: string;
    original: BboxCoords;
    startNorm: { x: number; y: number };
  } | null>(null);
  const dragStateRef = useRef({
    dragging: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  // Reset edit state on edit mode exit (zoom preserved intentionally)
  useEffect(() => {
    if (!isEditing) {
      setUpdatedBboxes({});
      setRemovedIds([]);
      setAddedBboxes([]);
      setDraft(null);
      resizingRef.current = null;
      movingRef.current = null;
    }
  }, [isEditing]);

  // Native wheel listener (non-passive) — disabled in edit mode via ref
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

  function normCoords(clientX: number, clientY: number): { x: number; y: number } {
    const el = imgContainerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / rect.width),
      y: clamp((clientY - rect.top) / rect.height),
    };
  }

  function getBboxById(id: string): BboxCoords | null {
    if (id.startsWith('added:')) {
      const idx = parseInt(id.slice(6), 10);
      return addedBboxes[idx] ?? null;
    }
    return updatedBboxes[id] ?? detections.find((d) => d.id === id)?.bbox ?? null;
  }

  function applyBboxEdit(id: string, newBbox: BboxCoords) {
    if (id.startsWith('added:')) {
      const idx = parseInt(id.slice(6), 10);
      setAddedBboxes((prev) => prev.map((b, i) => (i === idx ? newBbox : b)));
    } else {
      setUpdatedBboxes((prev) => ({ ...prev, [id]: newBbox }));
    }
  }

  function startResize(id: string, handle: ResizeHandle, e: React.PointerEvent) {
    e.stopPropagation();
    const bbox = getBboxById(id);
    if (!bbox) return;
    resizingRef.current = { id, handle, original: { ...bbox }, startNorm: normCoords(e.clientX, e.clientY) };
    // Capture on viewport so onPointerMove fires on the container
    if (wheelViewportRef.current?.setPointerCapture) {
      wheelViewportRef.current.setPointerCapture(e.pointerId);
    }
  }

  function startMove(id: string, e: React.PointerEvent) {
    e.stopPropagation();
    const bbox = getBboxById(id);
    if (!bbox) return;
    movingRef.current = { id, original: { ...bbox }, startNorm: normCoords(e.clientX, e.clientY) };
    if (wheelViewportRef.current?.setPointerCapture) {
      wheelViewportRef.current.setPointerCapture(e.pointerId);
    }
  }

  function handleMarkerEnter(id: string) {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoveredDetId(id), 1000);
  }

  function handleMarkerLeave() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredDetId(null);
  }

  function handleContainerPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (isEditing) {
      if (e.button !== 0) return;
      // Only start drawing if the event wasn't stopped by a marker/handle
      const norm = normCoords(e.clientX, e.clientY);
      setDraft({ start: norm, current: norm });
      if (e.currentTarget.setPointerCapture) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }

    if (zoom <= 1) return;
    if (e.button !== 0) return;
    const viewport = e.currentTarget;
    dragStateRef.current = {
      dragging: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
    if (viewport.setPointerCapture) {
      viewport.setPointerCapture(e.pointerId);
    }
  }

  function handleContainerPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!isEditing) {
      const state = dragStateRef.current;
      if (!state.dragging || state.pointerId !== e.pointerId || !wheelViewportRef.current) return;
      e.preventDefault();
      const viewport = wheelViewportRef.current;
      viewport.scrollLeft = state.startScrollLeft - (e.clientX - state.startX);
      viewport.scrollTop = state.startScrollTop - (e.clientY - state.startY);
      return;
    }

    const rs = resizingRef.current;
    if (rs) {
      const cur = normCoords(e.clientX, e.clientY);
      const dx = cur.x - rs.startNorm.x;
      const dy = cur.y - rs.startNorm.y;
      const fields = HANDLE_FIELDS[rs.handle];
      const MIN = 0.01;
      let { x1, y1, x2, y2 } = rs.original;
      if (fields.x1) x1 = clamp(rs.original.x1 + dx);
      if (fields.y1) y1 = clamp(rs.original.y1 + dy);
      if (fields.x2) x2 = clamp(rs.original.x2 + dx);
      if (fields.y2) y2 = clamp(rs.original.y2 + dy);
      if (x2 - x1 < MIN) { if (fields.x1) x1 = x2 - MIN; else x2 = x1 + MIN; }
      if (y2 - y1 < MIN) { if (fields.y1) y1 = y2 - MIN; else y2 = y1 + MIN; }
      applyBboxEdit(rs.id, { x1: clamp(x1), y1: clamp(y1), x2: clamp(x2), y2: clamp(y2) });
      return;
    }

    const mv = movingRef.current;
    if (mv) {
      const cur = normCoords(e.clientX, e.clientY);
      const dx = cur.x - mv.startNorm.x;
      const dy = cur.y - mv.startNorm.y;
      const { x1, y1, x2, y2 } = mv.original;
      const w = x2 - x1;
      const h = y2 - y1;
      const newX1 = clamp(x1 + dx);
      const newY1 = clamp(y1 + dy);
      applyBboxEdit(mv.id, {
        x1: newX1,
        y1: newY1,
        x2: clamp(Math.min(1, newX1 + w)),
        y2: clamp(Math.min(1, newY1 + h)),
      });
      return;
    }

    if (draft) {
      const cur = normCoords(e.clientX, e.clientY);
      setDraft((prev) => (prev ? { ...prev, current: cur } : null));
    }
  }

  function handleContainerPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (isEditing) {
      if (draft) {
        const x1 = Math.min(draft.start.x, draft.current.x);
        const y1 = Math.min(draft.start.y, draft.current.y);
        const x2 = Math.max(draft.start.x, draft.current.x);
        const y2 = Math.max(draft.start.y, draft.current.y);
        if (Math.abs(x2 - x1) > 0.01 && Math.abs(y2 - y1) > 0.01) {
          setAddedBboxes((prev) => [...prev, { x1, y1, x2, y2 }]);
        }
        setDraft(null);
      }
      resizingRef.current = null;
      movingRef.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const state = dragStateRef.current;
    if (state.pointerId !== e.pointerId) return;
    state.dragging = false;
    state.pointerId = -1;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function hasUnsavedChanges(): boolean {
    return (
      Object.keys(updatedBboxes).length > 0 ||
      removedIds.length > 0 ||
      addedBboxes.length > 0
    );
  }

  async function handleApply() {
    if (!onApplyEdits) return;
    setApplyBusy(true);
    const changes: BboxEditSet = {
      updated: Object.entries(updatedBboxes).map(([id, bbox]) => ({ detectionId: id, bbox })),
      removed: removedIds.map((id) => ({ detectionId: id })),
      added: addedBboxes.map((bbox) => ({ bbox })),
    };
    try {
      await onApplyEdits(changes);
    } finally {
      setApplyBusy(false);
      onEditingChange?.(false);
    }
  }

  function renderEditMarkers(): React.ReactNode[] {
    const elements: React.ReactNode[] = [];

    for (const det of detections) {
      if (removedIds.includes(det.id)) continue;
      const bbox = updatedBboxes[det.id] ?? det.bbox;
      if (!bbox) continue;

      const x1 = clamp(bbox.x1);
      const y1 = clamp(bbox.y1);
      const x2 = clamp(bbox.x2);
      const y2 = clamp(bbox.y2);
      const w = Math.max(0, x2 - x1);
      const h = Math.max(0, y2 - y1);
      if (w === 0 || h === 0) continue;

      const quality = classifyCropQuality(bbox);
      const isUncertain = quality === 'uncertain_localization';

      elements.push(
        <div
          key={det.id}
          data-testid={`bbox-marker-${det.position_index}`}
          style={{ position: 'absolute', left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, cursor: 'move' }}
          className={`border-2 ${isUncertain ? 'border-amber-400' : 'border-blue-500'} pointer-events-auto overflow-visible`}
          onPointerDown={(e) => { if (e.button === 0) startMove(det.id, e); }}
          onPointerEnter={() => handleMarkerEnter(det.id)}
          onPointerLeave={handleMarkerLeave}
          onContextMenu={(e) => { e.preventDefault(); if (e.ctrlKey) onMarkerContextMenu?.(det.id); }}
        >
          {hoveredDetId === det.id && <MarkerTooltip det={det} />}
          <span className="pointer-events-none absolute -top-5 left-0 rounded bg-blue-500 px-1 py-0.5 text-xs leading-none font-bold text-white">
            #{det.position_index}
          </span>

          {isUncertain && (
            <span className="pointer-events-none absolute -bottom-5 left-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] leading-none text-amber-700">
              niepewny
            </span>
          )}

          <button
            type="button"
            data-testid={`bbox-delete-${det.position_index}`}
            className="absolute -right-2 -top-2 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white hover:bg-red-600"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setRemovedIds((prev) => [...prev, det.id])}
          >
            ×
          </button>

          {HANDLES.map((dir) => (
            <div
              key={dir}
              data-testid={`bbox-handle-${det.position_index}-${dir}`}
              style={{
                position: 'absolute',
                width: '8px',
                height: '8px',
                backgroundColor: 'white',
                border: '1px solid #3b82f6',
                borderRadius: '1px',
                cursor: HANDLE_CURSORS[dir],
                ...HANDLE_STYLE[dir],
              }}
              onPointerDown={(e) => startResize(det.id, dir, e)}
            />
          ))}
        </div>
      );
    }

    // Added bboxes (new, not yet persisted)
    addedBboxes.forEach((bbox, idx) => {
      const x1 = clamp(bbox.x1);
      const y1 = clamp(bbox.y1);
      const x2 = clamp(bbox.x2);
      const y2 = clamp(bbox.y2);
      const w = Math.max(0, x2 - x1);
      const h = Math.max(0, y2 - y1);
      if (w === 0 || h === 0) return;

      elements.push(
        <div
          key={`added-${idx}`}
          style={{ position: 'absolute', left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, cursor: 'move' }}
          className="pointer-events-auto border-2 border-green-500"
          onPointerDown={(e) => { if (e.button === 0) startMove(`added:${idx}`, e); }}
        >
          <span className="pointer-events-none absolute -top-5 left-0 rounded bg-green-500 px-1 py-0.5 text-xs leading-none font-bold text-white">
            +
          </span>
          <button
            type="button"
            className="absolute -right-2 -top-2 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white hover:bg-red-600"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setAddedBboxes((prev) => prev.filter((_, i) => i !== idx))}
          >
            ×
          </button>
          {HANDLES.map((dir) => (
            <div
              key={dir}
              style={{
                position: 'absolute',
                width: '8px',
                height: '8px',
                backgroundColor: 'white',
                border: '1px solid #22c55e',
                borderRadius: '1px',
                cursor: HANDLE_CURSORS[dir],
                ...HANDLE_STYLE[dir],
              }}
              onPointerDown={(e) => startResize(`added:${idx}`, dir, e)}
            />
          ))}
        </div>
      );
    });

    // Draft rectangle while drawing
    if (draft) {
      const x1 = Math.min(draft.start.x, draft.current.x);
      const y1 = Math.min(draft.start.y, draft.current.y);
      const x2 = Math.max(draft.start.x, draft.current.x);
      const y2 = Math.max(draft.start.y, draft.current.y);
      elements.push(
        <div
          key="draft"
          data-testid="bbox-draft"
          className="pointer-events-none absolute border-2 border-dashed border-green-400"
          style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}
        />
      );
    }

    return elements;
  }

  function renderMarkers() {
    if (!imgLoaded || imgError || !showBoxes) return null;

    if (isEditing) {
      return renderEditMarkers();
    }

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
          style={{ position: 'absolute', left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          className="pointer-events-auto border-2 border-blue-500 overflow-visible"
          onPointerEnter={() => handleMarkerEnter(det.id)}
          onPointerLeave={handleMarkerLeave}
          onContextMenu={(e) => { e.preventDefault(); if (e.ctrlKey) onMarkerContextMenu?.(det.id); }}
        >
          {hoveredDetId === det.id && <MarkerTooltip det={det} />}
          <span className="absolute -top-5 left-0 rounded bg-blue-500 px-1 py-0.5 text-xs leading-none font-bold text-white">
            #{det.position_index}
          </span>
        </div>
      );
    });
  }

  function renderPhotoLayer(withLoadHandlers: boolean) {
    return (
      <div ref={imgContainerRef} className="relative block" style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
        <img
          src={resolvedPhotoUrl}
          alt="Zdjęcie półki z wykrytymi książkami"
          draggable={false}
          className="block h-auto w-full select-none"
          onLoad={withLoadHandlers ? () => { setImgLoaded(true); setImgError(false); } : undefined}
          onError={withLoadHandlers ? () => { setImgError(true); setImgLoaded(false); } : undefined}
        />
        <div className={`absolute inset-0 ${isEditing ? '' : 'pointer-events-none'}`}>
          {renderMarkers()}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="photo-overlay" className="mb-4">
      <div className="mb-2 flex flex-wrap gap-2">
        {isEditing ? (
          <>
            <button
              type="button"
              data-testid="apply-bbox-edits-button"
              disabled={applyBusy}
              onClick={() => void handleApply()}
              className="rounded border border-green-600 bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {applyBusy ? 'Zapisuję...' : 'Zastosuj zmiany'}
            </button>
            <button
              type="button"
              data-testid="cancel-bbox-edits-button"
              disabled={applyBusy}
              onClick={() => {
                if (hasUnsavedChanges()) {
                  setConfirmCancelOpen(true);
                } else {
                  onEditingChange?.(false);
                }
              }}
              className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Anuluj
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              data-testid="edit-bboxes-button"
              onClick={() => onEditingChange?.(true)}
              className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Edytuj ramki
            </button>
            <button
              type="button"
              data-testid="toggle-bboxes-button"
              onClick={() => setShowBoxes((v) => !v)}
              className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {showBoxes ? 'Ukryj ramki' : 'Pokaż ramki'}
            </button>
            {focusedDetectionId && onClearFocus && (
              <button
                type="button"
                data-testid="clear-focus-button"
                onClick={onClearFocus}
                className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Pokaż wszystkie detekcje
              </button>
            )}
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
          </>
        )}
      </div>

      {!isEditing && withBbox.length > 0 && (
        <div className="mb-2 space-y-0.5 text-xs text-gray-400">
          <p>Numery ramek odpowiadają pozycjom (#N) na liście poniżej.</p>
          {focused && focused.bbox && (
            <p data-testid="focused-bbox-diagnostics">
              Fokus: #{focused.position_index}
              {focused.raw_title ? ` — ${focused.raw_title}` : ''}
              {focused.candidates[0] ? ` → ${focused.candidates[0].title}` : ''}
              {' '}| bbox [{focused.bbox.x1.toFixed(3)}, {focused.bbox.y1.toFixed(3)}, {focused.bbox.x2.toFixed(3)}, {focused.bbox.y2.toFixed(3)}] | quality: {classifyCropQuality(focused.bbox)}
            </p>
          )}
          {focused && !focused.bbox && (
            <p data-testid="focused-bbox-missing">Fokus: #{focused.position_index} | brak bbox dla tej detekcji.</p>
          )}
        </div>
      )}

      <div
        ref={wheelViewportRef}
        data-testid="photo-overlay-viewport"
        onPointerDown={handleContainerPointerDown}
        onPointerMove={handleContainerPointerMove}
        onPointerUp={handleContainerPointerUp}
        onPointerCancel={handleContainerPointerUp}
        className={`scrollbar-hidden max-h-[72vh] w-full overflow-auto rounded-lg border border-gray-200 bg-gray-100 p-3 select-none ${isEditing ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
        style={{ touchAction: 'none' }}
      >
        {renderPhotoLayer(true)}
      </div>

      <ConfirmDialog
        open={confirmCancelOpen}
        title="Odrzucić zmiany?"
        message="Masz niezapisane zmiany ramek. Kliknij Potwierdź, żeby je odrzucić."
        confirmLabel="Odrzuć zmiany"
        cancelLabel="Wróć do edycji"
        testIdPrefix="cancel-edit-confirm"
        onCancel={() => setConfirmCancelOpen(false)}
        onConfirm={() => {
          setConfirmCancelOpen(false);
          onEditingChange?.(false);
        }}
      />
    </div>
  );
}
