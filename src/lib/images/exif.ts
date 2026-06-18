// Parser tagu EXIF Orientation (0x0112) z bajtów JPEG. Pure JS, bez zależności —
// photon NIE stosuje EXIF, a przeglądarkowy `createImageBitmap` (stary
// browserThumb) stosował go automatycznie. Bez tego miniatury server-side ze
// zdjęć z aparatu wychodzą obrócone (np. Samsung zapisuje orientation=3 → 180°).
//
// Wartości EXIF Orientation (1–8): 1=normal, 2=flip-H, 3=180°, 4=flip-V,
// 5=transpose, 6=90°CW, 7=transverse, 8=270°CW. Zwracamy 1 przy braku tagu /
// nie-JPEG / dowolnym błędzie parsowania (best-effort, nigdy nie rzuca).

export function readExifOrientation(bytes: Uint8Array): number {
  try {
    // JPEG SOI
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (view.getUint8(offset) !== 0xff) break; // poza strukturą markerów
      const marker = view.getUint8(offset + 1);
      if (marker === 0xda) break; // SOS — dalej dane obrazu, EXIF już by był
      const size = view.getUint16(offset + 2); // długość segmentu (big-endian)
      if (size < 2) break;

      // APP1 (0xE1) z sygnaturą "Exif\0\0" → blok TIFF
      if (marker === 0xe1 && offset + 4 + 6 <= bytes.length) {
        const app1 = offset + 4;
        if (view.getUint32(app1) === 0x45786966 && view.getUint16(app1 + 4) === 0x0000) {
          return parseTiffOrientation(view, app1 + 6, bytes.length);
        }
      }
      offset += 2 + size;
    }
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Wstawia segment APP1/Exif z tagiem Orientation do JPEG (zaraz po SOI).
 *
 * Używane dla miniatur: photon `rotate` psuje obraz (washout), więc NIE obracamy
 * pikseli — resize zachowuje surową orientację, a tag EXIF każe przeglądarce
 * obrócić miniaturę przy wyświetlaniu (tak jak robi z oryginałem). Zwraca wejście
 * bez zmian gdy to nie JPEG albo orientation ≤ 1 (nic do oznaczenia).
 */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  if (orientation <= 1 || orientation > 8) return jpeg;
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;

  // TIFF little-endian, IFD0 z jednym wpisem Orientation (SHORT, inline).
  const tiff = [
    0x49,
    0x49,
    0x2a,
    0x00,
    0x08,
    0x00,
    0x00,
    0x00, // 'II', 42, IFD0@8
    0x01,
    0x00, // 1 wpis
    0x12,
    0x01,
    0x03,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00, // tag 0x0112, SHORT, count 1
    orientation & 0xff,
    0x00,
    0x00,
    0x00, // wartość inline
    0x00,
    0x00,
    0x00,
    0x00, // next IFD = 0
  ];
  const app1Content = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // 'Exif\0\0' + TIFF
  const size = app1Content.length + 2; // długość liczy też 2 bajty pola długości
  const app1 = [0xff, 0xe1, (size >> 8) & 0xff, size & 0xff, ...app1Content];

  const out = new Uint8Array(jpeg.length + app1.length);
  out[0] = 0xff;
  out[1] = 0xd8; // SOI
  out.set(app1, 2); // APP1 zaraz po SOI
  out.set(jpeg.subarray(2), 2 + app1.length); // reszta oryginalnego JPEG
  return out;
}

function parseTiffOrientation(view: DataView, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const byteOrder = view.getUint16(tiff);
  const little = byteOrder === 0x4949; // 'II' little-endian; 0x4D4D 'MM' big-endian
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);

  if (u16(tiff + 2) !== 0x002a) return 1; // TIFF magic 42
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > end) return 1;

  const count = u16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8); // typ SHORT, wartość inline
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
