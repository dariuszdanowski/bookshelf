-- Phase 2 (admin-panel): dodaje kolumnę soft-delete dla profili
-- Idempotentne (add column if not exists) — bezpieczny retry przy db push

alter table public.profiles
  add column if not exists deleted_at timestamptz;

create index if not exists profiles_deleted_at_idx
  on public.profiles(deleted_at)
  where deleted_at is not null;
