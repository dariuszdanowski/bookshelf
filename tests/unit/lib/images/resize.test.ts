import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @cf-wasm/photon/workerd — WASM not available in jsdom
const mockFree = vi.fn();
const mockGetWidth = vi.fn(() => 3000);
const mockGetHeight = vi.fn(() => 2000);
const mockGetBytesJpeg = vi.fn(() => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
const mockResizedGetWidth = vi.fn(() => 1568);
const mockResizedGetHeight = vi.fn(() => 1045);

const mockPhotonImage = {
  get_width: mockGetWidth,
  get_height: mockGetHeight,
  free: mockFree,
};

const mockResizedImage = {
  get_bytes_jpeg: mockGetBytesJpeg,
  get_width: mockResizedGetWidth,
  get_height: mockResizedGetHeight,
  free: mockFree,
};

vi.mock('@cf-wasm/photon/workerd', () => ({
  PhotonImage: {
    new_from_byteslice: vi.fn(() => mockPhotonImage),
  },
  resize: vi.fn(() => mockResizedImage),
  SamplingFilter: { Lanczos3: 3 },
}));

vi.mock('../../../../src/lib/images/exif', () => ({
  readExifOrientation: vi.fn(() => 1),
  withExifOrientation: vi.fn((jpeg: Uint8Array) => jpeg),
}));

import { deriveThumbnail, deriveWorkingCopy } from '../../../../src/lib/images/resize';
import { PhotonImage, resize } from '@cf-wasm/photon/workerd';
import { readExifOrientation, withExifOrientation } from '../../../../src/lib/images/exif';

beforeEach(() => {
  vi.clearAllMocks();
  // domyślnie orientacja 1 (bez tagu) — testy orientacji nadpisują
  vi.mocked(readExifOrientation).mockReturnValue(1);
  vi.mocked(withExifOrientation).mockImplementation((jpeg: Uint8Array) => jpeg);
});

describe('deriveWorkingCopy', () => {
  it('returns mediaType: image/jpeg always', async () => {
    const buf = new ArrayBuffer(100);
    const result = await deriveWorkingCopy(buf);
    expect(result.mediaType).toBe('image/jpeg');
  });

  it('resizes landscape 3000×2000 → longest edge ≤1568', async () => {
    mockGetWidth.mockReturnValue(3000);
    mockGetHeight.mockReturnValue(2000);

    const buf = new ArrayBuffer(100);
    await deriveWorkingCopy(buf);

    // resize called with newW ~1568, newH ~1045
    expect(resize).toHaveBeenCalledWith(mockPhotonImage, expect.any(Number), expect.any(Number), 3);
    const [, newW, newH] = (resize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      number,
      number,
      unknown,
    ];
    expect(Math.max(newW, newH)).toBeLessThanOrEqual(1568);
  });

  it('does not upscale: 800×600 stays as 800×600', async () => {
    mockGetWidth.mockReturnValue(800);
    mockGetHeight.mockReturnValue(600);

    const buf = new ArrayBuffer(100);
    await deriveWorkingCopy(buf);

    const [, newW, newH] = (resize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      number,
      number,
      unknown,
    ];
    expect(newW).toBe(800);
    expect(newH).toBe(600);
  });

  it('portrait 1000×3000 → longest edge ≤1568', async () => {
    mockGetWidth.mockReturnValue(1000);
    mockGetHeight.mockReturnValue(3000);

    const buf = new ArrayBuffer(100);
    await deriveWorkingCopy(buf);

    const [, newW, newH] = (resize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      number,
      number,
      unknown,
    ];
    expect(Math.max(newW, newH)).toBeLessThanOrEqual(1568);
    expect(newH).toBe(1568);
  });

  it('calls .free() on both source and resized images', async () => {
    mockFree.mockClear();
    const buf = new ArrayBuffer(100);
    await deriveWorkingCopy(buf);
    expect(mockFree).toHaveBeenCalledTimes(2);
  });

  it('constructs PhotonImage from input bytes', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    await deriveWorkingCopy(buf);
    expect(PhotonImage.new_from_byteslice).toHaveBeenCalledWith(expect.any(Uint8Array));
  });
});

