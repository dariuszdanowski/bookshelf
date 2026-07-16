-- unify-detection-edit-entrypoint (Faza 1): dopuść 'manual' jako źródło book_candidates.
--
-- Draft-kandydat tworzony przy kliknięciu placeholdera okładki dla detekcji
-- bez matcha (POST /api/detections/[id]/candidate) potrzebuje source='manual',
-- żeby wstawienie nie padło na 23514 (check_violation). Addytywne — rozszerza
-- istniejący CHECK, nie zmienia żadnych istniejących wierszy.

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
  check (source in ('google_books', 'open_library', 'national_library', 'ai_resolution', 'manual'));
