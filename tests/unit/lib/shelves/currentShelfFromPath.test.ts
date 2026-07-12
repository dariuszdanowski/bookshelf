import { describe, expect, it } from 'vitest';

import { extractShelfIdFromPath } from '../../../../src/lib/shelves/currentShelfFromPath';

const VALID_UUID = 'e2554437-87d3-4a8e-a07d-1b936bacc596';

describe('extractShelfIdFromPath', () => {
  it('dopasowuje /shelves/<valid-uuid>', () => {
    expect(extractShelfIdFromPath(`/shelves/${VALID_UUID}`)).toBe(VALID_UUID);
  });

  it('nie dopasowuje /shelves (bez segmentu)', () => {
    expect(extractShelfIdFromPath('/shelves')).toBeNull();
  });

  it('nie dopasowuje /shelves/<uuid>/cokolwiek (podścieżka)', () => {
    expect(extractShelfIdFromPath(`/shelves/${VALID_UUID}/photos`)).toBeNull();
  });

  it('nie dopasowuje /library', () => {
    expect(extractShelfIdFromPath('/library')).toBeNull();
  });

  it('nie dopasowuje pustego stringa', () => {
    expect(extractShelfIdFromPath('')).toBeNull();
  });

  it('nie dopasowuje /shelves/<not-a-uuid>', () => {
    expect(extractShelfIdFromPath('/shelves/not-a-real-uuid')).toBeNull();
  });
});
