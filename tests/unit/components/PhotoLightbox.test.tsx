import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PhotoLightbox from '../../../src/components/PhotoLightbox';
import type { DetectionWithCandidatesDTO } from '../../../src/lib/photos/schema';

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

describe('PhotoLightbox (S-24)', () => {
  it('renderuje obraz i numerowane ramki dla detekcji z bbox', () => {
    const detections = [
      makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 }),
      makeDetection(2, { x1: 0.3, y1: 0.1, x2: 0.4, y2: 0.9 }),
      makeDetection(3, null), // bez bbox — pomijana
    ];
    render(<PhotoLightbox photoUrl={PHOTO_URL} detections={detections} onClose={vi.fn()} />);

    expect(screen.getByTestId('photo-lightbox')).toBeInTheDocument();
    expect(screen.getByAltText('Zdjęcie półki — pełny podgląd')).toHaveAttribute('src', PHOTO_URL);
    expect(screen.getByTestId('lightbox-marker-1')).toBeInTheDocument();
    expect(screen.getByTestId('lightbox-marker-2')).toBeInTheDocument();
    expect(screen.queryByTestId('lightbox-marker-3')).not.toBeInTheDocument();
  });

  it('pozycjonuje ramkę procentowo z bbox 0..1', () => {
    render(
      <PhotoLightbox
        photoUrl={PHOTO_URL}
        detections={[makeDetection(1, { x1: 0.1, y1: 0.05, x2: 0.3, y2: 0.95 })]}
        onClose={vi.fn()}
      />,
    );
    const marker = screen.getByTestId('lightbox-marker-1');
    expect(marker.style.left).toBe('10%');
    expect(marker.style.top).toBe('5%');
    expect(marker.style.width).toBe('20%');
  });

  it('Esc zamyka (onClose)', () => {
    const onClose = vi.fn();
    render(<PhotoLightbox photoUrl={PHOTO_URL} detections={[]} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('klik tła zamyka; klik w obraz NIE zamyka', () => {
    const onClose = vi.fn();
    render(<PhotoLightbox photoUrl={PHOTO_URL} detections={[]} onClose={onClose} />);
    fireEvent.click(screen.getByAltText('Zdjęcie półki — pełny podgląd'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('photo-lightbox'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('przycisk ✕ zamyka', () => {
    const onClose = vi.fn();
    render(<PhotoLightbox photoUrl={PHOTO_URL} detections={[]} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('photo-lightbox-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wyróżnia fokusowaną detekcję (S-18/S-37 spójność)', () => {
    render(
      <PhotoLightbox
        photoUrl={PHOTO_URL}
        detections={[
          makeDetection(1, { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.9 }),
          makeDetection(2, { x1: 0.3, y1: 0.1, x2: 0.4, y2: 0.9 }),
        ]}
        focusedDetectionId="det-2"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('lightbox-marker-2').className).toContain('border-amber-400');
    expect(screen.getByTestId('lightbox-marker-1').className).toContain('border-blue-400');
  });
});
