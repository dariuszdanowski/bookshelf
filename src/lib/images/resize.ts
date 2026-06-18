import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon/workerd';

import { readExifOrientation, withExifOrientation } from './exif';

const TARGET_EDGE = 1568;

// M15 (thumbnail-server-side): miniatura listy. 640 px = dotychczasowy
// THUMB_MAX_EDGE z browser-side wariantu. Jakość: photon get_bytes_jpeg bierze
// int 1–100 (NIE float 0.75 z canvasu — 0.75 zaokrągliłoby się do 0).
const THUMB_EDGE = 640;
const THUMB_JPEG_QUALITY = 75;

/**
 * Derywuje kopię roboczą oryginału przeskalowaną do max TARGET_EDGE px
 * po dłuższym boku. Zwraca zawsze JPEG (mediaType hardcoded).
 *
 * Używane w process.ts przed wywołaniem vision — kopia NIE jest zapisywana;
 * storage_path trzyma oryginał pełnej rozdzielczości.
 */
export async function deriveWorkingCopy(
  input: ArrayBuffer,
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

/**
 * Derywuje miniaturę JPEG przeskalowaną do max THUMB_EDGE px po dłuższym boku.
 *
 * Używane w upload-file.ts (best-effort) — serwer już trzyma buffer pliku, więc
 * miniatura powstaje server-side, bez kroku canvas w przeglądarce. Rzuca przy
 * nie-dekodowalnym wejściu (HEIC/uszkodzony/nietypowy JPEG) — caller łapie.
 *
 * EXIF: photon NIE stosuje tagu orientation, a jego `rotate` PSUJE obraz
 * (washout do bieli — zmierzone). Dlatego NIE obracamy pikseli — resize zachowuje
 * surową orientację (kolory idealne), a tag EXIF przepisany do miniatury każe
 * przeglądarce obrócić ją przy wyświetlaniu (tak jak robi z oryginałem). `<img>`
 * domyślnie honoruje `image-orientation: from-image`.
 */
export async function deriveThumbnail(input: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(input);
  const orientation = readExifOrientation(bytes);
  let image: PhotonImage | undefined;
  let resized: PhotonImage | undefined;
  try {
    image = PhotonImage.new_from_byteslice(bytes);

    const w = image.get_width();
    const h = image.get_height();
    const scale = Math.min(1, THUMB_EDGE / Math.max(w, h));
    const newW = Math.max(1, Math.round(w * scale));
    const newH = Math.max(1, Math.round(h * scale));

    resized = resize(image, newW, newH, SamplingFilter.Lanczos3);
    const jpeg = resized.get_bytes_jpeg(THUMB_JPEG_QUALITY);
    // Przepisz orientację EXIF do miniatury (no-op gdy orientation ≤ 1).
    return withExifOrientation(jpeg, orientation);
  } finally {
    // zwolnij oba uchwyty WASM także na ścieżce błędu (leak guard)
    image?.free();
    resized?.free();
  }
}
