-- S-50: substrat dla fallbacku identyfikacji książki przez AI (Claude web_search).
--
-- 1. resolution_calls: tabela audytu kosztów (mirror refine_calls), ale
--    photo_id/detection_id nullable + api_key_id od startu (bez potrzeby
--    późniejszej migracji SET NULL jak w S-30/M27).
-- 2. book_candidates.source: dopuszcza 'ai_resolution'.
-- 3. corrections.correction_type: dopuszcza 'ai_resolution_not_found'.

create table resolution_calls (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id)     on delete cascade,
  photo_id      uuid        references photos(id)                  on delete set null,
  detection_id  uuid        references detections(id)              on delete set null,
  api_key_id    uuid        references user_api_keys(id)           on delete set null,
  model         text,
  status        text        not null check (status in ('found', 'not_found', 'error')),
  search_count  int,
  cost_usd      numeric(10,6),
  latency_ms    int,
  created_at    timestamptz not null default now()
);

alter table resolution_calls enable row level security;

create policy "resolution_calls_user_policy" on resolution_calls
  for all using (user_id = auth.uid());

create index resolution_calls_user_id_created_at_idx on resolution_calls(user_id, created_at);
create index resolution_calls_photo_id_idx on resolution_calls(photo_id);
create index resolution_calls_detection_id_idx on resolution_calls(detection_id);
create index resolution_calls_api_key_id_idx
  on resolution_calls(api_key_id)
  where api_key_id is not null;

-- book_candidates.source: dopuść 'ai_resolution' jako czwarte źródło.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.book_candidates'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%source%';
  if cname is not null then
    execute format('alter table public.book_candidates drop constraint %I', cname);
  end if;
end $$;

alter table book_candidates
  add constraint book_candidates_source_check
  check (source in ('google_books', 'open_library', 'national_library', 'ai_resolution'));

-- corrections.correction_type: dopuść 'ai_resolution_not_found'.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.corrections'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%correction_type%';
  if cname is not null then
    execute format('alter table public.corrections drop constraint %I', cname);
  end if;
end $$;

alter table corrections
  add constraint corrections_correction_type_check
  check (correction_type in (
    'title_typo', 'wrong_author', 'wrong_book', 'not_a_book', 'parse_failure',
    'accept', 'reject', 'field_edit', 'manual_entry', 'ai_resolution_not_found'
  ));
