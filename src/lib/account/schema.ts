import { z } from 'zod';

/**
 * Zod schemas dla account I/O — single source of truth dla walidacji edycji
 * profilu (S-31) i analizy kosztów (S-41).
 * Konsumowane przez endpointy server-side i pre-walidację w wyspach React.
 *
 * `display_name` spójny z `SignupSchema` (`src/lib/auth/schema.ts`): `.trim()`
 * przed `.min(1).max(100)` — pomija whitespace-only input, zachowuje czyste dane
 * w `profiles.display_name`.
 */

// Zod v4: preferowane `z.email()` vs deprecated `z.string().email()`.
export const UpdateProfileSchema = z.object({
  display_name: z.string().trim().min(1).max(100),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const ChangePasswordSchema = z
  .object({
    password: z.string().min(6),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    path: ['confirm'],
    message: 'Hasła nie są zgodne',
  });

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// S-41: Cost Analysis View — query params + DTO
// ──────────────────────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Query params dla GET /api/account/costs.
 * `key`: UUID klucza | 'none' (wywołania bez przypisania) | brak (wszystkie).
 * `type`: 'vision' | 'refine' | brak (wszystkie).
 * `period`: '7d' | '30d' | brak (wszystkie).
 * `page`: int ≥ 1, default 1.
 */
export const CostEventsQuerySchema = z.object({
  key: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === 'none' || UUID_REGEX.test(v), {
      message: "key musi być UUID, 'none' lub pominięte",
    }),
  type: z.enum(['vision', 'refine']).optional(),
  period: z.enum(['7d', '30d']).optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 1 : parseInt(v, 10)))
    .pipe(z.number().int().min(1, { message: 'page musi być ≥ 1' })),
});

export type CostEventsQuery = z.infer<typeof CostEventsQuerySchema>;

/** Pojedyncze zdarzenie kosztowe zwracane przez GET /api/account/costs. */
export type CostEventDTO = {
  id: string;
  kind: 'vision' | 'refine';
  model: string | null;
  cost_usd: number | null;
  latency_ms: number | null;
  created_at: string;
  api_key_id: string | null;
  photo_id: string | null;
  detection_id: string | null;
  raw_title: string | null;
};

/** Odpowiedź GET /api/account/costs. */
export type CostEventsResponseDTO = {
  items: CostEventDTO[];
  page: number;
  page_size: number;
  total_count: number;
  total_cost_usd: number;
};
