-- BookShelf Catalog — handle_new_user trigger (S-01)
-- Source: context/changes/email-password-auth/plan.md § Phase 1
--
-- Po INSERT do auth.users (signup) automatycznie:
--   1. Tworzy public.profiles row z display_name z user_metadata.
--   2. Tworzy public.shelves row z name='Zakupione' (FR-008: wirtualna półka
--      na bootstrap nowego usera — tu lądują książki nieprzypisane do realnej
--      półki).
--
-- SECURITY DEFINER + SET search_path = public, pg_temp:
--   Trigger uruchamia się w kontekście roli postgres (właściciel funkcji),
--   bo auth.users należy do auth schema (RLS-protected). search_path lock
--   chroni przed schema hijack (function injection via pg_catalog/temp
--   shadowing) — standardowy Supabase pattern, wymagane przez linter.
--
-- Rollback semantics: brak własnego EXCEPTION block — Postgres rollback'uje
-- całą transakcję signup gdy INSERT do profiles/shelves padnie (Q8 — atomic).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');

  insert into public.shelves (user_id, name)
  values (new.id, 'Zakupione');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
