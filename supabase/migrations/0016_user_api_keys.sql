create table user_api_keys (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  label            text not null,
  provider         text not null check (provider in ('anthropic','openai','openrouter','openai_compatible')),
  model            text,
  base_url         text,
  encrypted_key    text not null,
  is_active        boolean not null default false,
  last_tested_at   timestamptz,
  last_test_result text check (last_test_result in ('ok','error')),
  created_at       timestamptz default now()
);

alter table user_api_keys enable row level security;

create policy "user_api_keys_select_own" on user_api_keys
  for select using (user_id = auth.uid());

create policy "user_api_keys_insert_own" on user_api_keys
  for insert with check (user_id = auth.uid());

create policy "user_api_keys_update_own" on user_api_keys
  for update using (user_id = auth.uid());

create policy "user_api_keys_delete_own" on user_api_keys
  for delete using (user_id = auth.uid());

-- Wymusza ≤1 aktywny klucz per user na poziomie DB.
-- Naruszenie → SQLSTATE 23505 → endpoint zwraca 400 VALIDATION_ERROR.
create unique index user_api_keys_one_active_per_user
  on user_api_keys(user_id)
  where is_active = true;
