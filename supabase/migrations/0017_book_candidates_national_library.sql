-- S-33: dopuść Bibliotekę Narodową (data.bn.org.pl) jako trzecie źródło kandydatów.
-- BN ma natywne pokrycie polskich edycji (recall, którego brakuje Google Books).
--
-- 0001 nałożył inline CHECK `source in ('google_books','open_library')` z auto-nazwą
-- (zwykle book_candidates_source_check). Zamiast zakładać nazwę, znajdujemy realny
-- check-constraint po jego definicji (odporne na nazewnictwo) i podmieniamy.

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
  check (source in ('google_books', 'open_library', 'national_library'));
