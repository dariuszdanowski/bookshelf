-- Migration: add is_technical flag to profiles
-- Classifies test/technical accounts at DB level, replacing frontend heuristics.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_technical boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_technical_idx
  ON public.profiles (id) WHERE is_technical;

-- Backfill existing test accounts based on email prefixes from auth.users
UPDATE public.profiles p
SET is_technical = true
FROM auth.users u
WHERE p.id = u.id
  AND (
    u.email ILIKE 'e2e-%'
    OR u.email ILIKE 'ux-verify-%'
    OR u.email ILIKE 'debug-vision-%'
    OR u.email ILIKE 'rls-test-%'
    OR u.email ILIKE 'auth-trigger-%'
  );
