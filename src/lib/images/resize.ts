import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon/workerd';

const TARGET_EDGE = 1568;

/**
 * Derywuje kopię roboczą oryginału przeskalowaną do max TARGET_EDGE px
 * po dłuższym boku. Zwraca zawsze JPEG (mediaType hardcoded).
 *
 * Używane w process.ts przed wywołaniem vision — kopia NIE jest zapisywana;
 * storage_path trzyma oryginał pełnej rozdzielczości.
 */
export async function deriveWorkingCopy(
  input: ArrayBuffer
): Promise<{ bytes: Uint8Array; mediaType: 'image/jpeg' }> {
  const bytes = new Uint8Array(input);
  let image: PhotonImage | undefined;
  let resized: PhotonImage | undefined;
  try {
    image = PhotonImage.new_from_byteslice(bytes);

    const w = image.get_width();
    const h = image.get_height();
    const scale = Math.min(1, TARGET_EDGE / Math.max(w, h));
    const newW = Math.max(1, Math.round(w * scale));
    const newH = Math.max(1, Math.round(h * scale));

    resized = resize(image, newW, newH, SamplingFilter.Lanczos3);
    const outputBytes = resized.get_bytes_jpeg(85);

    return { bytes: outputBytes, mediaType: 'image/jpeg' };
  } finally {
    // zwolnij oba uchwyty WASM także na ścieżce błędu (leak guard)
    image?.free();
    resized?.free();
  }
}
