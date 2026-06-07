// M15: miniatura generowana w PRZEGLĄDARCE przy uploadzie (canvas) — zero
// kosztu Workers CPU i bez ściągania oryginału z powrotem na server. Pliki
// crop.ts/resize.ts w tym katalogu są workerd-only (photon) — nie importować
// ich stąd ani odwrotnie.

export const THUMB_MAX_EDGE = 640;
export const THUMB_JPEG_QUALITY = 0.75;

/**
 * Skaluje obraz do max THUMB_MAX_EDGE px po dłuższym boku i koduje JPEG.
 * Best-effort: każdy błąd (HEIC bez dekodera, brak canvas w jsdom, OOM)
 * zwraca null — caller pomija upload miniatury, lista fallbackuje do oryginału.
 */
export async function makeThumbnailBlob(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', THUMB_JPEG_QUALITY),
    );
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
