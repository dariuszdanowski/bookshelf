import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

import { classifyCropQuality } from '../lib/matching/fallbackPolicy';
import type { BboxCoords, BboxEditSet, DetectionWithCandidatesDTO } from '../lib/photos/schema';
import ConfirmDialog from './ConfirmDialog';
// M23: trigger lightboxa wyłączony na życzenie usera (2026-06-07) — zoom/pan +
// pinch na miejscu wystarczają. Komponent PhotoLightbox + jego testy zostają
// w repo (wyłącz, nie kasuj); przywrócenie = re-import + onClick na <img>.

const TOOLTIP_W = 224; // w-56 = 14rem
const TOOLTIP_H = 148; // estimated max height

function MarkerTooltip({
  det,
  mousePos,
}: {
  det: DetectionWithCandidatesDTO;
  mousePos: { x: number; y: number };
}) {
  const top = det.candidates[0];

  // Position above-right of cursor, clamped to viewport
  const GAP = 14;
  let left = mousePos.x + GAP;
  let tooltipTop = mousePos.y - TOOLTIP_H - GAP;

  if (left + TOOLTIP_W > window.innerWidth - 8) left = mousePos.x - TOOLTIP_W - GAP;
  if (left < 8) left = 8;
  if (tooltipTop < 8) tooltipTop = mousePos.y + GAP;

  return (
    <div
      data-testid="marker-tooltip"
      className="pointer-events-none fixed z-50 w-56 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg"
      style={{ left, top: tooltipTop }}
    >
      <p className="text-[11px] font-semibold text-gray-500">#{det.position_index} — odczyt</p>
      <p className="mt-0.5 truncate text-sm font-bold text-gray-900">
        {det.raw_title || <span className="text-gray-400 italic">brak tytułu</span>}
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
        <p className="mt-1 text-[11px] text-gray-400 italic">brak propozycji</p>
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
  nw: 'nw-resize',
  n: 'n-resize',
  ne: 'ne-resize',
  e: 'e-resize',
  se: 'se-resize',
  s: 's-resize',
  sw: 'sw-resize',
  w: 'w-resize',
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
  onSaveSingleBbox?: (detectionId: string, bbox: BboxCoords) => Promise<void>;
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
  onSaveSingleBbox,
}: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [zoom, setZoom] = useState(1);
  // M24: bazowa skala "fit-to-container" — zoom=1 to CAŁE zdjęcie w oknie
  // (contain), nie fit-to-width. Dla poziomych zdjęć półek fitScale=1 (bez
  // zmiany zachowania); dla pionowych (pojedyncza książka z telefonu) <1,
  // żeby portret nie renderował się ~3× wyżej niż okno na desktopie.
  const [fitScale, setFitScale] = useState(1);
  const [hoveredDetId, setHoveredDetId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit mode — accumulated changes for current session
  const [updatedBboxes, setUpdatedBboxes] = useState<Record<string, BboxCoords>>({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [addedBboxes, setAddedBboxes] = useState<BboxCoords[]>([]);
  const [draft, setDraft] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Single-marker edit (per-marker, bez globalnego trybu edycji)
  const [singleEditId, setSingleEditId] = useState<string | null>(null);
  const [singleEditBbox, setSingleEditBbox] = useState<BboxCoords | null>(null);
  const [singleEditBusy, setSingleEditBusy] = useState(false);

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
  // M6: pinch-zoom na dotyku — touch-action:none blokuje natywny gest, więc
  // obsługujemy go sami: mapa aktywnych pointerów + dystans/zoom startowy.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  // M24: naturalne wymiary obrazu (z onLoad) do przeliczania fitScale przy resize
  const naturalDimsRef = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  // Reset edit state on edit mode entry/exit (zoom preserved intentionally)
  useEffect(() => {
    if (isEditing) {
      setSingleEditId(null);
      setSingleEditBbox(null);
    } else {
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

  // M24: fitScale = ułamek szerokości okna, przy którym całe zdjęcie mieści
  // się w max-height kontenera (contain). 1 dla poziomych zdjęć półek.
  const recomputeFitScale = useCallback(() => {
    const viewport = wheelViewportRef.current;
    const dims = naturalDimsRef.current;
    if (!viewport || !dims || !dims.w || !dims.h) return;
    const styles = getComputedStyle(viewport);
    const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const availW = viewport.clientWidth - padX;
    const maxH = parseFloat(styles.maxHeight) - padY;
    if (!availW || !Number.isFinite(maxH) || maxH <= 0) return;
    const fitW = Math.min(availW, maxH * (dims.w / dims.h));
    setFitScale(Math.min(1, fitW / availW));
  }, []);

  useEffect(() => {
    window.addEventListener('resize', recomputeFitScale);
    return () => window.removeEventListener('resize', recomputeFitScale);
  }, [recomputeFitScale]);

  if (!photoUrl) return null;
  const resolvedPhotoUrl = photoUrl;

  const withBbox = detections.filter((d) => d.bbox !== null);
  const focused = focusedDetectionId
    ? (detections.find((d) => d.id === focusedDetectionId) ?? null)
    : null;
  const visibleDetections = focusedDetectionId
    ? withBbox.filter((d) => d.id === focusedDetectionId)
    : withBbox;

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
    if (singleEditId === id && singleEditBbox) return singleEditBbox;
    if (id.startsWith('added:')) {
      const idx = parseInt(id.slice(6), 10);
      return addedBboxes[idx] ?? null;
    }
    return updatedBboxes[id] ?? detections.find((d) => d.id === id)?.bbox ?? null;
  }

  function applyBboxEdit(id: string, newBbox: BboxCoords) {
    if (singleEditId === id) {
      setSingleEditBbox(newBbox);
      return;
    }
    if (id.startsWith('added:')) {
      const idx = parseInt(id.slice(6), 10);
      setAddedBboxes((prev) => prev.map((b, i) => (i === idx ? newBbox : b)));
    } else {
      setUpdatedBboxes((prev) => ({ ...prev, [id]: newBbox }));
    }
  }

  function clearSingleEditRefs() {
    resizingRef.current = null;
    movingRef.current = null;
  }

  async function handleSingleEditSave() {
    if (!singleEditId || !singleEditBbox) return;
    setSingleEditBusy(true);
    clearSingleEditRefs();
    try {
      await onSaveSingleBbox?.(singleEditId, singleEditBbox);
      setSingleEditId(null);
      setSingleEditBbox(null);
    } finally {
      setSingleEditBusy(false);
    }
  }

  function startResize(id: string, handle: ResizeHandle, e: React.PointerEvent) {
    e.stopPropagation();
    const bbox = getBboxById(id);
    if (!bbox) return;
    resizingRef.current = {
      id,
      handle,
      original: { ...bbox },
      startNorm: normCoords(e.clientX, e.clientY),
    };
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

  function handleMarkerEnter(id: string, e: React.PointerEvent) {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setMousePos({ x: e.clientX, y: e.clientY });
    hoverTimerRef.current = setTimeout(() => setHoveredDetId(id), 1000);
  }

  function handleMarkerMove(e: React.PointerEvent) {
    setMousePos({ x: e.clientX, y: e.clientY });
  }

  function handleMarkerLeave() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredDetId(null);
  }

  function handleContainerPointerDown(e: PointerEvent<HTMLDivElement>) {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // M6: drugi palec (poza trybami edycji) startuje pinch i przerywa pan
    if (!isEditing && !singleEditId && pointersRef.current.size === 2) {
      const [p1, p2] = [...pointersRef.current.values()];
      pinchRef.current = {
        startDist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        startZoom: zoomRef.current,
      };
      dragStateRef.current.dragging = false;
      dragStateRef.current.pointerId = -1;
      if (e.currentTarget.setPointerCapture) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
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
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    // M6: aktywny pinch — zoom z punktem skupienia w środku gestu (jak wheel-handler)
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2 && wheelViewportRef.current) {
      const [p1, p2] = [...pointersRef.current.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (pinch.startDist > 0) {
        const next = Math.max(1, Math.min(4, pinch.startZoom * (dist / pinch.startDist)));
        if (next !== zoomRef.current) {
          const viewport = wheelViewportRef.current;
          const rect = viewport.getBoundingClientRect();
          const fx = (p1.x + p2.x) / 2 - rect.left;
          const fy = (p1.y + p2.y) / 2 - rect.top;
          const ratio = next / zoomRef.current;
          setZoom(next);
          zoomRef.current = next; // ref od razu — kolejne move'y liczą od świeżej wartości
          viewport.scrollLeft = Math.max(0, (viewport.scrollLeft + fx) * ratio - fx);
          viewport.scrollTop = Math.max(0, (viewport.scrollTop + fy) * ratio - fy);
        }
      }
      return;
    }

    // Resize i move działają zarówno w globalnym edit mode jak i w single-edit
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
      if (x2 - x1 < MIN) {
        if (fields.x1) x1 = x2 - MIN;
        else x2 = x1 + MIN;
      }
      if (y2 - y1 < MIN) {
        if (fields.y1) y1 = y2 - MIN;
        else y2 = y1 + MIN;
      }
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

    if (isEditing) {
      if (draft) {
        const cur = normCoords(e.clientX, e.clientY);
        setDraft((prev) => (prev ? { ...prev, current: cur } : null));
      }
      return;
    }

    // Tryb podglądu (z panning gdy zoom > 1)
    const state = dragStateRef.current;
    if (!state.dragging || state.pointerId !== e.pointerId || !wheelViewportRef.current) return;
    e.preventDefault();
    const viewport = wheelViewportRef.current;
    viewport.scrollLeft = state.startScrollLeft - (e.clientX - state.startX);
    viewport.scrollTop = state.startScrollTop - (e.clientY - state.startY);
  }

  function handleContainerPointerUp(e: PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(e.pointerId);
    // M6: koniec gestu pinch gdy zostaje mniej niż 2 palce
    if (pinchRef.current && pointersRef.current.size < 2) {
      pinchRef.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }
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

    // Single-edit resize/move — wyczyść refy po zwolnieniu przycisku
    if (resizingRef.current || movingRef.current) {
      resizingRef.current = null;
      movingRef.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    // Pan cleanup
    const state = dragStateRef.current;
    if (state.pointerId !== e.pointerId) return;
    state.dragging = false;
    state.pointerId = -1;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function hasUnsavedChanges(): boolean {
    return Object.keys(updatedBboxes).length > 0 || removedIds.length > 0 || addedBboxes.length > 0;
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
          style={{
            position: 'absolute',
            left: `${x1 * 100}%`,
            top: `${y1 * 100}%`,
            width: `${w * 100}%`,
            height: `${h * 100}%`,
            cursor: 'move',
          }}
          className={`border-2 ${isUncertain ? 'border-amber-400' : 'border-blue-500'} pointer-events-auto overflow-visible`}
          onPointerDown={(e) => {
            if (e.button === 0) startMove(det.id, e);
          }}
          onPointerEnter={(e) => handleMarkerEnter(det.id, e)}
          onPointerMove={handleMarkerMove}
          onPointerLeave={handleMarkerLeave}
          onContextMenu={(e) => {
            e.preventDefault();
            if (e.ctrlKey) onMarkerContextMenu?.(det.id);
          }}
        >
          {hoveredDetId === det.id && <MarkerTooltip det={det} mousePos={mousePos} />}
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
            title="Przejdź do propozycji na liście"
            className="absolute -top-2 -left-2 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onMarkerContextMenu?.(det.id)}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <line x1="1" y1="3" x2="9" y2="3" />
              <line x1="1" y1="6" x2="9" y2="6" />
              <line x1="1" y1="9" x2="6" y2="9" />
            </svg>
          </button>
          <button
            type="button"
            data-testid={`bbox-delete-${det.position_index}`}
            className="absolute -top-2 -right-2 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white hover:bg-red-600"
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
        </div>,
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
          style={{
            position: 'absolute',
            left: `${x1 * 100}%`,
            top: `${y1 * 100}%`,
            width: `${w * 100}%`,
            height: `${h * 100}%`,
            cursor: 'move',
          }}
          className="pointer-events-auto border-2 border-green-500"
          onPointerDown={(e) => {
            if (e.button === 0) startMove(`added:${idx}`, e);
          }}
        >
          <span className="pointer-events-none absolute -top-5 left-0 rounded bg-green-500 px-1 py-0.5 text-xs leading-none font-bold text-white">
            +
          </span>
          <button
            type="button"
            className="absolute -top-2 -right-2 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white hover:bg-red-600"
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
        </div>,
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
          style={{
            left: `${x1 * 100}%`,
            top: `${y1 * 100}%`,
            width: `${(x2 - x1) * 100}%`,
            height: `${(y2 - y1) * 100}%`,
          }}
        />,
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
      const isInSingleEdit = singleEditId === det.id;
      const activeBbox = isInSingleEdit && singleEditBbox ? singleEditBbox : det.bbox;
      if (!activeBbox) return null;

      const x1 = clamp(activeBbox.x1);
      const y1 = clamp(activeBbox.y1);
      const x2 = clamp(activeBbox.x2);
      const y2 = clamp(activeBbox.y2);
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
          className={`pointer-events-auto overflow-visible border-2 ${isInSingleEdit ? 'cursor-move border-amber-500' : 'border-blue-500'}`}
          onPointerEnter={(e) => handleMarkerEnter(det.id, e)}
          onPointerMove={handleMarkerMove}
          onPointerLeave={handleMarkerLeave}
          onPointerDown={(e) => {
            if (isInSingleEdit && e.button === 0) startMove(det.id, e);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (e.ctrlKey) onMarkerContextMenu?.(det.id);
          }}
        >
          {hoveredDetId === det.id && !isInSingleEdit && (
            <MarkerTooltip det={det} mousePos={mousePos} />
          )}

          {/* Tryb edycji pojedynczej ramki */}
          {isInSingleEdit && (
            <>
              <button
                type="button"
                data-testid={`single-edit-save-${det.position_index}`}
                title="Zapisz zmianę ramki"
                disabled={singleEditBusy}
                className="absolute -top-2 -left-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void handleSingleEditSave()}
              >
                {singleEditBusy ? '…' : '✓'}
              </button>
              <button
                type="button"
                data-testid={`single-edit-cancel-${det.position_index}`}
                title="Anuluj edycję"
                disabled={singleEditBusy}
                className="absolute -top-2 -right-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-gray-400 text-[11px] text-white hover:bg-gray-500 disabled:opacity-50"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  clearSingleEditRefs();
                  setSingleEditId(null);
                  setSingleEditBbox(null);
                }}
              >
                ×
              </button>
              {HANDLES.map((dir) => (
                <div
                  key={dir}
                  data-testid={`bbox-handle-${det.position_index}-${dir}`}
                  style={{
                    position: 'absolute',
                    width: '10px',
                    height: '10px',
                    backgroundColor: 'white',
                    border: '2px solid #f59e0b',
                    borderRadius: '2px',
                    cursor: HANDLE_CURSORS[dir],
                    ...HANDLE_STYLE[dir],
                  }}
                  onPointerDown={(e) => startResize(det.id, dir, e)}
                />
              ))}
            </>
          )}

          {/* Przyciski w trybie podglądu (brak single-edit) */}
          {!isInSingleEdit && (
            <>
              {/* Pencil — wejście w edycję tej ramki */}
              {!singleEditId && (
                <button
                  type="button"
                  data-testid={`single-edit-enter-${det.position_index}`}
                  title="Edytuj tę ramkę"
                  className="absolute -top-2 -left-2 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white hover:bg-amber-600"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSingleEditId(det.id);
                    setSingleEditBbox(activeBbox);
                  }}
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8.5 1.5l2 2-6.5 6.5H2V7.5l6.5-6z" />
                  </svg>
                </button>
              )}
              {/* Navigate to card */}
              <button
                type="button"
                title="Przejdź do propozycji na liście"
                className="absolute -top-2 -right-2 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkerContextMenu?.(det.id);
                }}
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <line x1="1" y1="3" x2="9" y2="3" />
                  <line x1="1" y1="6" x2="9" y2="6" />
                  <line x1="1" y1="9" x2="6" y2="9" />
                </svg>
              </button>
            </>
          )}

          <span
            className={`absolute -top-5 left-0 rounded px-1 py-0.5 text-xs leading-none font-bold text-white ${isInSingleEdit ? 'bg-amber-500' : 'bg-blue-500'}`}
          >
            #{det.position_index}
          </span>
        </div>
      );
    });
  }

  function renderPhotoLayer(withLoadHandlers: boolean) {
    return (
      <div
        ref={imgContainerRef}
        className="relative mx-auto block"
        style={{ width: `${zoom * fitScale * 100}%` }}
      >
        <img
          src={resolvedPhotoUrl}
          alt="Zdjęcie półki z wykrytymi książkami"
          draggable={false}
          className="block h-auto w-full select-none"
          onLoad={
            withLoadHandlers
              ? (e) => {
                  // M24: zapamiętaj proporcje i policz bazowy fit (contain)
                  naturalDimsRef.current = {
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  };
                  recomputeFitScale();
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
        <div className={`absolute inset-0 ${isEditing ? '' : 'pointer-events-none'}`}>
          {renderMarkers()}
        </div>
      </div>
    );
  }

  // M25: pasek sterujący pływa NAD zdjęciem (lewy górny róg kontenera) zamiast
  // nad nim w flow — mniej pionowego miejsca, kontrolki przy treści. Jest
  // SIBLING-iem viewportu (nie dzieckiem), więc klik nie startuje pan/draw.
  const toolbar = (
    <div className="absolute top-2 left-2 z-20 flex max-w-[calc(100%-1rem)] flex-wrap gap-2">
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
          {/* M26: CostPanel ($) przeniesiony do panelu vision-run pod zdjęciem
              (DetectionReview) — koszt jest etykietą przycisku, nie ikoną tutaj. */}
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
  );

  return (
    <div data-testid="photo-overlay" className="mb-4">
      {!isEditing && withBbox.length > 0 && (
        <div className="mb-2 space-y-0.5 text-xs text-gray-400">
          <p>Numery ramek odpowiadają pozycjom (#N) na liście poniżej.</p>
          {focused && focused.bbox && (
            <p data-testid="focused-bbox-diagnostics">
              Fokus: #{focused.position_index}
              {focused.raw_title ? ` — ${focused.raw_title}` : ''}
              {focused.candidates[0] ? ` → ${focused.candidates[0].title}` : ''} | bbox [
              {focused.bbox.x1.toFixed(3)}, {focused.bbox.y1.toFixed(3)},{' '}
              {focused.bbox.x2.toFixed(3)}, {focused.bbox.y2.toFixed(3)}] | quality:{' '}
              {classifyCropQuality(focused.bbox)}
            </p>
          )}
          {focused && !focused.bbox && (
            <p data-testid="focused-bbox-missing">
              Fokus: #{focused.position_index} | brak bbox dla tej detekcji.
            </p>
          )}
        </div>
      )}

      {/* M25: relative wrapper — toolbar pływa nad viewportem (sibling, nie
          dziecko: klik w przyciski nie odpala pan/draw na viewporcie) */}
      <div className="relative">
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
        {toolbar}
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
