import { describe, expect, it } from 'vitest';

import {
  CreateShelfSchema,
  ShelfNameSchema,
  UpdateShelfSchema,
} from '../../../../src/lib/shelves/schema';

describe('ShelfNameSchema', () => {
  it('accepts valid name', () => {
    const result = ShelfNameSchema.safeParse('Belletrystyka');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('Belletrystyka');
  });

  it('rejects empty name', () => {
    const result = ShelfNameSchema.safeParse('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/pusta/);
    }
  });

  it('rejects whitespace-only name (after trim)', () => {
    const result = ShelfNameSchema.safeParse('   ');
    expect(result.success).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    const result = ShelfNameSchema.safeParse('  Nauka  ');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('Nauka');
  });

  it('rejects name longer than 100 chars', () => {
    const longName = 'A'.repeat(101);
    const result = ShelfNameSchema.safeParse(longName);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/maksymalnie 100/);
    }
  });

  it('rejects reserved name "Zakupione"', () => {
    const result = ShelfNameSchema.safeParse('Zakupione');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/Zakupione.*zarezerwowana/);
    }
  });
});

describe('CreateShelfSchema', () => {
  it('accepts name only (location optional)', () => {
    const result = CreateShelfSchema.safeParse({ name: 'Komiksy' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Komiksy');
      expect(result.data.location).toBeUndefined();
    }
  });

  it('accepts name + location', () => {
    const result = CreateShelfSchema.safeParse({
      name: 'Komiksy',
      location: 'Salon, ściana zachodnia',
    });
    expect(result.success).toBe(true);
  });

  it('rejects location longer than 200 chars', () => {
    const result = CreateShelfSchema.safeParse({
      name: 'OK',
      location: 'A'.repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateShelfSchema', () => {
  it('accepts name only', () => {
    const result = UpdateShelfSchema.safeParse({ name: 'Nowa nazwa' });
    expect(result.success).toBe(true);
  });

  it('accepts location only', () => {
    const result = UpdateShelfSchema.safeParse({ location: 'Sypialnia' });
    expect(result.success).toBe(true);
  });

  it('rejects empty object (no fields)', () => {
    const result = UpdateShelfSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/Co najmniej jedno/);
    }
  });

  it('rejects reserved name on update too (Zakupione cannot be assigned)', () => {
    const result = UpdateShelfSchema.safeParse({ name: 'Zakupione' });
    expect(result.success).toBe(false);
  });
});
