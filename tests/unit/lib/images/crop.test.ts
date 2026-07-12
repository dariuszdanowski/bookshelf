import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @cf-wasm/photon/workerd — WASM not available in jsdom
const mockFree = vi.fn();
const mockGetWidth = vi.fn(() => 1000);
const mockGetHeight = vi.fn(() => 800);
const mockCroppedGetWidth = vi.fn(() => 200);
const mockCroppedGetHeight = vi.fn(() => 150);
const mockGetBytesJpeg = vi.fn(() => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

const mockPhotonImage = {
  get_width: mockGetWidth,
  get_height: mockGetHeight,
  free: mockFree,
};

const mockCroppedImage = {
  get_width: mockCroppedGetWidth,
  get_height: mockCroppedGetHeight,
  free: mockFree,
};

const mockResizedImage = {
  get_bytes_jpeg: mockGetBytesJpeg,
  free: mockFree,
};

vi.mock('@cf-wasm/photon/workerd', () => ({
  PhotonImage: {
    new_from_byteslice: vi.fn(() => mockPhotonImage),
  },
  crop: vi.fn(() => mockCroppedImage),
  grayscale: vi.fn(),
  resize: vi.fn(() => mockResizedImage),
  SamplingFilter: { Lanczos3: 3 },
}));

import { deriveDetectionCrop } from '../../../../src/lib/images/crop';
import { PhotonImage, crop, resize } from '@cf-wasm/photon/workerd';
import { MAX_PHOTON_INPUT_BYTES } from '../../../../src/lib/images/limits';

const VALID_BBOX = { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5 };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetWidth.mockReturnValue(1000);
  mockGetHeight.mockReturnValue(800);
  mockCroppedGetWidth.mockReturnValue(200);
  mockCroppedGetHeight.mockReturnValue(150);
});

describe('deriveDetectionCrop', () => {
  it('zwraca bajty JPEG (Uint8Array) z get_bytes_jpeg', async () => {
    const buf = new ArrayBuffer(100);
    const result = await deriveDetectionCrop(buf, VALID_BBOX);
    expect(result.mediaType).toBe('image/jpeg');
    expect(result.bytes).toBeInstanceOf(Uint8Array);
  });

  it('woła crop z PhotonImage skonstruowanym z wejścia', async () => {
    const buf = new ArrayBuffer(100);
    await deriveDetectionCrop(buf, VALID_BBOX);
    expect(PhotonImage.new_from_byteslice).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(crop).toHaveBeenCalled();
  });

  it('zwalnia uchwyty WASM (.free na image/cropped/resized)', async () => {
    mockFree.mockClear();
    await deriveDetectionCrop(new ArrayBuffer(100), VALID_BBOX);
    expect(mockFree).toHaveBeenCalledTimes(3);
  });

  describe('size guard', () => {
    it('rzuca dla bufora > MAX_PHOTON_INPUT_BYTES i NIE woła PhotonImage', async () => {
      const buf = new ArrayBuffer(MAX_PHOTON_INPUT_BYTES + 1);
      await expect(deriveDetectionCrop(buf, VALID_BBOX)).rejects.toThrow(/za duże/);
      expect(PhotonImage.new_from_byteslice).not.toHaveBeenCalled();
    });

    it('przechodzi normalnie dla bufora dokładnie na granicy', async () => {
      const buf = new ArrayBuffer(MAX_PHOTON_INPUT_BYTES);
      await expect(deriveDetectionCrop(buf, VALID_BBOX)).resolves.toBeDefined();
      expect(PhotonImage.new_from_byteslice).toHaveBeenCalled();
      expect(resize).toHaveBeenCalled();
    });
  });
});
