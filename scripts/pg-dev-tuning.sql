-- LOCAL DEV ONLY — radykalne speedupy IO kosztem trwalosci danych.
-- Zastosowanie: kiedy antywirus (SentinelOne/Defender/Asseco) skanuje WSL2 vhdx
-- i fsync trwa sekundy zamiast milisekund, powodujac flap auth/realtime.
-- Dane moga zginac przy crashu systemu — ALE TO LOKALNA DB.
-- NIGDY nie uruchamiac na produkcji.

ALTER SYSTEM SET fsync = off;
ALTER SYSTEM SET synchronous_commit = off;
ALTER SYSTEM SET full_page_writes = off;
SELECT pg_reload_conf();
SHOW fsync;
SHOW synchronous_commit;
SHOW full_page_writes;
