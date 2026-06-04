import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../src/lib/keys/crypto', () => ({
  encryptWithEnvKey: vi.fn().mockResolvedValue('iv:ciphertext'),
}));

import { GET, POST } from '../../../../../../src/pages/api/account/keys/index';
import { encryptWithEnvKey } from '../../../../../../src/lib/keys/crypto';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const KEY_ID = '00000000-0000-4000-8000-000000000002';

const SAMPLE_KEY_ROW = {
  id: KEY_ID,
  label: 'Mój klucz',
  provider: 'anthropic',
  model: null,
  base_url: null,
  is_active: false,
  last_tested_at: null,
  last_test_result: null,
  created_at: '2026-01-01T00:00:00Z',
};

type PgError = { code?: string; message?: string; name?: string } | null;

function makeGetContext(opts: {
  data?: typeof SAMPLE_KEY_ROW[] | null;
  error?: PgError;
  user?: { id: string } | null;
}) {
  const orderFn = vi.fn().mockResolvedValue({ data: opts.data ?? [], error: opts.error ?? null });
  const eqFn = vi.fn(() => ({ order: orderFn }));
  const selectFn = vi.fn(() => ({ eq: eqFn }));
  const fromFn = vi.fn(() => ({ select: selectFn }));

  return {
    locals: {
      supabase: { from: fromFn } as never,
      user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
    },
  };
}

function makePostContext(opts: {
  body?: unknown;
  rawBody?: string;
  data?: typeof SAMPLE_KEY_ROW | null;
  error?: PgError;
  user?: { id: string } | null;
}) {
  const singleFn = vi.fn().mockResolvedValue({ data: opts.data ?? SAMPLE_KEY_ROW, error: opts.error ?? null });
  const selectFn = vi.fn(() => ({ single: singleFn }));
  const insertFn = vi.fn(() => ({ select: selectFn }));
  const fromFn = vi.fn(() => ({ insert: insertFn }));

  const body = opts.rawBody ?? JSON.stringify(opts.body ?? {});

  return {
    request: new Request('http://localhost/api/account/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    locals: {
      supabase: { from: fromFn } as never,
      user: opts.user === undefined ? ({ id: USER_ID } as never) : (opts.user as never),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/account/keys', () => {
  it('zwraca 200 + lista kluczy', async () => {
    const ctx = makeGetContext({ data: [SAMPLE_KEY_ROW] });
    const res = await GET(ctx as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { keys: typeof SAMPLE_KEY_ROW[] } };
    expect(json.data.keys).toHaveLength(1);
    expect(json.data.keys[0].id).toBe(KEY_ID);
  });

  it('nie zawiera encrypted_key w odpowiedzi', async () => {
    const ctx = makeGetContext({ data: [SAMPLE_KEY_ROW] });
    const res = await GET(ctx as never);
    const json = (await res.json()) as { data: { keys: Record<string, unknown>[] } };
    expect(json.data.keys[0]).not.toHaveProperty('encrypted_key');
  });

  it('zwraca 401 gdy user null', async () => {
    const ctx = makeGetContext({ user: null });
    const res = await GET(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('zwraca 500 przy błędzie DB', async () => {
    const ctx = makeGetContext({ data: null, error: { code: '08006', message: 'conn fail', name: 'PostgresError' } });
    const res = await GET(ctx as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('POST /api/account/keys', () => {
  it('zwraca 201 + nowy klucz (bez encrypted_key)', async () => {
    const ctx = makePostContext({
      body: { label: 'Mój klucz', provider: 'anthropic', key_value: 'sk-ant-test' },
    });
    const res = await POST(ctx as never);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { key: Record<string, unknown> } };
    expect(json.data.key.id).toBe(KEY_ID);
    expect(json.data.key).not.toHaveProperty('encrypted_key');
  });

  it('wywołuje encryptWithEnvKey z key_value', async () => {
    const ctx = makePostContext({
      body: { label: 'Test', provider: 'openai', key_value: 'sk-openai-abc' },
    });
    await POST(ctx as never);
    expect(encryptWithEnvKey).toHaveBeenCalledWith('sk-openai-abc');
  });

  it('zwraca 401 gdy user null', async () => {
    const ctx = makePostContext({ body: {}, user: null });
    const res = await POST(ctx as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('zwraca 400 przy Zod fail (brak key_value)', async () => {
    const ctx = makePostContext({ body: { label: 'Test', provider: 'anthropic' } });
    const res = await POST(ctx as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('zwraca 400 przy złym JSON', async () => {
    const ctx = makePostContext({ rawBody: 'not json' });
    const res = await POST(ctx as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('zwraca 500 przy błędzie DB', async () => {
    const ctx = makePostContext({
      body: { label: 'Test', provider: 'anthropic', key_value: 'sk-test' },
      data: null,
      error: { code: '08006', message: 'fail', name: 'PostgresError' },
    });
    const res = await POST(ctx as never);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});
