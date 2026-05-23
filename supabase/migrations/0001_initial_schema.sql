-- BookShelf Catalog — initial schema (M1)
-- Source: docs/prd.md § 7
-- 8 tables, no RLS yet (added in 0002_rls_policies.sql)

create extension if not exists pgcrypto;

-- 1. profiles (extends auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- 2. shelves
create table shelves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location text,
  position_index int not null default 0,
  created_at timestamptz not null default now()
);
create index shelves_user_id_idx on shelves(user_id);

-- 3. photos
create table photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shelf_id uuid not null references shelves(id) on delete cascade,
  storage_path text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded','processing','processed','failed')),
  vision_model text,
  vision_cost_usd numeric(10,6),
  vision_latency_ms int,
  detected_count int,
  error_message text,
  taken_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index photos_user_id_idx on photos(user_id);
create index photos_shelf_id_idx on photos(shelf_id);

-- 4. detections
create table detections (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  position_index int not null,
  raw_title text,
  raw_author text,
  raw_publisher text,
  vision_confidence numeric(3,2),
  spine_color text,
  status text not null default 'pending'
    check (status in ('pending','matched','confirmed','rejected')),
  created_at timestamptz not null default now()
);
create index detections_photo_id_idx on detections(photo_id);

-- 5. book_candidates
create table book_candidates (
  id uuid primary key default gen_random_uuid(),
  detection_id uuid not null references detections(id) on delete cascade,
  source text not null check (source in ('google_books','open_library')),
  external_id text not null,
  title text not null,
  authors text[] not null default '{}',
  isbn_10 text,
  isbn_13 text,
  publisher text,
  published_year int,
  cover_url text,
  match_score numeric(4,3),
  rank int not null,
  created_at timestamptz not null default now()
);
create index book_candidates_detection_id_idx on book_candidates(detection_id);

-- 6. books (confirmed catalog)
create table books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  authors text[] not null default '{}',
  isbn_10 text,
  isbn_13 text,
  publisher text,
  published_year int,
  cover_url text,
  source text,
  source_external_id text,
  notes text,
  created_at timestamptz not null default now()
);
create unique index books_user_isbn13 on books(user_id, isbn_13) where isbn_13 is not null;
create index books_user_id_idx on books(user_id);

-- 7. shelf_entries
create table shelf_entries (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  shelf_id uuid not null references shelves(id) on delete cascade,
  position_index int,
  photo_id uuid references photos(id) on delete set null,
  detection_id uuid references detections(id) on delete set null,
  is_current boolean not null default true,
  confirmed_at timestamptz not null default now()
);
create index shelf_entries_book_id_idx on shelf_entries(book_id);
create index shelf_entries_shelf_id_idx on shelf_entries(shelf_id);

-- 8. corrections (telemetry)
-- 'parse_failure' added per CLAUDE.md > Vision LLM rule (Zod retry path)
create table corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  detection_id uuid references detections(id) on delete set null,
  original_raw_title text,
  corrected_title text,
  corrected_authors text[],
  correction_type text
    check (correction_type in ('title_typo','wrong_author','wrong_book','not_a_book','parse_failure')),
  created_at timestamptz not null default now()
);
create index corrections_user_id_idx on corrections(user_id);
