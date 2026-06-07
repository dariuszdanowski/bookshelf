-- M27 (uwagi-round3): atrybucja kosztów per klucz API.
-- vision_runs/refine_calls zapisują, którym kluczem wykonano wywołanie —
-- panel /account sumuje koszty przy każdym kluczu. Kolumna nullable:
-- historyczne wywołania (sprzed migracji) zostają bez atrybucji;
-- ON DELETE SET NULL — usunięcie klucza nie kasuje historii kosztów.

alter table vision_runs
  add column api_key_id uuid references user_api_keys(id) on delete set null;

alter table refine_calls
  add column api_key_id uuid references user_api_keys(id) on delete set null;

create index vision_runs_api_key_id_idx
  on vision_runs(api_key_id)
  where api_key_id is not null;

create index refine_calls_api_key_id_idx
  on refine_calls(api_key_id)
  where api_key_id is not null;
