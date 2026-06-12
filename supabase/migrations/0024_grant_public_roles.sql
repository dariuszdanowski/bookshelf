-- Granty dla ról anon/authenticated/service_role na schemacie public.
-- Supabase ustawia je domyślnie przy starcie projektu, ale nie są persistowane
-- przez migracje — po supabase db reset (lokalnie lub CI) trzeba je odtworzyć.
-- Idempotentne: GRANT jest no-op jeśli grant już istnieje.

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- Przyszłe tabele tworzono przez migracje będą dziedziczyć granty automatycznie
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;
