import { describe, expect, it } from 'vitest';

import { DetectionSchema } from '../../../../src/lib/vision/schema';

const validItem = {
  position: 1,
  title: 'Solaris',
  author: 'Stanisław Lem',
  confidence: 0.95,
  spine_color: 'niebieski',
};

describe('DetectionSchema', () => {
  it('accepts a valid detection array', () => {
    const result = DetectionSchema.safeParse([validItem]);
    expect(result.success).toBe(true);
  });

  it('accepts an empty array', () => {
    const result = DetectionSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('accepts author: null', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, author: null }]);
    expect(result.success).toBe(true);
  });

  it('accepts spine_color: null', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, spine_color: null }]);
    expect(result.success).toBe(true);
  });

  it('accepts confidence 0 (boundary)', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, confidence: 0 }]);
    expect(result.success).toBe(true);
  });

  it('accepts confidence 1 (boundary)', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, confidence: 1 }]);
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, title: '' }]);
    expect(result.success).toBe(false);
  });

  it('rejects confidence > 1', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, confidence: 1.1 }]);
    expect(result.success).toBe(false);
  });

  it('rejects confidence < 0', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, confidence: -0.1 }]);
    expect(result.success).toBe(false);
  });

  it('rejects spine_color not in palette', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, spine_color: 'purple' }]);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer position', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, position: 1.5 }]);
    expect(result.success).toBe(false);
  });

  it('rejects position 0 (must be positive)', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, position: 0 }]);
    expect(result.success).toBe(false);
  });

  it('rejects negative position', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, position: -1 }]);
    expect(result.success).toBe(false);
  });

  it('accepts multiple valid items', () => {
    const result = DetectionSchema.safeParse([
      validItem,
      { ...validItem, position: 2, title: 'Dune', spine_color: 'brązowy' },
    ]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(2);
  });

  // bbox tests (best-effort optional field)
  it('accepts item with bbox present', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, bbox: [0.1, 0.05, 0.25, 0.95] }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0].bbox).toEqual([0.1, 0.05, 0.25, 0.95]);
  });

  it('accepts item with bbox: null', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, bbox: null }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0].bbox).toBeNull();
  });

  it('accepts item without bbox field (undefined → optional)', () => {
    const result = DetectionSchema.safeParse([{ ...validItem }]);
    expect(result.success).toBe(true);
  });

  it('strips bbox to null when out-of-range (>1) — best-effort field', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, bbox: [0.1, 0.05, 1.5, 0.95] }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0].bbox).toBeNull();
  });

  it('strips bbox to null when out-of-range (<0) — best-effort field', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, bbox: [-0.1, 0.05, 0.25, 0.95] }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0].bbox).toBeNull();
  });

  it('strips bbox to null with wrong number of elements — best-effort field', () => {
    const result = DetectionSchema.safeParse([{ ...validItem, bbox: [0.1, 0.05, 0.25] }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0].bbox).toBeNull();
  });
});
