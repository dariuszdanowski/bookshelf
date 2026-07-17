-- Migration: remove per-photo AI-resolution budget limit
-- Usuwa kolumnę ai_resolution_max_calls_per_photo z profiles — blokada per-zdjęcie okazała się
-- permanentna i nieodwracalna (all-time count bez okna czasowego, bez mechanizmu resetu).
-- Zostaje wyłącznie dzienny limit jako guardrail kosztowy.

alter table public.profiles
  drop constraint if exists profiles_ai_resolution_max_calls_per_photo_range;

alter table public.profiles
  drop column if exists ai_resolution_max_calls_per_photo;
