import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../src/lib/keys/crypto', () => ({
  decryptWithEnvKey: vi.fn().mockResolvedValue('plaintext-api-key'),
}));
vi.mock('../../../../../../src/lib/keys/probe', () => ({
  probeKey: vi.fn().mockResolvedValue('ok'),
}));

import { POST } from '../../../../../../src/pages/api/account/keys/[id]/test';
import { decryptWithEnvKey } from '../../../../../../src/lib/keys/crypto';
import { probeKey } from '../../../../../../src/lib/keys/probe';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const KEY_ID = '00000000-0000-4000-8000-000000000002';

const SAMPLE_DB_ROW = {
  id: KEY_ID,
  provider: 'anthropic',
  model: null,
  base_url: null,
  encrypted_key: 'iv:ciphertext',
  user_id: USER_ID,
};

type PgError = { code?: string; message?: string; name?: string } | null;

function makeContext(opts: {
  id?: string;
  fetchResult?: { data?: typeof SAMPLE_DB_ROW | null; error: PgError };
  updateError?: PgError;
  user?: { id: string } | null;
}) {
  const updateEqFn = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const updateFn = vi.fn(() => ({ eq: updateEqFn }));

  const fetchSingleFn = vi.fn().mockResolvedValue(
    opts.fetchResult ?? { data: SAMPLE_DB_ROW, error: null }
  );
  const fetchEqUserFn = vi.fn(() => ({ single: fetchSingleFn }));
  const fetchEqIdFn = vi.fn(() => ({ eq: fetchEqUserFn }));
  const fetchSelectFn = vi.fn(() => ({ eq: fetchEqIdFn }));

  let callCount = 0;
  const fromFn = vi.fn(() => {
    callCount++;
    if (callCount === 1) return { select: fetchSelectFn };
    return { update: updateFn };
  });

  return {
    params: { id: opts.id ?? KEY_ID },
    fromFn,
    locals: {
      supabase: { from: fromFn } as never,
      user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/account/keys/[id]/test', () => {
  it('zwraca 200 result=ok gdy probe ok', async () => {
    const ctx = makeContext({});
    const res = await POST(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { result: string } };
    expect(json.data.result).toBe('ok');
  });

  it('aktualizuje last_tested_at i last_test_result w DB', async () => {
    const ctx = makeContext({});
    await POST(ctx as never);
    expect(ctx.fromFn).toHaveBeenCalledTimes(2);
    expect(decryptWithEnvKey).toHaveBeenCalledWith('iv:ciphertext');
    expect(probeKey).toHaveBeenCalledWith('anthropic', 'plaintext-api-key', null);
  });

  it('zwraca 200 result=error gdy probe zwraca error', async () => {
    vi.mocked(probeKey).mockResolvedValueOnce('error');
    const ctx = makeContext({});
    const res = await POST(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { result: string } };
    expect(json.data.result).toBe('error');
  });

  it('zwraca 401 gdy user null', async () => {
    const ctx = makeContext({ user: null });
    const res = await POST(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('zwraca 404 gdy klucz nie istnieje (PGRST116)', async () => {
    const ctx = makeContext({
      fetchResult: { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    });
    const res = await POST(ctx as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });
});
