import { z } from 'zod';

export const ProviderEnum = z.enum(['anthropic', 'openai', 'openrouter', 'openai_compatible']);

// resolution-openai-compatible-provider: client.ts/probe.ts we wszystkich providerach
// zawsze doklejają "/v1/..." do base_url (wzorzec z vision/client.ts) — jeśli user
// wklei URL z już obecnym trailing "/v1" (częsty błąd — dostawcy często pokazują
// URL z tym sufiksem), wołania trafiają w "/v1/v1/..." i 404-ują. Normalizujemy raz,
// przy zapisie, żeby żaden z trzech konsumentów (vision, resolution, probe) nie musiał
// się o to martwić.
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

const baseUrlField = z
  .string()
  .url()
  .max(500)
  .nullish()
  .transform((v) => (v ? normalizeBaseUrl(v) : v));

export const CreateKeySchema = z.object({
  label: z.string().trim().min(1).max(100),
  provider: ProviderEnum,
  key_value: z.string().min(1).max(500),
  model: z.string().max(100).nullish(),
  base_url: baseUrlField,
  request_timeout_ms: z.number().int().positive().max(300_000).nullish(),
  max_tokens_override: z.number().int().positive().max(32_000).nullish(),
});

export const UpdateKeySchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    is_active: z.boolean().optional(),
    provider: ProviderEnum.optional(),
    model: z.string().max(100).nullish(),
    base_url: baseUrlField,
    key_value: z.string().min(1).max(500).optional(),
    request_timeout_ms: z.number().int().positive().max(300_000).nullish(),
    max_tokens_override: z.number().int().positive().max(32_000).nullish(),
  })
  .refine(
    (d) =>
      d.label !== undefined ||
      d.is_active !== undefined ||
      d.provider !== undefined ||
      d.model !== undefined ||
      d.base_url !== undefined ||
      d.key_value !== undefined ||
      d.request_timeout_ms !== undefined ||
      d.max_tokens_override !== undefined,
    { message: 'At least one field required' },
  );

export const ApiKeyDTO = z.object({
  id: z.string().uuid(),
  label: z.string(),
  provider: ProviderEnum,
  model: z.string().nullable(),
  base_url: z.string().nullable(),
  is_active: z.boolean(),
  last_tested_at: z.string().nullable(),
  last_test_result: z.enum(['ok', 'error']).nullable(),
  created_at: z.string(),
  request_timeout_ms: z.number().nullable(),
  max_tokens_override: z.number().nullable(),
});

export type ApiKeyDTO = z.infer<typeof ApiKeyDTO>;
export type CreateKeyInput = z.infer<typeof CreateKeySchema>;
export type UpdateKeyInput = z.infer<typeof UpdateKeySchema>;
