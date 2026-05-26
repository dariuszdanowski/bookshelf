-- BookShelf Catalog — S-02 shelves constraints
-- Source: context/changes/shelves-crud-and-purchased/plan.md § Phase 1
--
-- Dodaje 2 warstwy DB-level guardrail dla półek:
--   1. UNIQUE (user_id, name) — user nie może mieć 2 półek o tej samej nazwie
--   2. Trigger BEFORE DELETE — systemowa półka "Zakupione" niesuwalna
--   3. Trigger BEFORE UPDATE — name "Zakupione" niemienialna (location można)
--
-- Defense in depth (UI też filtruje, Zod też refuse'uje 'Zakupione' na CREATE) —
-- DB triggers są ostatecznym guardem przed bug'iem w endpoint code.
--
-- Rollback semantics: brak custom EXCEPTION block w endpoint code; Postgres
-- rzuca SQLSTATE, klient endpoint mapuje na 400 VALIDATION_ERROR z czytelnym
-- message.

-- 1. UNIQUE constraint na (user_id, name)
alter table public.shelves
  add constraint shelves_user_name_unique unique (user_id, name);

-- 2. DELETE protection dla "Zakupione"
create or replace function public.prevent_zakupione_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.name = 'Zakupione' then
    raise exception 'Nie można usunąć systemowej półki "Zakupione"'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists shelves_protect_zakupione_delete on public.shelves;
create trigger shelves_protect_zakupione_delete
  before delete on public.shelves
  for each row
  execute function public.prevent_zakupione_delete();

-- 3. UPDATE name protection dla "Zakupione"
create or replace function public.prevent_zakupione_rename()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.name = 'Zakupione' and new.name is distinct from old.name then
    raise exception 'Nie można zmienić nazwy systemowej półki "Zakupione"'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists shelves_protect_zakupione_rename on public.shelves;
create trigger shelves_protect_zakupione_rename
  before update on public.shelves
  for each row
  execute function public.prevent_zakupione_rename();
