-- BookShelf Catalog — vision_runs versioning (shelf-photo-pipeline-ui)
-- Wprowadza append-only wersjonowanie wywołań vision per photo:
--   - vision_runs: każde wywołanie /process tworzy nowy wiersz
--   - detections.vision_run_id FK: detekcje trwale przypięte do swojego runa
--   - Trigger: blokuje concurrent INSERT running dla tego samego photo (5-min window)
-- Backfill: synthetic succeeded run per photo z istniejącymi detekcjami.

-- 1. Table: vision_runs
create table public.vision_runs (
  id            uuid        primary key default gen_random_uuid(),
  photo_id      uuid        not null references public.photos(id) on delete cascade,
  model         text,
  prompt_version text,
  status        text        not null check (status in ('running','succeeded','failed')),
  cost_usd      numeric(10,6),
  latency_ms    int,
  error_message text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- Index: latest succeeded run for photo + concurrency check
create index vision_runs_photo_id_status_idx
  on public.vision_runs(photo_id, status, created_at desc);

-- 2. RLS — all 4 operations, predicate via photos.user_id
alter table public.vision_runs enable row level security;

create policy "vision_runs_select_own" on public.vision_runs
  for select using (
    exists (select 1 from public.photos where photos.id = vision_runs.photo_id and photos.user_id = auth.uid())
  );

create policy "vision_runs_insert_own" on public.vision_runs
  for insert with check (
    exists (select 1 from public.photos where photos.id = vision_runs.photo_id and photos.user_id = auth.uid())
  );

create policy "vision_runs_update_own" on public.vision_runs
  for update using (
    exists (select 1 from public.photos where photos.id = vision_runs.photo_id and photos.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.photos where photos.id = vision_runs.photo_id and photos.user_id = auth.uid())
  );

create policy "vision_runs_delete_own" on public.vision_runs
  for delete using (
    exists (select 1 from public.photos where photos.id = vision_runs.photo_id and photos.user_id = auth.uid())
  );

-- 3. Trigger: prevent concurrent running vision runs (5-minute window)
create or replace function public.prevent_concurrent_vision_run()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'running' and exists (
    select 1 from public.vision_runs
    where photo_id = new.photo_id
      and status = 'running'
      and created_at > now() - interval '5 minutes'
  ) then
    raise exception 'Vision run already in progress for this photo. Try again in a moment.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists vision_runs_prevent_concurrent on public.vision_runs;
create trigger vision_runs_prevent_concurrent
  before insert on public.vision_runs
  for each row execute function public.prevent_concurrent_vision_run();

-- 4. Add vision_run_id to detections (initially NULL for backfill)
alter table public.detections
  add column if not exists vision_run_id uuid references public.vision_runs(id) on delete cascade;

-- 5. Backfill: create synthetic succeeded vision_run per photo with ≥1 detection
-- Photos with vision_model IS NOT NULL but 0 detections are intentionally skipped
-- (they would create fake 'vision_done' stage with empty review list).
insert into public.vision_runs (photo_id, model, status, cost_usd, latency_ms, created_at, completed_at)
select
  p.id,
  p.vision_model,
  'succeeded',
  p.vision_cost_usd,
  p.vision_latency_ms,
  coalesce(p.processed_at, p.created_at),
  p.processed_at
from public.photos p
where exists (select 1 from public.detections where photo_id = p.id);

-- 6. Wire existing detections to their synthetic vision_run
update public.detections d
set vision_run_id = (
  select id from public.vision_runs where photo_id = d.photo_id order by created_at limit 1
)
where vision_run_id is null;

-- 7. Enforce NOT NULL now that backfill is complete
alter table public.detections
  alter column vision_run_id set not null;
