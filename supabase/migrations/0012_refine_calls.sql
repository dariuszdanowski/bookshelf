-- Tabela historii wywołań OCR (Refine) — koszty per detekcja
create table refine_calls (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id)   on delete cascade,
  photo_id    uuid        not null references photos(id)        on delete cascade,
  detection_id uuid       not null references detections(id)   on delete cascade,
  model       text,
  cost_usd    numeric(10,6),
  latency_ms  int,
  created_at  timestamptz not null default now()
);

alter table refine_calls enable row level security;

create policy "refine_calls_user_policy" on refine_calls
  for all using (user_id = auth.uid());

create index refine_calls_photo_id_idx     on refine_calls(photo_id);
create index refine_calls_detection_id_idx on refine_calls(detection_id);
