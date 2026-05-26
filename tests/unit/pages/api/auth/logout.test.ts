import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../../../../../src/pages/api/auth/logout';

type SignOutResult = { error: { message: string } | null };

function makeContext(opts: { signOut: SignOutResult; user?: { id: string } | null }) {
  const signOutFn = vi.fn().mockResolvedValue(opts.signOut);
  return {
    context: {
      request: new Request('http://localhost/api/auth/logout', { method: 'POST' }),
      locals: {
        supabase: { auth: { signOut: signOutFn } },
        user: opts.user ?? null,
      },
    },
    signOutFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/auth/logout', () => {
  it('returns 200 + { data: { redirect: "/" } } when logged user signs out', async () => {
    const { context, signOutFn } = makeContext({
      signOut: { error: null },
      user: { id: 'user-id-1' },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const json = (await res.json()) as { data: { redirect: string } };
    expect(json.data.redirect).toBe('/');
    expect(signOutFn).toHaveBeenCalledOnce();
  });

  it('returns 200 idempotently when user was already null', async () => {
    const { context } = makeContext({
      signOut: { error: null },
      user: null,
    });

    const res = await POST(context as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { redirect: string } };
    expect(json.data.redirect).toBe('/');
  });

  it('returns 500 INTERNAL_ERROR when Supabase signOut errors (network blip)', async () => {
    const { context } = makeContext({
      signOut: { error: { message: 'network blip' } },
      user: { id: 'user-id-1' },
    });

    const res = await POST(context as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});
