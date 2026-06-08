import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

import { classifyCropQuality } from '../lib/matching/fallbackPolicy';
import { bboxToQuad } from '../lib/photos/schema';
import type {
  BboxCoords,
  BboxEditSet,
  DetectionWithCandidatesDTO,
  QuadPoints,
} from '../lib/photos/schema';
import ConfirmDialog from './ConfirmDialog';
// M23: trigger lightboxa wyłączony na życzenie usera (2026-06-07) — zoom/pan +
// pinch na miejscu wystarczają. Komponent PhotoLightbox + jego testy zostają
// w repo (wyłącz, nie kasuj); przywrócenie = re-import + onClick na <img>.

const TOOLTIP_W = 224; // w-56 = 14rem
const TOOLTIP_H = 148; // estimated max height

function MarkerTooltip({
  det,
  mousePos,
  displayIndex,
}: {
  det: DetectionWithCandidatesDTO;
  mousePos: { x: number; y: number };
  displayIndex: number;
}) {
  const top = det.candidates[0];

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
      <p className="text-[11px] font-semibold text-gray-500">#{displayIndex} — odczyt</p>
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

type Props = {
  photoUrl: string | null;
  detections: DetectionWithCandidatesDTO[];
  focusedDetectionId?: string | null;
  onClearFocus?: () => void;
  isEditing?: boolean;
  onEditingChange?: (v: boolean) => void;
  onApplyEdits?: (changes: BboxEditSet) => Promise<void>;
  onMarkerContextMenu?: (detectionId: string) => void;
  onSaveSingleBbox?: (
    detectionId: string,
    bbox: BboxCoords,
    quad?: QuadPoints | null,
  ) => Promise<void>;
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
  const [fitScale, setFitScale] = useState(1);
  const [hoveredDetId, setHoveredDetId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit mode — accumulated changes for current session
  const [updatedBboxes, setUpdatedBboxes] = useState<Record<string, BboxCoords>>({});
  const [updatedQuads, setUpdatedQuads] = useState<Record<string, QuadPoints>>({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [addedBboxes, setAddedBboxes] = useState<BboxCoords[]>([]);
  const [addedQuads, setAddedQuads] = useState<QuadPoints[]>([]);
  const [draft, setDraft] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Single-marker edit (per-marker, bez globalnego trybu edycji)
  const [singleEditId, setSingleEditId] = useState<string | null>(null);
  const [singleEditBbox, setSingleEditBbox] = useState<BboxCoords | null>(null);
  const [singleEditQuad, setSingleEditQuad] = useState<QuadPoints | null>(null);
  const [singleEditBusy, setSingleEditBusy] = useState(false);
  const draggingCornerRef = useRef<{ idx: number; detId: string } | null>(null);

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
    originalQuad: QuadPoints | null;
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
  // M6: pinch-zoom na dotyku
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  // M24: naturalne wymiary obrazu
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
      setSingleEditQuad(null);
    } else {
      setUpdatedBboxes({});
      setUpdatedQuads({});
      setRemovedIds([]);
      setAddedBboxes([]);
      setAddedQuads([]);
      setDraft(null);
      resizingRef.current = null;
      movingRef.current = null;
    }
  }, [isEditing]);

  // Native wheel listener (non-passive)
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

  // M24: fitScale = contain ratio
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

  function getQuadById(id: string): QuadPoints | null {
    if (singleEditId === id) return singleEditQuad;
    if (id.startsWith('added:')) {
      const idx = parseInt(id.slice(6), 10);
      return addedQuads[idx] ?? (addedBboxes[idx] ? bboxToQuad(addedBboxes[idx]) : null);
    }
    if (updatedQuads[id]) return updatedQuads[id];
    const det = detections.find((d) => d.id === id);
    return det?.quad ?? (det?.bbox ? bboxToQuad(det.bbox) : null);
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

  function applyQuadEdit(id: string, newQuad: QuadPoints) {
    if (singleEditId === id) {
      setSingleEditQuad(newQuad);
      return;
    }
    if (id.startsWith('added:')) {
      const idx = parseInt(id.slice(6), 10);
      setAddedQuads((prev) => {
        const next = [...prev];
        next[idx] = newQuad;
        return next;
      });
    } else {
      setUpdatedQuads((prev) => ({ ...prev, [id]: newQuad }));
    }
  }

  function clearSingleEditRefs() {
    resizingRef.current = null;
    movingRef.current = null;
    draggingCornerRef.current = null;
  }

  async function handleSingleEditSave() {
    if (!singleEditId || !singleEditBbox) return;
    setSingleEditBusy(true);
    clearSingleEditRefs();
    try {
      await onSaveSingleBbox?.(singleEditId, singleEditBbox, singleEditQuad);
      setSingleEditId(null);
      setSingleEditBbox(null);
      setSingleEditQuad(null);
    } finally {
      setSingleEditBusy(false);
    }
  }

  function startMove(id: string, e: React.PointerEvent) {
    e.stopPropagation();
    const bbox = getBboxById(id);
    if (!bbox) return;
    const currentQuad = getQuadById(id);
    movingRef.current = {
      id,
      original: { ...bbox },
      originalQuad: currentQuad ? ([...currentQuad] as QuadPoints) : null,
      startNorm: normCoords(e.clientX, e.clientY),
    };
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
          zoomRef.current = next;
          viewport.scrollLeft = Math.max(0, (viewport.scrollLeft + fx) * ratio - fx);
          viewport.scrollTop = Math.max(0, (viewport.scrollTop + fy) * ratio - fy);
        }
      }
      return;
    }

    // Resize (dead path after handle removal, kept for resizingRef consistency)
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
      if (mv.originalQuad) {
        const translatedQuad = mv.originalQuad.map(
          ([qx, qy]) => [clamp(qx + dx), clamp(qy + dy)] as [number, number],
        ) as QuadPoints;
        applyQuadEdit(mv.id, translatedQuad);
      }
      return;
    }

    const dc = draggingCornerRef.current;
    if (dc !== null) {
      const currentQuad = getQuadById(dc.detId);
      if (currentQuad) {
        const cur = normCoords(e.clientX, e.clientY);
        const newQuad = [...currentQuad] as QuadPoints;
        newQuad[dc.idx] = [clamp(cur.x), clamp(cur.y)];
        applyQuadEdit(dc.detId, newQuad);
        const xs = newQuad.map(([x]) => x);
        const ys = newQuad.map(([, y]) => y);
        applyBboxEdit(dc.detId, {
          x1: Math.min(...xs),
          y1: Math.min(...ys),
          x2: Math.max(...xs),
          y2: Math.max(...ys),
        });
      }
      return;
    }

    if (isEditing) {
      if (draft) {
        const cur = normCoords(e.clientX, e.clientY);
        setDraft((prev) => (prev ? { ...prev, current: cur } : null));
      }
      return;
    }

    const state = dragStateRef.current;
    if (!state.dragging || state.pointerId !== e.pointerId || !wheelViewportRef.current) return;
    e.preventDefault();
    const viewport = wheelViewportRef.current;
    viewport.scrollLeft = state.startScrollLeft - (e.clientX - state.startX);
    viewport.scrollTop = state.startScrollTop - (e.clientY - state.startY);
  }

  function handleContainerPointerUp(e: PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current && pointersRef.current.size < 2) {
      pinchRef.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }
    if (isEditing) {
      if (draggingCornerRef.current) {
        draggingCornerRef.current = null;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        return;
      }
      if (draft) {
        const x1 = Math.min(draft.start.x, draft.current.x);
        const y1 = Math.min(draft.start.y, draft.current.y);
        const x2 = Math.max(draft.start.x, draft.current.x);
        const y2 = Math.max(draft.start.y, draft.current.y);
        if (Math.abs(x2 - x1) > 0.01 && Math.abs(y2 - y1) > 0.01) {
          const newBbox = { x1, y1, x2, y2 };
          setAddedBboxes((prev) => [...prev, newBbox]);
          setAddedQuads((prev) => [...prev, bboxToQuad(newBbox)]);
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

    if (resizingRef.current || movingRef.current || draggingCornerRef.current) {
      resizingRef.current = null;
      movingRef.current = null;
      draggingCornerRef.current = null;
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
      Object.keys(updatedQuads).length > 0 ||
      removedIds.length > 0 ||
      addedBboxes.length > 0
    );
  }

  async function handleApply() {
    if (!onApplyEdits) return;
    setApplyBusy(true);
    const changes: BboxEditSet = {
      updated: Object.entries(updatedBboxes).map(([id, bbox]) => ({
        detectionId: id,
        bbox,
        quad: updatedQuads[id] ?? null,
      })),
      removed: removedIds.map((id) => ({ detectionId: id })),
      added: addedBboxes.map((bbox, i) => ({ bbox, quad: addedQuads[i] ?? null })),
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
    const visibleDets = detections.filter((d) => !removedIds.includes(d.id));

    for (const det of visibleDets) {
      const displayNum = visibleDets.indexOf(det) + 1;
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
          className={`border-2 ${isUncertain ? 'border-amber-400' : 'border-transparent'} pointer-events-auto overflow-visible`}
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
          {hoveredDetId === det.id && (
            <MarkerTooltip det={det} mousePos={mousePos} displayIndex={displayNum} />
          )}

          {isUncertain && (
            <span className="pointer-events-none absolute -bottom-5 left-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] leading-none text-amber-700">
              niepewny
            </span>
          )}

          {/* Pasek ikon ponad górną krawędzią bbox — poza narożnikami */}
          <div className="pointer-events-none absolute -top-6 left-0 flex items-center gap-0.5">
            <span className="pointer-events-none rounded bg-blue-500 px-1 py-0.5 text-xs leading-none font-bold text-white">
              #{displayNum}
            </span>
            <button
              type="button"
              title="Przejdź do propozycji na liście"
              className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600"
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
              className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white hover:bg-red-600"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setRemovedIds((prev) => [...prev, det.id])}
            >
              ×
            </button>
          </div>
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
          className="pointer-events-auto overflow-visible border-2 border-transparent"
          onPointerDown={(e) => {
            if (e.button === 0) startMove(`added:${idx}`, e);
          }}
        >
          {/* Pasek ikon ponad górną krawędzią bbox */}
          <div className="pointer-events-none absolute -top-6 left-0 flex items-center gap-0.5">
            <span className="pointer-events-none rounded bg-green-500 px-1 py-0.5 text-xs leading-none font-bold text-white">
              #{visibleDets.length + idx + 1}
            </span>
            <button
              type="button"
              className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white hover:bg-red-600"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                setAddedBboxes((prev) => prev.filter((_, i) => i !== idx));
                setAddedQuads((prev) => prev.filter((_, i) => i !== idx));
              }}
            >
              ×
            </button>
          </div>
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

    return visibleDetections.map((det, detIdx) => {
      const displayNum = detIdx + 1;
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
          className={`pointer-events-auto overflow-visible border-2 ${isInSingleEdit ? 'cursor-move border-transparent' : det.quad ? 'border-transparent' : 'border-blue-500'}`}
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
            <MarkerTooltip det={det} mousePos={mousePos} displayIndex={displayNum} />
          )}

          {/* Pasek ikon ponad górną krawędzią bbox — poza narożnikami */}
          <div className="pointer-events-none absolute -top-6 left-0 flex items-center gap-0.5">
            <span
              className={`pointer-events-none rounded px-1 py-0.5 text-xs leading-none font-bold text-white ${isInSingleEdit ? 'bg-amber-500' : 'bg-blue-500'}`}
            >
              #{displayNum}
            </span>
            {isInSingleEdit ? (
              <>
                <button
                  type="button"
                  data-testid={`single-edit-save-${det.position_index}`}
                  title="Zapisz zmianę ramki"
                  disabled={singleEditBusy}
                  className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
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
                  className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full bg-gray-400 text-[11px] text-white hover:bg-gray-500 disabled:opacity-50"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    clearSingleEditRefs();
                    setSingleEditId(null);
                    setSingleEditBbox(null);
                    setSingleEditQuad(null);
                  }}
                >
                  ×
                </button>
              </>
            ) : (
              <>
                {!singleEditId && (
                  <button
                    type="button"
                    data-testid={`single-edit-enter-${det.position_index}`}
                    title="Edytuj tę ramkę"
                    className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white hover:bg-amber-600"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSingleEditId(det.id);
                      setSingleEditBbox(activeBbox);
                      setSingleEditQuad(det.quad ?? bboxToQuad(activeBbox!));
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
                <button
                  type="button"
                  title="Przejdź do propozycji na liście"
                  className="pointer-events-auto flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600"
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
          </div>
        </div>
      );
    });
  }

  function renderQuadSvg(): React.ReactNode {
    if (!imgLoaded || imgError || !showBoxes) return null;

    const polygons: React.ReactNode[] = [];
    const CORNER_NAMES = ['nw', 'ne', 'se', 'sw'] as const;

    if (isEditing) {
      // Edit mode: all non-removed detections get quad polygon + 4 corner handles
      for (const det of detections) {
        if (removedIds.includes(det.id)) continue;
        const bbox = updatedBboxes[det.id] ?? det.bbox;
        if (!bbox) continue;
        const activeQuad = updatedQuads[det.id] ?? det.quad ?? bboxToQuad(bbox);
        const pts = activeQuad.map(([x, y]) => `${x},${y}`).join(' ');
        polygons.push(
          <polygon
            key={`poly-${det.id}`}
            points={pts}
            fill="rgba(59,130,246,0.1)"
            stroke="#3b82f6"
            strokeWidth="0.003"
            style={{ pointerEvents: 'none' }}
          />,
        );
        activeQuad.forEach(([x, y], cornerIdx) => {
          const detId = det.id;
          polygons.push(
            <circle
              key={`corner-${det.id}-${cornerIdx}`}
              data-testid={`bbox-handle-${det.position_index}-${CORNER_NAMES[cornerIdx]}`}
              cx={x}
              cy={y}
              r="0.006"
              fill="white"
              stroke="#3b82f6"
              strokeWidth="0.003"
              style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                draggingCornerRef.current = { idx: cornerIdx, detId };
                if (wheelViewportRef.current?.setPointerCapture) {
                  wheelViewportRef.current.setPointerCapture(e.pointerId);
                }
              }}
            />,
          );
        });
      }
      // Added bboxes
      addedBboxes.forEach((bbox, bboxIdx) => {
        const activeQuad = addedQuads[bboxIdx] ?? bboxToQuad(bbox);
        const addedId = `added:${bboxIdx}`;
        const pts = activeQuad.map(([x, y]) => `${x},${y}`).join(' ');
        polygons.push(
          <polygon
            key={`poly-${addedId}`}
            points={pts}
            fill="rgba(34,197,94,0.1)"
            stroke="#22c55e"
            strokeWidth="0.003"
            style={{ pointerEvents: 'none' }}
          />,
        );
        activeQuad.forEach(([x, y], cornerIdx) => {
          polygons.push(
            <circle
              key={`corner-${addedId}-${cornerIdx}`}
              cx={x}
              cy={y}
              r="0.006"
              fill="white"
              stroke="#22c55e"
              strokeWidth="0.003"
              style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                draggingCornerRef.current = { idx: cornerIdx, detId: addedId };
                if (wheelViewportRef.current?.setPointerCapture) {
                  wheelViewportRef.current.setPointerCapture(e.pointerId);
                }
              }}
            />,
          );
        });
      });
    } else {
      // View mode / single-edit
      for (const det of visibleDetections) {
        const isInSingleEdit = singleEditId === det.id;
        const activeQuad = isInSingleEdit ? singleEditQuad : (det.quad ?? null);
        if (!activeQuad) continue;

        const pts = activeQuad.map(([x, y]) => `${x},${y}`).join(' ');
        polygons.push(
          <polygon
            key={`poly-${det.id}`}
            points={pts}
            fill={isInSingleEdit ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.1)'}
            stroke={isInSingleEdit ? '#f59e0b' : '#3b82f6'}
            strokeWidth="0.003"
            style={{ pointerEvents: 'none' }}
          />,
        );

        if (isInSingleEdit) {
          activeQuad.forEach(([x, y], cornerIdx) => {
            const detId = det.id;
            polygons.push(
              <circle
                key={`corner-${cornerIdx}`}
                data-testid={`bbox-handle-${det.position_index}-${CORNER_NAMES[cornerIdx]}`}
                cx={x}
                cy={y}
                r="0.006"
                fill="white"
                stroke="#f59e0b"
                strokeWidth="0.003"
                style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  draggingCornerRef.current = { idx: cornerIdx, detId };
                  if (wheelViewportRef.current?.setPointerCapture) {
                    wheelViewportRef.current.setPointerCapture(e.pointerId);
                  }
                }}
              />,
            );
          });
        }
      }
    }

    if (polygons.length === 0) return null;

    return (
      <svg
        className="absolute inset-0 overflow-visible"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {polygons}
      </svg>
    );
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
        {renderQuadSvg()}
      </div>
    );
  }

  // M25: pasek sterujący pływa NAD zdjęciem (lewy górny róg kontenera)
  const toolbar = (
    <div className="pointer-events-none absolute top-2 left-2 z-20 flex max-w-[calc(100%-1rem)] flex-wrap gap-2">
      {isEditing ? (
        <>
          <button
            type="button"
            data-testid="apply-bbox-edits-button"
            disabled={applyBusy}
            onClick={() => void handleApply()}
            className="pointer-events-auto rounded border border-green-600 bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
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
            className="pointer-events-auto rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
            className="pointer-events-auto rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Edytuj ramki
          </button>
          <button
            type="button"
            data-testid="toggle-bboxes-button"
            onClick={() => setShowBoxes((v) => !v)}
            className="pointer-events-auto rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {showBoxes ? 'Ukryj ramki' : 'Pokaż ramki'}
          </button>
          {focusedDetectionId && onClearFocus && (
            <button
              type="button"
              data-testid="clear-focus-button"
              onClick={onClearFocus}
              className="pointer-events-auto rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Pokaż wszystkie detekcje
            </button>
          )}
          <button
            type="button"
            data-testid="zoom-out-button"
            onClick={() => changeZoom(zoom - 0.25)}
            className="pointer-events-auto rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            -
          </button>
          <button
            type="button"
            data-testid="zoom-reset-button"
            onClick={() => setZoom(1)}
            className="pointer-events-auto rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            data-testid="zoom-in-button"
            onClick={() => changeZoom(zoom + 0.25)}
            className="pointer-events-auto rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
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

      {/* M25: relative wrapper — toolbar pływa nad viewportem */}
      <div className="relative">
        <div
          ref={wheelViewportRef}
          data-testid="photo-overlay-viewport"
          onPointerDown={handleContainerPointerDown}
          onPointerMove={handleContainerPointerMove}
          onPointerUp={handleContainerPointerUp}
          onPointerCancel={handleContainerPointerUp}
          className={`scrollbar-hidden max-h-[72vh] w-full overflow-auto rounded-lg border border-gray-200 bg-gray-100 px-3 pt-12 pb-3 select-none ${isEditing ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
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
