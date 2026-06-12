import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: {} }));

import { requireAdmin } from '../../src/lib/admin/guard';

function makeLocals(opts: {
  user?: { id: string } | null;
  isAdmin?: boolean;
  dbError?: boolean;
}): App.Locals {
  const { user = null, isAdmin = false, dbError = false } = opts;

  const supabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi
            .fn()
            .mockResolvedValue(
              dbError
                ? { data: null, error: { code: 'PGRST116', message: 'No rows' } }
                : { data: { is_admin: isAdmin }, error: null },
            ),
        }),
      }),
    }),
  };

  return { user, supabase } as unknown as App.Locals;
}

describe('requireAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('zwraca 401 gdy user=null', async () => {
    const result = await requireAdmin(makeLocals({ user: null }));
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
    const body = (await result?.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('zwraca 403 gdy is_admin=false', async () => {
    const result = await requireAdmin(makeLocals({ user: { id: 'u1' }, isAdmin: false }));
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
    const body = (await result?.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ADMIN_REQUIRED');
  });

  it('zwraca 403 gdy DB zwraca błąd', async () => {
    const result = await requireAdmin(makeLocals({ user: { id: 'u1' }, dbError: true }));
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  it('zwraca null gdy is_admin=true', async () => {
    const result = await requireAdmin(makeLocals({ user: { id: 'u1' }, isAdmin: true }));
    expect(result).toBeNull();
  });
});
