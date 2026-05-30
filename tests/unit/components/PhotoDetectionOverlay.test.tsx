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
    expect(img.src).toBe(PHOTO_URL);
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
});
