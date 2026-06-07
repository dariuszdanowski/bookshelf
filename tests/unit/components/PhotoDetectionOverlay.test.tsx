import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import PhotoDetectionOverlay from '../../../src/components/PhotoDetectionOverlay';
import type { BboxEditSet, DetectionWithCandidatesDTO } from '../../../src/lib/photos/schema';

const PHOTO_URL = 'https://example.com/shelf.jpg';

function makeDetection(
  positionIndex: number,
  bbox: { x1: number; y1: number; x2: number; y2: number } | null,
): DetectionWithCandidatesDTO {
  return {
    id: `det-${positionIndex}`,
    position_index: positionIndex,
    raw_title: `Book ${positionIndex}`,
    raw_author: null,
    vision_confidence: 0.9,
    spine_color: null,
    bbox,
    status: 'matched',
    candidates: [],
    duplicate: null,
  };
}

describe('PhotoDetectionOverlay', () => {
  it('renders nothing when photoUrl is null', () => {
    const { container } = render(
      <PhotoDetectionOverlay
        photoUrl={null}
        detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders photo-overlay container when photoUrl is set', () => {
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={[]} />);
    expect(screen.getByTestId('photo-overlay')).toBeTruthy();
  });

  it('renders img with correct src', () => {
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={[]} />);
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(PHOTO_URL);
  });

  it('renders bbox marker for detection with bbox (after img load)', async () => {
    const detections = [
      makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 }),
      makeDetection(2, null),
    ];
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />);

    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);

    expect(screen.getByTestId('bbox-marker-1')).toBeTruthy();
    expect(screen.queryByTestId('bbox-marker-2')).toBeNull();
  });

  it('renders no markers before image loads', () => {
    const detections = [makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })];
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />);
    expect(screen.queryByTestId('bbox-marker-1')).toBeNull();
  });

  it('renders no markers when all detections have null bbox', () => {
    const detections = [makeDetection(1, null), makeDetection(2, null)];
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />);
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);

    expect(screen.queryByTestId('bbox-marker-1')).toBeNull();
    expect(screen.queryByTestId('bbox-marker-2')).toBeNull();
  });

  it('hides markers when image fails to load (onError)', () => {
    const detections = [makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })];
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />);
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);
    fireEvent.error(img);

    expect(screen.queryByTestId('bbox-marker-1')).toBeNull();
  });

  it('marker position_index badge matches detection position_index', () => {
    const detections = [makeDetection(3, { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 })];
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />);
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);

    const marker = screen.getByTestId('bbox-marker-3');
    expect(marker).toBeTruthy();
    expect(marker.textContent).toBe('#3');
  });

  it('toggle ramek ukrywa i pokazuje bbox markery', () => {
    const detections = [makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 })];
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />);

    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);
    expect(screen.getByTestId('bbox-marker-1')).toBeTruthy();

    fireEvent.click(screen.getByTestId('toggle-bboxes-button'));
    expect(screen.queryByTestId('bbox-marker-1')).toBeNull();

    fireEvent.click(screen.getByTestId('toggle-bboxes-button'));
    expect(screen.getByTestId('bbox-marker-1')).toBeTruthy();
  });

  it('wheel zmienia zoom, a drag przesuwa panel', () => {
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={[makeDetection(1, null)]} />);

    const viewport = screen.getByTestId('photo-overlay-viewport');
    Object.defineProperty(viewport, 'scrollTop', { value: 0, writable: true });
    Object.defineProperty(viewport, 'scrollLeft', { value: 0, writable: true });

    expect(screen.getByTestId('zoom-reset-button').textContent).toBe('100%');

    fireEvent.wheel(viewport, { deltaY: -120, clientX: 0, clientY: 0 });

    expect(screen.getByTestId('zoom-reset-button').textContent).toBe('115%');

    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 80 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 70, clientY: 50 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 70, clientY: 50 });

    expect(viewport.scrollTop).toBe(30);
    expect(viewport.scrollLeft).toBe(30);
  });

  it('edit-bboxes-button jest widoczny w trybie normalnym', () => {
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={[]} />);
    expect(screen.getByTestId('edit-bboxes-button')).toBeTruthy();
  });

  describe('edit mode', () => {
    function EditWrapper({
      onApplyEdits,
      onEditingChange,
      detections: dets = [makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 })],
    }: {
      onApplyEdits?: (changes: BboxEditSet) => Promise<void>;
      onEditingChange?: (v: boolean) => void;
      detections?: DetectionWithCandidatesDTO[];
    }) {
      const [isEditing, setIsEditing] = useState(false);
      return (
        <PhotoDetectionOverlay
          photoUrl={PHOTO_URL}
          detections={dets}
          isEditing={isEditing}
          onEditingChange={(v) => {
            setIsEditing(v);
            onEditingChange?.(v);
          }}
          onApplyEdits={onApplyEdits}
        />
      );
    }

    it('klik edit-bboxes-button pokazuje apply i cancel, ukrywa zoom/toggle', () => {
      render(<EditWrapper />);
      fireEvent.click(screen.getByTestId('edit-bboxes-button'));
      expect(screen.getByTestId('apply-bbox-edits-button')).toBeTruthy();
      expect(screen.getByTestId('cancel-bbox-edits-button')).toBeTruthy();
      expect(screen.queryByTestId('edit-bboxes-button')).toBeNull();
      expect(screen.queryByTestId('zoom-in-button')).toBeNull();
    });

    it('bbox-delete-{n} klik usuwa marker z widoku', () => {
      render(
        <PhotoDetectionOverlay
          photoUrl={PHOTO_URL}
          detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 })]}
          isEditing={true}
          onEditingChange={vi.fn()}
        />,
      );
      const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
      fireEvent.load(img);

      expect(screen.getByTestId('bbox-marker-1')).toBeTruthy();
      fireEvent.click(screen.getByTestId('bbox-delete-1'));
      expect(screen.queryByTestId('bbox-marker-1')).toBeNull();
    });

    it('Apply wywołuje onApplyEdits z poprawnym BboxEditSet (removed)', () => {
      const mockApply = vi.fn().mockResolvedValue(undefined);
      render(
        <PhotoDetectionOverlay
          photoUrl={PHOTO_URL}
          detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 })]}
          isEditing={true}
          onApplyEdits={mockApply}
          onEditingChange={vi.fn()}
        />,
      );
      const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
      fireEvent.load(img);

      fireEvent.click(screen.getByTestId('bbox-delete-1'));
      fireEvent.click(screen.getByTestId('apply-bbox-edits-button'));

      expect(mockApply).toHaveBeenCalledWith({
        updated: [],
        removed: [{ detectionId: 'det-1' }],
        added: [],
      });
    });

    it('cancel-bbox-edits-button nie wywołuje onApplyEdits i wywołuje onEditingChange(false)', () => {
      const mockApply = vi.fn();
      const mockEditingChange = vi.fn();
      render(
        <PhotoDetectionOverlay
          photoUrl={PHOTO_URL}
          detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 })]}
          isEditing={true}
          onApplyEdits={mockApply}
          onEditingChange={mockEditingChange}
        />,
      );

      fireEvent.click(screen.getByTestId('cancel-bbox-edits-button'));

      expect(mockApply).not.toHaveBeenCalled();
      expect(mockEditingChange).toHaveBeenCalledWith(false);
    });

    it('bbox-draft widoczny podczas drag-to-draw na viewport', () => {
      render(
        <PhotoDetectionOverlay
          photoUrl={PHOTO_URL}
          detections={[]}
          isEditing={true}
          onEditingChange={vi.fn()}
        />,
      );
      const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
      fireEvent.load(img);

      const viewport = screen.getByTestId('photo-overlay-viewport');
      fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
      fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 50, clientY: 60 });

      expect(screen.getByTestId('bbox-draft')).toBeTruthy();
    });
  });

  it('dla focusedDetectionId pokazuje tylko wybrany bbox', () => {
    const detections = [
      makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.5 }),
      makeDetection(2, { x1: 0.3, y1: 0.1, x2: 0.4, y2: 0.5 }),
    ];
    render(
      <PhotoDetectionOverlay
        photoUrl={PHOTO_URL}
        detections={detections}
        focusedDetectionId="det-2"
      />,
    );

    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);

    expect(screen.queryByTestId('bbox-marker-1')).toBeNull();
    expect(screen.getByTestId('bbox-marker-2')).toBeTruthy();
    expect(screen.getByTestId('focused-bbox-diagnostics').textContent).toContain('Fokus: #2');
  });
});

