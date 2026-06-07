import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  makeThumbnailBlob,
  THUMB_JPEG_QUALITY,
  THUMB_MAX_EDGE,
} from '../../../../src/lib/images/browserThumb';

// M15: miniatura browser-side jest best-effort — testujemy math skalowania
// (stub createImageBitmap + canvas) i graceful null na środowisku bez dekodera.

function makeFile() {
  return new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('makeThumbnailBlob (M15)', () => {
  it('zwraca null gdy createImageBitmap niedostępne/rzuca (jsdom, HEIC)', async () => {
    // jsdom nie ma createImageBitmap — naturalna ścieżka catch → null
    expect(await makeThumbnailBlob(makeFile())).toBeNull();
  });

  it('skaluje dłuższy bok do THUMB_MAX_EDGE z zachowaniem proporcji', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }),
    );

    const drawImage = vi.fn();
    const fakeBlob = new Blob(['jpg'], { type: 'image/jpeg' });
    const canvasSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      return {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({ drawImage }),
        toBlob: (cb: (b: Blob | null) => void, type: string, quality: number) => {
          expect(type).toBe('image/jpeg');
          expect(quality).toBe(THUMB_JPEG_QUALITY);
          cb(fakeBlob);
        },
      } as unknown as HTMLCanvasElement;
    });

    const result = await makeThumbnailBlob(makeFile());

    expect(result).toBe(fakeBlob);
    // 4000x3000 → scale 640/4000 = 0.16 → 640x480
    const canvas = canvasSpy.mock.results[0]!.value as { width: number; height: number };
    expect(canvas.width).toBe(THUMB_MAX_EDGE);
    expect(canvas.height).toBe(480);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, THUMB_MAX_EDGE, 480);
    expect(close).toHaveBeenCalled(); // WASM-style leak guard: bitmap zwolniony
  });

  it('nie powiększa obrazu mniejszego niż THUMB_MAX_EDGE (scale capped 1)', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 320, height: 200, close: vi.fn() }),
    );
    const fakeBlob = new Blob(['jpg'], { type: 'image/jpeg' });
    const canvasSpy = vi.spyOn(document, 'createElement').mockImplementation(
      () =>
        ({
          width: 0,
          height: 0,
          getContext: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
          toBlob: (cb: (b: Blob | null) => void) => cb(fakeBlob),
        }) as unknown as HTMLCanvasElement,
    );

    await makeThumbnailBlob(makeFile());

    const canvas = canvasSpy.mock.results[0]!.value as { width: number; height: number };
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(200);
  });

  it('zwraca null gdy getContext zawodzi', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }),
    );
    vi.spyOn(document, 'createElement').mockImplementation(
      () =>
        ({
          width: 0,
          height: 0,
          getContext: vi.fn().mockReturnValue(null),
        }) as unknown as HTMLCanvasElement,
    );

    expect(await makeThumbnailBlob(makeFile())).toBeNull();
  });
});
