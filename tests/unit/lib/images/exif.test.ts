import { describe, expect, it } from 'vitest';

import { readExifOrientation, withExifOrientation } from '../../../../src/lib/images/exif';

/**
 * Buduje minimalny JPEG z segmentem APP1/Exif zawierającym tag Orientation.
 * little=true → bajt-order 'II' (Intel), false → 'MM' (Motorola/big-endian).
 */
function jpegWithOrientation(orientation: number, little = true): Uint8Array {
  const tiff: number[] = [];
  if (little) {
    tiff.push(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00); // II, 42, IFD0@8
    tiff.push(0x01, 0x00); // 1 entry
    tiff.push(0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00); // tag 0x0112, SHORT, count 1
    tiff.push(orientation & 0xff, 0x00, 0x00, 0x00); // wartość inline
    tiff.push(0x00, 0x00, 0x00, 0x00); // next IFD = 0
  } else {
    tiff.push(0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08); // MM, 42, IFD0@8
    tiff.push(0x00, 0x01); // 1 entry
    tiff.push(0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01); // tag 0x0112, SHORT, count 1
    tiff.push(0x00, orientation & 0xff, 0x00, 0x00); // wartość inline (big-endian SHORT)
    tiff.push(0x00, 0x00, 0x00, 0x00); // next IFD = 0
  }
  const app1Content = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const size = app1Content.length + 2;
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe1,
    (size >> 8) & 0xff,
    size & 0xff, // APP1 + długość (big-endian)
    ...app1Content,
    0xff,
    0xd9, // EOI
  ]);
}

describe('readExifOrientation', () => {
  it('zwraca 1 dla nie-JPEG', () => {
    expect(readExifOrientation(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe(1);
  });

  it('zwraca 1 dla JPEG bez segmentu Exif', () => {
    expect(readExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
  });

  it('czyta orientation=3 (little-endian / II)', () => {
    expect(readExifOrientation(jpegWithOrientation(3))).toBe(3);
  });

  it('czyta orientation=6 (little-endian / II)', () => {
    expect(readExifOrientation(jpegWithOrientation(6))).toBe(6);
  });

  it('czyta orientation=8 (little-endian / II)', () => {
    expect(readExifOrientation(jpegWithOrientation(8))).toBe(8);
  });

  it('czyta orientation=3 (big-endian / MM)', () => {
    expect(readExifOrientation(jpegWithOrientation(3, false))).toBe(3);
  });

  it('zwraca 1 dla wartości spoza zakresu 1–8', () => {
    expect(readExifOrientation(jpegWithOrientation(99))).toBe(1);
  });

  it('nie rzuca na pustych / krótkich bajtach', () => {
    expect(readExifOrientation(new Uint8Array([]))).toBe(1);
    expect(readExifOrientation(new Uint8Array([0xff]))).toBe(1);
    expect(readExifOrientation(new Uint8Array([0xff, 0xd8]))).toBe(1);
  });
});

describe('withExifOrientation', () => {
  // surowy JPEG bez EXIF (SOI + APP0/JFIF-ish + EOI)
  const plainJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x00, 0xff, 0xd9]);

  it('round-trip: tag zapisany jest odczytywalny (orientation 6)', () => {
    const tagged = withExifOrientation(plainJpeg, 6);
    expect(readExifOrientation(tagged)).toBe(6);
  });

  it('round-trip dla każdej orientacji 2–8', () => {
    for (let o = 2; o <= 8; o++) {
      expect(readExifOrientation(withExifOrientation(plainJpeg, o))).toBe(o);
    }
  });

  it('zachowuje resztę JPEG po wstawionym APP1 (SOI na początku)', () => {
    const tagged = withExifOrientation(plainJpeg, 3);
    expect(tagged[0]).toBe(0xff);
    expect(tagged[1]).toBe(0xd8); // SOI
    expect(tagged.length).toBeGreaterThan(plainJpeg.length);
    // ogon oryginału (EOI) zachowany
    expect(Array.from(tagged.slice(-2))).toEqual([0xff, 0xd9]);
  });

  it('orientation ≤ 1 → zwraca wejście bez zmian', () => {
    expect(withExifOrientation(plainJpeg, 1)).toBe(plainJpeg);
  });

  it('nie-JPEG → zwraca wejście bez zmian', () => {
    const notJpeg = new Uint8Array([0x00, 0x01, 0x02]);
    expect(withExifOrientation(notJpeg, 6)).toBe(notJpeg);
  });
});
