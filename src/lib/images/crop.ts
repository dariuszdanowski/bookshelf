import { PhotonImage, crop, grayscale, resize, SamplingFilter } from '@cf-wasm/photon/workerd';

type NormalizedBbox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export async function deriveDetectionCrop(
  input: ArrayBuffer,
  bbox: NormalizedBbox,
  options?: { paddingPx?: number; maxEdge?: number }
): Promise<{ bytes: Uint8Array; mediaType: 'image/jpeg' }> {
  const bytes = new Uint8Array(input);
  const paddingPx = options?.paddingPx ?? 8;
  const maxEdge = options?.maxEdge ?? 1024;

  let image: PhotonImage | undefined;
  let cropped: PhotonImage | undefined;
  let resized: PhotonImage | undefined;

  try {
    image = PhotonImage.new_from_byteslice(bytes);

    const width = image.get_width();
    const height = image.get_height();

    const nx1 = clamp01(Math.min(bbox.x1, bbox.x2));
    const ny1 = clamp01(Math.min(bbox.y1, bbox.y2));
    const nx2 = clamp01(Math.max(bbox.x1, bbox.x2));
    const ny2 = clamp01(Math.max(bbox.y1, bbox.y2));

    const x1 = Math.max(0, Math.floor(nx1 * width) - paddingPx);
    const y1 = Math.max(0, Math.floor(ny1 * height) - paddingPx);
    const x2 = Math.min(width, Math.ceil(nx2 * width) + paddingPx);
    const y2 = Math.min(height, Math.ceil(ny2 * height) + paddingPx);

    if (x2 - x1 < 2 || y2 - y1 < 2) {
      throw new Error('Detection bbox is too small to crop.');
    }

    cropped = crop(image, x1, y1, x2, y2);

    // Improve OCR readability for spine text without over-processing color channels.
    grayscale(cropped);

    const croppedW = cropped.get_width();
    const croppedH = cropped.get_height();
    const scale = Math.min(1, maxEdge / Math.max(croppedW, croppedH));
    const targetW = Math.max(1, Math.round(croppedW * scale));
    const targetH = Math.max(1, Math.round(croppedH * scale));

    resized = resize(cropped, targetW, targetH, SamplingFilter.Lanczos3);
    const outputBytes = resized.get_bytes_jpeg(88);

    return { bytes: outputBytes, mediaType: 'image/jpeg' };
  } finally {
    image?.free();
    cropped?.free();
    resized?.free();
  }
}
