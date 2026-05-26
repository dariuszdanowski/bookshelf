import { describe, expect, it } from 'vitest';

import { LoginSchema, SignupSchema } from '../../../../src/lib/auth/schema';

describe('SignupSchema', () => {
  const valid = {
    email: 'user@example.com',
    password: 'secret123',
    display_name: 'Alice',
  };

  it('accepts valid input', () => {
    const r = SignupSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('user@example.com');
      expect(r.data.display_name).toBe('Alice');
    }
  });

  it('rejects invalid email format', () => {
    const r = SignupSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('rejects password shorter than 6 chars', () => {
    const r = SignupSchema.safeParse({ ...valid, password: '12345' });
    expect(r.success).toBe(false);
  });

  it('accepts password at boundary (exactly 6 chars)', () => {
    const r = SignupSchema.safeParse({ ...valid, password: '123456' });
    expect(r.success).toBe(true);
  });

  it('rejects empty display_name', () => {
    const r = SignupSchema.safeParse({ ...valid, display_name: '' });
    expect(r.success).toBe(false);
  });

  it('rejects whitespace-only display_name (trimmed to empty)', () => {
    const r = SignupSchema.safeParse({ ...valid, display_name: '   ' });
    expect(r.success).toBe(false);
  });

  it('rejects display_name longer than 100 chars', () => {
    const r = SignupSchema.safeParse({
      ...valid,
      display_name: 'a'.repeat(101),
    });
    expect(r.success).toBe(false);
  });

  it('accepts display_name at boundary (exactly 100 chars)', () => {
    const r = SignupSchema.safeParse({
      ...valid,
      display_name: 'a'.repeat(100),
    });
    expect(r.success).toBe(true);
  });

  it('trims whitespace from display_name', () => {
    const r = SignupSchema.safeParse({ ...valid, display_name: '  Alice  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.display_name).toBe('Alice');
  });
});

describe('LoginSchema', () => {
  const valid = { email: 'user@example.com', password: 'secret123' };

  it('accepts valid input', () => {
    const r = LoginSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const r = LoginSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('rejects password shorter than 6 chars', () => {
    const r = LoginSchema.safeParse({ ...valid, password: '12345' });
    expect(r.success).toBe(false);
  });

  it('accepts password at boundary (exactly 6 chars)', () => {
    const r = LoginSchema.safeParse({ ...valid, password: '123456' });
    expect(r.success).toBe(true);
  });
});
