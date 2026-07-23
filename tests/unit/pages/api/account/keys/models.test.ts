import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../src/lib/keys/crypto', () => ({
  decryptWithEnvKey: vi.fn().mockResolvedValue('plaintext-api-key'),
}));
vi.mock('../../../../../../src/lib/keys/probe', () => ({
  listModels: vi.fn().mockResolvedValue({ ok: true, models: [{ id: 'model-a', available: true }] }),
}));

import { POST } from '../../../../../../src/pages/api/account/keys/models';
import { decryptWithEnvKey } from '../../../../../../src/lib/keys/crypto';
import { listModels } from '../../../../../../src/lib/keys/probe';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const KEY_ID = '00000000-0000-4000-8000-000000000002';

type PgError = { code?: string; message?: string; name?: string } | null;

function makeContext(opts: {
  body?: unknown;
  invalidJson?: boolean;
  fetchResult?: { data?: { encrypted_key: string } | null; error: PgError };
  user?: { id: string } | null;
}) {
  const singleFn = vi
    .fn()
    .mockResolvedValue(
      opts.fetchResult ?? { data: { encrypted_key: 'iv:ciphertext' }, error: null },
    );
  const eqUserFn = vi.fn(() => ({ single: singleFn }));
  const eqIdFn = vi.fn(() => ({ eq: eqUserFn }));
  const selectFn = vi.fn(() => ({ eq: eqIdFn }));
  const fromFn = vi.fn(() => ({ select: selectFn }));

  return {
    request: {
      json: opts.invalidJson
        ? vi.fn().mockRejectedValue(new Error('bad json'))
        : vi.fn().mockResolvedValue(opts.body ?? {}),
    },
    locals: {
      supabase: { from: fromFn } as never,
      user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
    },
    fromFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/account/keys/models', () => {
  it('zwraca 401 gdy brak usera', async () => {
    const ctx = makeContext({ user: null });
    const res = await POST(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('zwraca 400 na złym JSON', async () => {
    const ctx = makeContext({ invalidJson: true });
    const res = await POST(ctx as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('zwraca 400 gdy schema fail (brak base_url)', async () => {
    const ctx = makeContext({ body: { provider: 'openai_compatible', key_value: 'k' } });
    const res = await POST(ctx as never);
    expect(res.status).toBe(400);
  });

  it('ścieżka key_value: woła listModels bezpośrednio z podanym kluczem, bez DB', async () => {
    const ctx = makeContext({
      body: {
        provider: 'openai_compatible',
        base_url: 'https://relay.example.com/v1',
        key_value: 'raw-key',
      },
    });
    const res = await POST(ctx as never);
    expect(res.status).toBe(200);
    expect(ctx.fromFn).not.toHaveBeenCalled();
    expect(listModels).toHaveBeenCalledWith(
      'openai_compatible',
      'raw-key',
      'https://relay.example.com',
    );
    const json = (await res.json()) as { data: { result: string; models: unknown[] } };
    expect(json.data.result).toBe('ok');
    expect(json.data.models).toEqual([{ id: 'model-a', available: true }]);
  });

  it('ścieżka id: odszyfrowuje zapisany klucz i woła listModels', async () => {
    const ctx = makeContext({
      body: { provider: 'openai_compatible', base_url: 'https://relay.example.com', id: KEY_ID },
    });
    const res = await POST(ctx as never);
    expect(res.status).toBe(200);
    expect(decryptWithEnvKey).toHaveBeenCalledWith('iv:ciphertext');
    expect(listModels).toHaveBeenCalledWith(
      'openai_compatible',
      'plaintext-api-key',
      'https://relay.example.com',
    );
  });

  it('zwraca 404 gdy id nie należy do usera / nie istnieje', async () => {
    const ctx = makeContext({
      body: { provider: 'openai_compatible', base_url: 'https://relay.example.com', id: KEY_ID },
      fetchResult: { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    });
    const res = await POST(ctx as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('propaguje result:error gdy listModels zwraca ok:false', async () => {
    vi.mocked(listModels).mockResolvedValueOnce({ ok: false, models: [] });
    const ctx = makeContext({
      body: {
        provider: 'openai_compatible',
        base_url: 'https://relay.example.com',
        key_value: 'raw-key',
      },
    });
    const res = await POST(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { result: string; models: unknown[] } };
    expect(json.data.result).toBe('error');
    expect(json.data.models).toEqual([]);
  });
});
