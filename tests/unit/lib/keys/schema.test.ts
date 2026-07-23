import { describe, it, expect } from 'vitest';
import {
  CreateKeySchema,
  UpdateKeySchema,
  ApiKeyDTO,
  ApiKeyOverrideSchema,
  ListModelsInputSchema,
  normalizeBaseUrl,
} from '../../../../src/lib/keys/schema';

describe('CreateKeySchema', () => {
  it('akceptuje minimalny valid input', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Mój klucz',
      provider: 'anthropic',
      key_value: 'sk-ant-test',
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje openai_compatible z base_url', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Local LLM',
      provider: 'openai_compatible',
      key_value: 'test-key',
      base_url: 'https://api.example.com',
      model: 'gpt-4',
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje openai_compatible bez base_url (optional)', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Local LLM',
      provider: 'openai_compatible',
      key_value: 'test-key',
    });
    expect(result.success).toBe(true);
  });

  // resolution-openai-compatible-provider: client.ts/probe.ts zawsze doklejają
  // "/v1/..." do base_url — trailing "/v1" wpisany przez usera (częsty błąd)
  // musi być ucięty przy zapisie, inaczej wołania trafiają w "/v1/v1/...".
  it('normalizuje base_url z trailing /v1', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Local LLM',
      provider: 'openai_compatible',
      key_value: 'test-key',
      base_url: 'https://relay.example.com/v1',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.base_url).toBe('https://relay.example.com');
  });

  it('normalizuje base_url z trailing /v1/', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Local LLM',
      provider: 'openai_compatible',
      key_value: 'test-key',
      base_url: 'https://relay.example.com/v1/',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.base_url).toBe('https://relay.example.com');
  });

  it('nie zmienia base_url bez trailing /v1', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Local LLM',
      provider: 'openai_compatible',
      key_value: 'test-key',
      base_url: 'https://relay.example.com',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.base_url).toBe('https://relay.example.com');
  });

  it('odrzuca brak key_value', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Test',
      provider: 'openai',
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca za długi label (>100)', () => {
    const result = CreateKeySchema.safeParse({
      label: 'a'.repeat(101),
      provider: 'anthropic',
      key_value: 'sk-test',
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca nieprawidłowy URL w base_url', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Test',
      provider: 'openai_compatible',
      key_value: 'key',
      base_url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca nieznany provider', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Test',
      provider: 'unknown_provider',
      key_value: 'key',
    });
    expect(result.success).toBe(false);
  });

  it('akceptuje request_timeout_ms i max_tokens_override', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Local LLM',
      provider: 'openai_compatible',
      key_value: 'key',
      request_timeout_ms: 60_000,
      max_tokens_override: 4000,
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca request_timeout_ms powyżej 300000', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Test',
      provider: 'openai_compatible',
      key_value: 'key',
      request_timeout_ms: 300_001,
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca max_tokens_override powyżej 32000', () => {
    const result = CreateKeySchema.safeParse({
      label: 'Test',
      provider: 'openai_compatible',
      key_value: 'key',
      max_tokens_override: 32_001,
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateKeySchema', () => {
  it('akceptuje tylko label', () => {
    expect(UpdateKeySchema.safeParse({ label: 'Nowa etykieta' }).success).toBe(true);
  });

  it('akceptuje tylko is_active', () => {
    expect(UpdateKeySchema.safeParse({ is_active: true }).success).toBe(true);
  });

  it('akceptuje oba pola', () => {
    expect(UpdateKeySchema.safeParse({ label: 'Test', is_active: false }).success).toBe(true);
  });

  it('odrzuca pusty obiekt (żadne pole nie podane)', () => {
    expect(UpdateKeySchema.safeParse({}).success).toBe(false);
  });

  it('akceptuje tylko request_timeout_ms', () => {
    expect(UpdateKeySchema.safeParse({ request_timeout_ms: 30_000 }).success).toBe(true);
  });

  it('akceptuje tylko max_tokens_override', () => {
    expect(UpdateKeySchema.safeParse({ max_tokens_override: 2048 }).success).toBe(true);
  });

  it('akceptuje request_timeout_ms null (czyszczenie override)', () => {
    expect(UpdateKeySchema.safeParse({ request_timeout_ms: null }).success).toBe(true);
  });
});

describe('ApiKeyDTO', () => {
  it('parsuje kompletny obiekt', () => {
    const result = ApiKeyDTO.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      label: 'Mój klucz',
      provider: 'anthropic',
      model: null,
      base_url: null,
      is_active: true,
      last_tested_at: null,
      last_test_result: null,
      created_at: '2026-01-01T00:00:00Z',
      request_timeout_ms: null,
      max_tokens_override: null,
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca brak wymaganych pól', () => {
    const result = ApiKeyDTO.safeParse({ id: '00000000-0000-4000-8000-000000000001' });
    expect(result.success).toBe(false);
  });
});

describe('normalizeBaseUrl', () => {
  it('usuwa trailing /v1 i trailing slash', () => {
    expect(normalizeBaseUrl('https://relay.example.com/v1')).toBe('https://relay.example.com');
    expect(normalizeBaseUrl('https://relay.example.com/v1/')).toBe('https://relay.example.com');
    expect(normalizeBaseUrl('https://relay.example.com/')).toBe('https://relay.example.com');
  });

  it('nie zmienia URL bez trailing /v1', () => {
    expect(normalizeBaseUrl('https://relay.example.com')).toBe('https://relay.example.com');
  });
});

describe('ListModelsInputSchema', () => {
  it('akceptuje z key_value (bez id)', () => {
    const result = ListModelsInputSchema.safeParse({
      provider: 'openai_compatible',
      base_url: 'https://relay.example.com',
      key_value: 'test-key',
    });
    expect(result.success).toBe(true);
  });

  it('akceptuje z id (bez key_value)', () => {
    const result = ListModelsInputSchema.safeParse({
      provider: 'openai_compatible',
      base_url: 'https://relay.example.com',
      id: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca gdy brak zarówno id jak i key_value', () => {
    const result = ListModelsInputSchema.safeParse({
      provider: 'openai_compatible',
      base_url: 'https://relay.example.com',
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca nieprawidłowy URL w base_url', () => {
    const result = ListModelsInputSchema.safeParse({
      provider: 'openai_compatible',
      base_url: 'not-a-url',
      key_value: 'test-key',
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca brak base_url', () => {
    const result = ListModelsInputSchema.safeParse({
      provider: 'openai_compatible',
      key_value: 'test-key',
    });
    expect(result.success).toBe(false);
  });
});

describe('ApiKeyOverrideSchema', () => {
  it('akceptuje pusty obiekt (brak override)', () => {
    expect(ApiKeyOverrideSchema.safeParse({}).success).toBe(true);
  });

  it('akceptuje poprawny apiKeyId (UUID)', () => {
    const result = ApiKeyOverrideSchema.safeParse({
      apiKeyId: '00000000-0000-4000-8000-000000000002',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.apiKeyId).toBe('00000000-0000-4000-8000-000000000002');
  });

  it('odrzuca apiKeyId, który nie jest UUID', () => {
    expect(ApiKeyOverrideSchema.safeParse({ apiKeyId: 'not-a-uuid' }).success).toBe(false);
  });
});
