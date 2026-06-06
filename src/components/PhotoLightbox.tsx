import { useEffect } from 'react';
import type { DetectionWithCandidatesDTO } from '../lib/photos/schema';

type Props = {
  photoUrl: string;
  detections: DetectionWithCandidatesDTO[];
  focusedDetectionId?: string | null;
  onClose: () => void;
};

/**
 * S-24: pełnoekranowy podgląd zdjęcia półki z numerowanymi ramkami detekcji.
 * Read-only — bez zoomu/edycji (te żyją w PhotoDetectionOverlay). Modal React
 * zgodnie z konwencją repo (in-app dialog, nie natywne okna przeglądarki).
 * Ramki pozycjonowane procentowo z bbox 0..1 — zero pomiarów DOM.
 * Zamknięcie: Esc / klik tła / przycisk ✕.
 */
export default function PhotoLightbox({
  photoUrl,
  detections,
  focusedDetectionId = null,
  onClose,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const withBbox = detections.filter((d) => d.bbox !== null);

  return (
    <div
      data-testid="photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Pełny podgląd zdjęcia półki"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        data-testid="photo-lightbox-close"
        aria-label="Zamknij podgląd"
        onClick={(e) => {
          e.stopPropagation(); // bez bąbelkowania do backdropu — pojedynczy onClose
          onClose();
        }}
        className="absolute top-4 right-4 z-10 rounded-full bg-black/60 px-3 py-1.5 text-xl leading-none text-white hover:bg-black/80"
      >
        ×
      </button>
      {/* stopPropagation: klik w obraz/ramki nie zamyka — zamyka tylko tło */}
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <img
          src={photoUrl}
          alt="Zdjęcie półki — pełny podgląd"
          draggable={false}
          className="block max-h-[92vh] max-w-full rounded select-none"
        />
        {withBbox.map((det) => {
          const b = det.bbox!;
          const isFocused = det.id === focusedDetectionId;
          return (
            <div
              key={det.id}
              data-testid={`lightbox-marker-${det.position_index}`}
              className={`absolute rounded-sm border-2 ${
                isFocused ? 'border-amber-400 bg-amber-400/15' : 'border-blue-400 bg-blue-400/10'
              }`}
              style={{
                left: `${b.x1 * 100}%`,
                top: `${b.y1 * 100}%`,
                width: `${(b.x2 - b.x1) * 100}%`,
                height: `${(b.y2 - b.y1) * 100}%`,
              }}
            >
              <span
                className={`absolute -top-2 -left-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                  isFocused ? 'bg-amber-500' : 'bg-blue-600'
                }`}
              >
                {det.position_index}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
