import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/keys/crypto', () => ({
  decryptWithEnvKey: vi.fn().mockResolvedValue('decrypted-api-key'),
}));

import { getActiveProviderConfig } from '../../../../src/lib/keys/getActiveProviderConfig';
import { decryptWithEnvKey } from '../../../../src/lib/keys/crypto';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const KEY_ID = '00000000-0000-4000-8000-000000000002';

const SAMPLE_ROW = {
  id: KEY_ID,
  provider: 'openai_compatible',
  encrypted_key: 'iv:ciphertext',
  model: 'glm-ocr',
  base_url: 'https://relay.example.com',
  request_timeout_ms: null,
  max_tokens_override: 8192,
};

type MockResult = { data: unknown; error: unknown };

// Buduje łańcuchowalny mock — .eq() zwraca ten sam builder (dowolna liczba
// wywołań), .maybeSingle() rozstrzyga wynik. Pozwala też asertować, jakich
// kolumn .eq() użyto (per-call-byok-key-override: kluczowa gałąź testu —
// czy zapytanie poszło po `id` czy po `is_active`).
function makeSupabaseMock(result: MockResult) {
  const eqCalls: [string, unknown][] = [];
  const builder = {
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    }),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  const selectFn = vi.fn(() => builder);
  const fromFn = vi.fn(() => ({ select: selectFn }));
  return { supabase: { from: fromFn } as never, eqCalls, fromFn, selectFn };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getActiveProviderConfig', () => {
  it('bez keyId — selectuje po is_active=true (zachowanie dzisiejsze)', async () => {
    const { supabase, eqCalls } = makeSupabaseMock({ data: SAMPLE_ROW, error: null });
    const result = await getActiveProviderConfig(supabase, USER_ID);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('openai_compatible');
    expect(result?.apiKey).toBe('decrypted-api-key');
    expect(result?.keyId).toBe(KEY_ID);
    expect(eqCalls).toContainEqual(['user_id', USER_ID]);
    expect(eqCalls).toContainEqual(['is_active', true]);
    expect(eqCalls).not.toContainEqual(['id', KEY_ID]);
  });

  it('z keyId — selectuje po id, ignoruje is_active', async () => {
    const { supabase, eqCalls } = makeSupabaseMock({ data: SAMPLE_ROW, error: null });
    const result = await getActiveProviderConfig(supabase, USER_ID, KEY_ID);
    expect(result).not.toBeNull();
    expect(result?.keyId).toBe(KEY_ID);
    expect(eqCalls).toContainEqual(['user_id', USER_ID]);
    expect(eqCalls).toContainEqual(['id', KEY_ID]);
    expect(eqCalls).not.toContainEqual(['is_active', true]);
  });

  it('z keyId nieistniejącym/cudzym — zwraca null (RLS + eq(user_id) filtrują wiersz)', async () => {
    const { supabase } = makeSupabaseMock({ data: null, error: null });
    const result = await getActiveProviderConfig(supabase, USER_ID, 'nonexistent-key-id');
    expect(result).toBeNull();
  });

  it('bez keyId, brak aktywnego klucza — zwraca null', async () => {
    const { supabase } = makeSupabaseMock({ data: null, error: null });
    const result = await getActiveProviderConfig(supabase, USER_ID);
    expect(result).toBeNull();
  });

  it('keyId=null (jawnie) traktowany jak brak — selectuje po is_active', async () => {
    const { supabase, eqCalls } = makeSupabaseMock({ data: SAMPLE_ROW, error: null });
    await getActiveProviderConfig(supabase, USER_ID, null);
    expect(eqCalls).toContainEqual(['is_active', true]);
  });

  it('błąd DB — zwraca null', async () => {
    const { supabase } = makeSupabaseMock({ data: null, error: { message: 'connection lost' } });
    const result = await getActiveProviderConfig(supabase, USER_ID, KEY_ID);
    expect(result).toBeNull();
  });

  it('błąd deszyfrowania — zwraca null', async () => {
    vi.mocked(decryptWithEnvKey).mockRejectedValueOnce(new Error('bad key material'));
    const { supabase } = makeSupabaseMock({ data: SAMPLE_ROW, error: null });
    const result = await getActiveProviderConfig(supabase, USER_ID, KEY_ID);
    expect(result).toBeNull();
  });
});