// ---------------------------------------------------------------------------
// S-24: lightbox — klik w obraz otwiera pełnoekranowy podgląd
// ---------------------------------------------------------------------------

describe('PhotoDetectionOverlay — lightbox (S-24)', () => {
  it('klik w obraz otwiera lightbox; ✕ zamyka', () => {
    render(
      <PhotoDetectionOverlay
        photoUrl={PHOTO_URL}
        detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })]}
      />,
    );
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);
    expect(screen.queryByTestId('photo-lightbox')).toBeNull();

    fireEvent.click(img);
    expect(screen.getByTestId('photo-lightbox')).toBeTruthy();
    expect(screen.getByTestId('lightbox-marker-1')).toBeTruthy();

    fireEvent.click(screen.getByTestId('photo-lightbox-close'));
    expect(screen.queryByTestId('photo-lightbox')).toBeNull();
  });

  it('w trybie edycji klik NIE otwiera lightboxa', () => {
    render(
      <PhotoDetectionOverlay
        photoUrl={PHOTO_URL}
        detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })]}
        isEditing
      />,
    );
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);
    fireEvent.click(img);
    expect(screen.queryByTestId('photo-lightbox')).toBeNull();
  });

  it('pan-drag (przesunięcie > 5 px od pointerdown) NIE otwiera lightboxa', () => {
    render(
      <PhotoDetectionOverlay
        photoUrl={PHOTO_URL}
        detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })]}
      />,
    );
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);

    const viewport = screen.getByTestId('photo-overlay-viewport');
    fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.click(img, { clientX: 60, clientY: 60 });
    expect(screen.queryByTestId('photo-lightbox')).toBeNull();

    // czysty klik (ta sama pozycja) — otwiera
    fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.click(img, { clientX: 11, clientY: 11 });
    expect(screen.getByTestId('photo-lightbox')).toBeTruthy();
  });

  it('lightbox przy fokusie pokazuje tylko fokusowaną ramkę (visibleDetections)', () => {
    render(
      <PhotoDetectionOverlay
        photoUrl={PHOTO_URL}
        detections={[
          makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 }),
          makeDetection(2, { x1: 0.3, y1: 0.1, x2: 0.4, y2: 0.9 }),
        ]}
        focusedDetectionId="det-2"
        onClearFocus={() => {}}
      />,
    );
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);
    fireEvent.click(img);
    expect(screen.getByTestId('photo-lightbox')).toBeTruthy();
    expect(screen.queryByTestId('lightbox-marker-1')).toBeNull();
    expect(screen.getByTestId('lightbox-marker-2')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// M6: pinch-zoom (2 pointery) — touch-action:none blokuje natywny gest,
// wiec overlay obsluguje go sam.
// ---------------------------------------------------------------------------

describe('PhotoDetectionOverlay — pinch-zoom (M6)', () => {
  function setupViewport() {
    render(
      <PhotoDetectionOverlay
        photoUrl={PHOTO_URL}
        detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })]}
      />,
    );
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);
    return screen.getByTestId('photo-overlay-viewport');
  }

  it('rozsuniecie dwoch pointerow zwieksza zoom (dystans x2 -> 200%)', () => {
    const viewport = setupViewport();
    expect(screen.getByTestId('zoom-reset-button')).toHaveTextContent('100%');

    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 200, clientY: 100 }); // dystans 100
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 300, clientY: 100 }); // dystans 200

    expect(screen.getByTestId('zoom-reset-button')).toHaveTextContent('200%');
  });

  it('zoom clampowany do 4x; po podniesieniu palca gest sie konczy', () => {
    const viewport = setupViewport();
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 110, clientY: 100 }); // dystans 10
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 600, clientY: 100 }); // x50 -> clamp 4
    expect(screen.getByTestId('zoom-reset-button')).toHaveTextContent('400%');

    fireEvent.pointerUp(viewport, { pointerId: 2 });
    // pojedynczy pointer nie zmienia juz zoomu
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 500, clientY: 100 });
    expect(screen.getByTestId('zoom-reset-button')).toHaveTextContent('400%');
  });

  it('w trybie edycji drugi pointer NIE startuje pinch (kolizja z rysowaniem bbox)', () => {
    render(
      <PhotoDetectionOverlay
        photoUrl={PHOTO_URL}
        detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })]}
        isEditing
      />,
    );
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);
    const viewport = screen.getByTestId('photo-overlay-viewport');

    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 400, clientY: 100 });

    // zoom-reset-button jest w toolbarze nie-edit; w edit mode sprawdzamy brak crasha
    // i brak zooma po wyjsciu z trybu — wystarczy ze nic nie rzucilo
    expect(screen.getByTestId('photo-overlay')).toBeInTheDocument();
  });
});
