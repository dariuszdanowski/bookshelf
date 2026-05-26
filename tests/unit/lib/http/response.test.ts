import { describe, expect, it, vi } from 'vitest';

import { apiError, apiResponse, parseUuidParam } from '../../../../src/lib/http/response';

describe('apiResponse', () => {
  it('returns 200 + envelope { data } + default security headers', async () => {
    const res = apiResponse({ data: { x: 1 } });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(res.json()).resolves.toEqual({ data: { x: 1 } });
  });

  it('honors custom status (e.g. 201)', () => {
    const res = apiResponse({ data: { id: 'abc' }, status: 201 });
    expect(res.status).toBe(201);
  });

  it('merges custom headers without dropping defaults', () => {
    const res = apiResponse({
      data: { ok: true },
      headers: { 'X-Custom': 'yes' },
    });

    expect(res.headers.get('X-Custom')).toBe('yes');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});

describe('apiError', () => {
  it('returns envelope { error: { code, message } } without details when not provided', async () => {
    const res = apiError({ code: 'NOT_FOUND', status: 404, message: 'nope' });

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(res.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: 'nope' },
    });
  });

  it('includes details when provided', async () => {
    const res = apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'bad input',
      details: { field: 'name', issue: 'required' },
    });

    await expect(res.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad input',
        details: { field: 'name', issue: 'required' },
      },
    });
  });

  it('honors arbitrary status from caller (e.g. 401 for UNAUTHENTICATED)', () => {
    const res = apiError({
      code: 'UNAUTHENTICATED',
      status: 401,
      message: 'Authentication required.',
    });
    expect(res.status).toBe(401);
  });
});

describe('buildResponse fallback (F4 — JSON.stringify safety)', () => {
  it('apiResponse with circular ref → fallback 500 envelope + log', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    const res = apiResponse({ data: circular });

    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(res.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Response serialization failed.',
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      '[response] JSON.stringify failed',
      expect.objectContaining({ err: expect.any(String) })
    );

    errorSpy.mockRestore();
  });

  it('apiError with circular ref in details → fallback 500 envelope', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const circular: Record<string, unknown> = {};
    circular.loop = circular;

    const res = apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'bad input',
      details: circular,
    });

    // Fallback nadpisuje original status (400) na 500, bo serialization
    // zawiodła — klient dostaje deterministic error envelope zamiast crashu.
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Response serialization failed.',
      },
    });

    errorSpy.mockRestore();
  });
});

describe('parseUuidParam', () => {
  it('returns null for undefined / empty / malformed inputs', () => {
    expect(parseUuidParam(undefined)).toBeNull();
    expect(parseUuidParam('')).toBeNull();
    expect(parseUuidParam('not-a-uuid')).toBeNull();
    // Wrong segment lengths
    expect(parseUuidParam('a1b2c3d4-5678-90ab-cdef-1234567890a')).toBeNull();
    // Non-hex character
    expect(parseUuidParam('z1b2c3d4-5678-90ab-cdef-1234567890ab')).toBeNull();
  });

  it('returns lowercase string for a valid UUID (case-insensitive input)', () => {
    expect(parseUuidParam('A1B2C3D4-5678-90AB-CDEF-1234567890AB')).toBe(
      'a1b2c3d4-5678-90ab-cdef-1234567890ab'
    );
    expect(parseUuidParam('a1b2c3d4-5678-90ab-cdef-1234567890ab')).toBe(
      'a1b2c3d4-5678-90ab-cdef-1234567890ab'
    );
  });
});
