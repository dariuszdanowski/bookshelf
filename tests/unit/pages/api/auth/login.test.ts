import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../../../../../src/pages/api/auth/login';

type SignInResult = {
  data: unknown;
  error: { message: string; status?: number } | null;
};

function makeContext(opts: { body: unknown; signIn: SignInResult }) {
  const signInFn = vi.fn().mockResolvedValue(opts.signIn);
  const request = new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
  return {
    context: {
      request,
      locals: {
        supabase: { auth: { signInWithPassword: signInFn } },
        user: null,
      },
    },
    signInFn,
  };
}

const validBody = { email: 'user@example.com', password: 'secret123' };

beforeEach(() => vi.clearAllMocks());

describe('POST /api/auth/login', () => {
  it('returns 200 + { data: { redirect: "/" } } on valid credentials', async () => {
    const { context, signInFn } = makeContext({
      body: validBody,
      signIn: {
        data: {
          session: { access_token: 't' },
          user: { id: 'user-1', email: 'user@example.com' },
        },
        error: null,
      },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const json = (await res.json()) as { data: { redirect: string } };
    expect(json.data.redirect).toBe('/');
    expect(signInFn).toHaveBeenCalledWith(validBody);
  });

  it('returns 401 UNAUTHENTICATED when Supabase error has status=null/undefined (transport blip)', async () => {
    const { context } = makeContext({
      body: validBody,
      signIn: {
        data: null,
        error: { message: 'Network error' }, // status undefined
      },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 UNAUTHENTICATED when Supabase returns no error but data.user is missing', async () => {
    const { context } = makeContext({
      body: validBody,
      signIn: { data: { session: null, user: null }, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 400 VALIDATION_ERROR for invalid Zod input', async () => {
    const { context } = makeContext({
      body: { email: 'bad', password: 'x' },
      signIn: { data: null, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 UNAUTHENTICATED for bad credentials (status 400 from Supabase)', async () => {
    const { context } = makeContext({
      body: validBody,
      signIn: {
        data: null,
        error: { message: 'Invalid login credentials', status: 400 },
      },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
    expect(json.error.message).toBe('Invalid email or password.');
  });

  it('returns 500 INTERNAL_ERROR for unknown Supabase error', async () => {
    const { context } = makeContext({
      body: validBody,
      signIn: {
        data: null,
        error: { message: 'Service unavailable', status: 503 },
      },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON body', async () => {
    const { context } = makeContext({
      body: 'not-json',
      signIn: { data: null, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(400);
  });
});
