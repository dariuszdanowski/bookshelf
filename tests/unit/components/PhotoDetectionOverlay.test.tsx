import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PhotoDetectionOverlay from '../../../src/components/PhotoDetectionOverlay';
import type { DetectionWithCandidatesDTO } from '../../../src/lib/photos/schema';

const PHOTO_URL = 'https://example.com/shelf.jpg';

function makeDetection(
  positionIndex: number,
  bbox: { x1: number; y1: number; x2: number; y2: number } | null
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
      <PhotoDetectionOverlay photoUrl={null} detections={[makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders photo-overlay container when photoUrl is set', () => {
    render(
      <PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={[]} />
    );
    expect(screen.getByTestId('photo-overlay')).toBeTruthy();
  });

  it('renders img with correct src', () => {
    render(
      <PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={[]} />
    );
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(PHOTO_URL);
  });

  it('renders bbox marker for detection with bbox (after img load)', async () => {
    const detections = [
      makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 }),
      makeDetection(2, null),
    ];
    render(
      <PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />
    );

    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);

    expect(screen.getByTestId('bbox-marker-1')).toBeTruthy();
    expect(screen.queryByTestId('bbox-marker-2')).toBeNull();
  });

  it('renders no markers before image loads', () => {
    const detections = [makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })];
    render(
      <PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />
    );
    expect(screen.queryByTestId('bbox-marker-1')).toBeNull();
  });

  it('renders no markers when all detections have null bbox', () => {
    const detections = [makeDetection(1, null), makeDetection(2, null)];
    render(
      <PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />
    );
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);

    expect(screen.queryByTestId('bbox-marker-1')).toBeNull();
    expect(screen.queryByTestId('bbox-marker-2')).toBeNull();
  });

  it('hides markers when image fails to load (onError)', () => {
    const detections = [makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 })];
    render(
      <PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />
    );
    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);
    fireEvent.error(img);

    expect(screen.queryByTestId('bbox-marker-1')).toBeNull();
  });

  it('marker position_index badge matches detection position_index', () => {
    const detections = [makeDetection(3, { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 })];
    render(
      <PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} />
    );
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

  it('dla focusedDetectionId pokazuje tylko wybrany bbox', () => {
    const detections = [
      makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.5 }),
      makeDetection(2, { x1: 0.3, y1: 0.1, x2: 0.4, y2: 0.5 }),
    ];
    render(<PhotoDetectionOverlay photoUrl={PHOTO_URL} detections={detections} focusedDetectionId="det-2" />);

    const img = screen.getByAltText('Zdjęcie półki z wykrytymi książkami');
    fireEvent.load(img);

    expect(screen.queryByTestId('bbox-marker-1')).toBeNull();
    expect(screen.getByTestId('bbox-marker-2')).toBeTruthy();
    expect(screen.getByTestId('focused-bbox-diagnostics').textContent).toContain('Fokus: #2');
  });
});
