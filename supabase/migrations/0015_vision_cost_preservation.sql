-- BookShelf Catalog — vision-cost-preservation (S-30)
-- Koszty vision/refine muszą przeżyć usunięcie zdjęcia (przyszłe S-29 DELETE).
-- Zmiany:
--   1. vision_runs: + user_id (denorm) + trigger derywujący z photos + backfill;
--      FK photo_id CASCADE → SET NULL; RLS join-do-photos → bezpośredni user_id.
--   2. refine_calls: FK photo_id ORAZ detection_id CASCADE → SET NULL.
-- Po DELETE photo rekordy kosztów zostają z NULL photo_id/detection_id, cost+user_id zachowane.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. vision_runs.user_id (denorm) + backfill + trigger
-- ────────────────────────────────────────────────────────────────────────────

alter table public.vision_runs
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Backfill z photos (wszystkie istniejące vision_runs mają jeszcze photo_id)
update public.vision_runs vr
set user_id = (select p.user_id from public.photos p where p.id = vr.photo_id)
where user_id is null;

alter table public.vision_runs
  alter column user_id set not null;

create index if not exists vision_runs_user_id_idx on public.vision_runs(user_id);

-- F1: istniejący insert (process.ts) nie podaje user_id — trigger derywuje go z
-- photos przez photo_id. Biegnie przed NOT NULL i RLS with check → oba przechodzą.
-- Zero zmian kodu, zero okna deploy-przed-migracją (defense-in-depth, jak handle_new_user).
create or replace function public.set_vision_run_user_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.user_id is null then
    new.user_id := (select user_id from public.photos where id = new.photo_id);
  end if;
  return new;
end;
$$;

drop trigger if exists vision_runs_set_user_id on public.vision_runs;
create trigger vision_runs_set_user_id
  before insert on public.vision_runs
  for each row execute function public.set_vision_run_user_id();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. vision_runs.photo_id: CASCADE → SET NULL (rekord przeżywa DELETE photo)
-- ────────────────────────────────────────────────────────────────────────────

alter table public.vision_runs alter column photo_id drop not null;
alter table public.vision_runs drop constraint if exists vision_runs_photo_id_fkey;
alter table public.vision_runs
  add constraint vision_runs_photo_id_fkey
  foreign key (photo_id) references public.photos(id) on delete set null;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. vision_runs RLS: join-do-photos → bezpośredni user_id
--    (po photo_id=NULL join nic nie znajdzie → user nie odczytałby własnego kosztu)
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists "vision_runs_select_own" on public.vision_runs;
drop policy if exists "vision_runs_insert_own" on public.vision_runs;
drop policy if exists "vision_runs_update_own" on public.vision_runs;
drop policy if exists "vision_runs_delete_own" on public.vision_runs;

create policy "vision_runs_select_own" on public.vision_runs
  for select using (user_id = auth.uid());
create policy "vision_runs_insert_own" on public.vision_runs
  for insert with check (user_id = auth.uid());
create policy "vision_runs_update_own" on public.vision_runs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "vision_runs_delete_own" on public.vision_runs
  for delete using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- 4. refine_calls: photo_id ORAZ detection_id CASCADE → SET NULL
--    (photo→detection cascade też skasowałby refine_call; user_id zostaje NOT NULL)
-- ────────────────────────────────────────────────────────────────────────────

alter table public.refine_calls alter column photo_id drop not null;
alter table public.refine_calls drop constraint if exists refine_calls_photo_id_fkey;
alter table public.refine_calls
  add constraint refine_calls_photo_id_fkey
  foreign key (photo_id) references public.photos(id) on delete set null;

alter table public.refine_calls alter column detection_id drop not null;
alter table public.refine_calls drop constraint if exists refine_calls_detection_id_fkey;
alter table public.refine_calls
  add constraint refine_calls_detection_id_fkey
  foreign key (detection_id) references public.detections(id) on delete set null;
