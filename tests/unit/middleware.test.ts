import type { AuthUser } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/db/supabase.server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from '../../src/lib/db/supabase.server';
// Importujemy core handler bezpośrednio z `lib/middleware/handler.ts` (bez
// `astro:middleware` virtual module, który Vite nie potrafi resolvować
// w Vitest — zob. komentarz w `src/middleware.ts`).
import { handleRequest } from '../../src/lib/middleware/handler';

const mockedCreate = vi.mocked(createServerSupabaseClient);

type FakeUser = Pick<AuthUser, 'id' | 'email'>;

function makeSupabase(user: FakeUser | null, opts: { throws?: boolean } = {}) {
  return {
    auth: {
      getUser: opts.throws
        ? vi.fn().mockRejectedValue(new Error('network blip'))
        : vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

type FakeContext = {
  request: Request;
  cookies: Record<string, never>;
  url: URL;
  locals: Partial<App.Locals>;
  redirect: ReturnType<typeof vi.fn>;
};

function makeContext(opts: {
  path: string;
  user?: FakeUser | null;
  throws?: boolean;
}): FakeContext {
  const supabase = makeSupabase(opts.user ?? null, { throws: opts.throws });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedCreate.mockReturnValue(supabase as any);

  const url = new URL(`http://localhost${opts.path}`);
  return {
    request: new Request(url.toString()),
    cookies: {},
    url,
    locals: {},
    redirect: vi.fn(
      (path: string) =>
        new Response(null, { status: 302, headers: { Location: path } })
    ),
  };
}

const next = vi.fn(async () => new Response('ok', { status: 200 }));

beforeEach(() => {
  vi.clearAllMocks();
  next.mockClear();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callMiddleware = (ctx: FakeContext) => handleRequest(ctx as any, next);

const ALICE: FakeUser = { id: 'user-a-id', email: 'alice@example.com' };

describe('middleware onRequest — public paths', () => {
  it('passes `/` through without session', async () => {
    const ctx = makeContext({ path: '/', user: null });
    const res = await callMiddleware(ctx);

    expect(next).toHaveBeenCalledOnce();
    expect(ctx.locals.user).toBeNull();
    expect(ctx.locals.supabase).toBeDefined();
    expect(res.status).toBe(200);
  });

  it('passes `/login` through without session', async () => {
    const ctx = makeContext({ path: '/login', user: null });
    await callMiddleware(ctx);
    expect(next).toHaveBeenCalledOnce();
    expect(ctx.redirect).not.toHaveBeenCalled();
  });

  it('passes `/api/auth/login` through without session (prefix match)', async () => {
    const ctx = makeContext({ path: '/api/auth/login', user: null });
    await callMiddleware(ctx);
    expect(next).toHaveBeenCalledOnce();
  });

  it('passes public path through WITH session, locals populated', async () => {
    const ctx = makeContext({ path: '/', user: ALICE });
    await callMiddleware(ctx);
    expect(next).toHaveBeenCalledOnce();
    expect(ctx.locals.user).toEqual(ALICE);
  });
});

describe('middleware onRequest — protected paths', () => {
  it('redirects unauthenticated user from protected page to /login (302)', async () => {
    const ctx = makeContext({ path: '/library', user: null });
    const res = await callMiddleware(ctx);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.redirect).toHaveBeenCalledWith('/login');
    expect(res.status).toBe(302);
  });

  it('returns 401 envelope for unauthenticated API request', async () => {
    const ctx = makeContext({ path: '/api/shelves', user: null });
    const res = await callMiddleware(ctx);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.redirect).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(res.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
      },
    });
  });

  it('lets authenticated user through to protected page', async () => {
    const ctx = makeContext({ path: '/library', user: ALICE });
    const res = await callMiddleware(ctx);

    expect(next).toHaveBeenCalledOnce();
    expect(ctx.redirect).not.toHaveBeenCalled();
    expect(ctx.locals.user).toEqual(ALICE);
    expect(res.status).toBe(200);
  });
});

describe('middleware onRequest — auth error handling', () => {
  it('treats getUser throw as anon, logs error, and redirects from protected page', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ctx = makeContext({ path: '/library', user: null, throws: true });
    const res = await callMiddleware(ctx);

    expect(ctx.locals.user).toBeNull();
    expect(ctx.locals.supabase).toBeDefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[middleware] auth.getUser failed',
      expect.objectContaining({ path: '/library' })
    );
    expect(ctx.redirect).toHaveBeenCalledWith('/login');
    expect(res.status).toBe(302);

    errorSpy.mockRestore();
  });
});
