import { describe, it, expect } from 'vitest';
import { CreateKeySchema, UpdateKeySchema, ApiKeyDTO } from '../../../../src/lib/keys/schema';

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
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca brak wymaganych pól', () => {
    const result = ApiKeyDTO.safeParse({ id: '00000000-0000-4000-8000-000000000001' });
    expect(result.success).toBe(false);
  });
});
