import { z } from 'zod';

/**
 * Zod schemas dla auth I/O — single source of truth dla walidacji
 * email/password/display_name w endpointach /api/auth/{signup,login}.
 *
 * Walidujemy `password.min(6)` w obu schemach spójnie z Supabase Auth default
 * (Q2): pre-walidacja w Zod daje czytelniejszy field-level error niż generic
 * 401 "Invalid email or password" z Supabase dla za-krótkiego hasła.
 *
 * `display_name` z `.trim()` przed `.min(1).max(100)` — pomija whitespace-only
 * input + zachowuje czyste dane w profiles.display_name.
 */

// Zod v4: `z.email()` jest preferowane vs deprecated `z.string().email()`.
export const SignupSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  display_name: z.string().trim().min(1).max(100),
});

export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
});

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
