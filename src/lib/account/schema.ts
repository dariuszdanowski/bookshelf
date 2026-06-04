import { z } from 'zod';

/**
 * Zod schemas dla account I/O — single source of truth dla walidacji edycji
 * profilu (S-31). Konsumowane przez `PATCH /api/account/profile` (server) oraz
 * pre-walidację w `AccountIsland` (browser).
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