describe('deriveThumbnail', () => {
  it('zwraca bajty JPEG (Uint8Array) z get_bytes_jpeg', async () => {
    const result = await deriveThumbnail(new ArrayBuffer(100));
    expect(result).toBeInstanceOf(Uint8Array);
    // mock get_bytes_jpeg zwraca JPEG magic bytes
    expect(Array.from(result.slice(0, 2))).toEqual([0xff, 0xd8]);
  });

  it('koduje JPEG jakością int 75 (NIE float 0.75)', async () => {
    await deriveThumbnail(new ArrayBuffer(100));
    expect(mockGetBytesJpeg).toHaveBeenCalledWith(75);
  });

  it('skaluje landscape 3000×2000 → dłuższy bok ≤640', async () => {
    mockGetWidth.mockReturnValue(3000);
    mockGetHeight.mockReturnValue(2000);
    await deriveThumbnail(new ArrayBuffer(100));
    const [, newW, newH] = (resize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      number,
      number,
      unknown,
    ];
    expect(Math.max(newW, newH)).toBeLessThanOrEqual(640);
    expect(newW).toBe(640);
  });

  it('portrait 1000×3000 → dłuższy bok ≤640', async () => {
    mockGetWidth.mockReturnValue(1000);
    mockGetHeight.mockReturnValue(3000);
    await deriveThumbnail(new ArrayBuffer(100));
    const [, newW, newH] = (resize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      number,
      number,
      unknown,
    ];
    expect(Math.max(newW, newH)).toBeLessThanOrEqual(640);
    expect(newH).toBe(640);
  });

  it('nie powiększa obrazu mniejszego niż 640 (scale capped 1)', async () => {
    mockGetWidth.mockReturnValue(400);
    mockGetHeight.mockReturnValue(300);
    await deriveThumbnail(new ArrayBuffer(100));
    const [, newW, newH] = (resize as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      number,
      number,
      unknown,
    ];
    expect(newW).toBe(400);
    expect(newH).toBe(300);
  });

  it('zwalnia oba uchwyty WASM (.free na source i resized)', async () => {
    mockFree.mockClear();
    await deriveThumbnail(new ArrayBuffer(100));
    expect(mockFree).toHaveBeenCalledTimes(2);
  });

  it('orientation=1 → NIE taguje EXIF (przekazuje surowy JPEG)', async () => {
    vi.mocked(readExifOrientation).mockReturnValue(1);
    await deriveThumbnail(new ArrayBuffer(100));
    expect(withExifOrientation).toHaveBeenCalledWith(expect.any(Uint8Array), 1);
  });

  it('orientation=6 → przepisuje tag EXIF do miniatury (bez obrotu pikseli)', async () => {
    vi.mocked(readExifOrientation).mockReturnValue(6);
    await deriveThumbnail(new ArrayBuffer(100));
    // resize woła się na surowym obrazie (NIE rotate — photon rotate psuje kolory)
    expect(resize).toHaveBeenCalledWith(mockPhotonImage, expect.any(Number), expect.any(Number), 3);
    expect(withExifOrientation).toHaveBeenCalledWith(expect.any(Uint8Array), 6);
  });

  it('orientation=3 → przepisuje tag EXIF=3', async () => {
    vi.mocked(readExifOrientation).mockReturnValue(3);
    await deriveThumbnail(new ArrayBuffer(100));
    expect(withExifOrientation).toHaveBeenCalledWith(expect.any(Uint8Array), 3);
  });

  it('zawsze zwalnia dokładnie 2 uchwyty (brak rotate = brak 3. uchwytu)', async () => {
    vi.mocked(readExifOrientation).mockReturnValue(6);
    mockFree.mockClear();
    await deriveThumbnail(new ArrayBuffer(100));
    expect(mockFree).toHaveBeenCalledTimes(2);
  });
});
