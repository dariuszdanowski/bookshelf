import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../../../../../src/pages/api/auth/signup';

/**
 * Endpointy /api/auth/* nie importują createServerSupabaseClient — używają
 * locals.supabase z middleware. Mock pattern: builder makeContext({ supabase })
 * wstrzykuje fake APIContext, POST handler wywoływany bezpośrednio.
 */

type SignUpResult = {
  data: { user: { id: string } | null; session: unknown } | { user: null; session: null };
  error: { message: string; status?: number } | null;
};

function makeContext(opts: {
  body: unknown;
  signUp: SignUpResult;
}) {
  const signUpFn = vi.fn().mockResolvedValue(opts.signUp);
  const request = new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
  return {
    context: {
      request,
      locals: {
        supabase: { auth: { signUp: signUpFn } },
        user: null,
      },
    },
    signUpFn,
  };
}

const validBody = {
  email: 'new@example.com',
  password: 'secret123',
  display_name: 'New User',
};

beforeEach(() => vi.clearAllMocks());

describe('POST /api/auth/signup', () => {
  it('returns 200 + { data: { redirect: "/" } } on valid signup', async () => {
    const { context, signUpFn } = makeContext({
      body: validBody,
      signUp: {
        data: { user: { id: 'user-id-1' }, session: { access_token: 't' } },
        error: null,
      },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const json = (await res.json()) as { data: { redirect: string } };
    expect(json.data.redirect).toBe('/');
    expect(signUpFn).toHaveBeenCalledOnce();
    expect(signUpFn).toHaveBeenCalledWith({
      email: validBody.email,
      password: validBody.password,
      options: { data: { display_name: validBody.display_name } },
    });
  });

  it('returns 400 VALIDATION_ERROR on invalid Zod input with fieldErrors', async () => {
    const { context } = makeContext({
      body: { email: 'not-an-email', password: '12', display_name: '' },
      signUp: { data: { user: null, session: null }, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: { code: string; details: { fieldErrors: Record<string, string[]> } };
    };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.details.fieldErrors).toBeDefined();
  });

  it('returns 400 VALIDATION_ERROR when Supabase reports user already registered', async () => {
    const { context } = makeContext({
      body: validBody,
      signUp: {
        data: { user: null, session: null },
        error: { message: 'User already registered', status: 422 },
      },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toBe('Email is already registered.');
  });

  it('returns 500 INTERNAL_ERROR for unknown Supabase error', async () => {
    const { context } = makeContext({
      body: validBody,
      signUp: {
        data: { user: null, session: null },
        error: { message: 'Database connection refused', status: 500 },
      },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 INTERNAL_ERROR when data.user is null (auto-confirm not configured)', async () => {
    const { context } = makeContext({
      body: validBody,
      signUp: {
        data: { user: null, session: null },
        error: null,
      },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
    expect(json.error.message).toMatch(/auto-confirm/i);
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON body', async () => {
    const { context } = makeContext({
      body: '{not valid json',
      signUp: { data: { user: null, session: null }, error: null },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});
