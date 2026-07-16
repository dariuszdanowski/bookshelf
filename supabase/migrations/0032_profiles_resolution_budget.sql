-- Migration: per-profile AI-resolution budget limits + soft daily reset marker
-- Przenosi maxCallsPerPhoto/maxCallsPerDay z globalnych stałych (budgetPolicy.ts) na
-- kolumny per-profil, edytowalne self-service przez użytkownika na /account.
-- Defaulty identyczne z dzisiejszymi stałymi — zero zmiany zachowania po migracji.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_resolution_max_calls_per_photo int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS ai_resolution_max_calls_per_day int NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS ai_resolution_daily_reset_at timestamptz;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_ai_resolution_max_calls_per_photo_range
  CHECK (ai_resolution_max_calls_per_photo BETWEEN 1 AND 10),
  ADD CONSTRAINT profiles_ai_resolution_max_calls_per_day_range
  CHECK (ai_resolution_max_calls_per_day BETWEEN 1 AND 100);
