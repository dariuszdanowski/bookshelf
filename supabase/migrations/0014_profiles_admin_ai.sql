-- S-26 faza 1: flagi administracyjne na profilach użytkowników
--
-- is_admin: uprawnienia administratora (dostęp do /admin, zarządzanie userami)
-- ai_enabled: dostęp do funkcji AI (vision + matching); default true = wszyscy obecni
--             użytkownicy zachowują dostęp; admin może wyłączyć per-user

alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists ai_enabled boolean not null default true;

-- Trigger handle_new_user (0003) domyślnie dziedziczy false/true z kolumn.
-- Nowi użytkownicy dostają ai_enabled=true automatycznie.
