import { useState } from 'react';

import type { DetectionWithCandidatesDTO } from '../lib/photos/schema';

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

type Props = {
  photoUrl: string | null;
  detections: DetectionWithCandidatesDTO[];
};

export default function PhotoDetectionOverlay({ photoUrl, detections }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (!photoUrl) return null;

  const withBbox = detections.filter((d) => d.bbox !== null);

  return (
    <div data-testid="photo-overlay" className="mb-4">
      <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
        <img
          src={photoUrl}
          alt="Zdjęcie półki z wykrytymi książkami"
          className="w-full h-auto block"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
        />

        {imgLoaded && !imgError &&
          withBbox.map((det) => {
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
                className="border-2 border-blue-500 pointer-events-none"
              >
                <span className="absolute -top-5 left-0 rounded bg-blue-500 px-1 py-0.5 text-xs font-bold text-white leading-none">
                  #{det.position_index}
                </span>
              </div>
            );
          })
        }
      </div>

      {withBbox.length > 0 && (
        <p className="mt-1 text-xs text-gray-400">
          Numery ramek odpowiadają pozycjom (#N) na liście poniżej.
        </p>
      )}
    </div>
  );
}
