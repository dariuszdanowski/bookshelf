-- photo-dedup: przechowuje SHA-256 pliku zdjęcia obliczony w przeglądarce przed uploadem.
-- Unique partial index (user_id, hash) WHERE hash IS NOT NULL — duplikaty cross-user
-- NIE są blokowane (zgodnie z RLS filozofią projektu).

alter table photos add column if not exists file_hash_sha256 text;

create unique index if not exists photos_user_hash_unique
  on photos (user_id, file_hash_sha256)
  where file_hash_sha256 is not null;
