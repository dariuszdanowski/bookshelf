import { describe, it, expect } from 'vitest';

describe('test runner', () => {
  it('runs vitest end-to-end', () => {
    expect(1 + 1).toBe(2);
  });

  it('has jsdom environment available', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });
});
