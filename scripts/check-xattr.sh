#!/usr/bin/env bash
# Sprawdza xattr na lokalnie uploadeowanym pliku vs naszym skopiowanym
DB_CONTAINER="supabase_db_bookshelf"
CONTAINER="supabase_storage_bookshelf"
BASE="/mnt/stub/stub/shelf-photos"

# Lokalnie uploadowany plik (3585ab36 - inny user, pominięty w migracji)
echo "=== Lokalnie uploadowany plik (reference) ==="
row=$(docker exec "$DB_CONTAINER" psql -U postgres -t -A -F'|' \
  -c "SELECT name, version FROM storage.objects WHERE bucket_id = 'shelf-photos' AND name LIKE '3585ab36%' LIMIT 1;")
if [[ -n "$row" ]]; then
  name="${row%%|*}"
  version="${row##*|}"
  path="$BASE/$name/$version"
  echo "Plik: $path"
  docker exec "$CONTAINER" getfattr -d "$path" 2>/dev/null || echo "(brak getfattr lub brak xattrs)"
  docker exec "$CONTAINER" ls -la "$path" 2>/dev/null || echo "(plik nie istnieje)"
fi

echo ""
echo "=== Nasz skopiowany plik ==="
row2=$(docker exec "$DB_CONTAINER" psql -U postgres -t -A -F'|' \
  -c "SELECT name, version FROM storage.objects WHERE bucket_id = 'shelf-photos' AND name LIKE 'fec2631a%aba60055%' LIMIT 1;")
if [[ -n "$row2" ]]; then
  name2="${row2%%|*}"
  version2="${row2##*|}"
  path2="$BASE/$name2/$version2"
  echo "Plik: $path2"
  docker exec "$CONTAINER" getfattr -d "$path2" 2>/dev/null || echo "(brak getfattr lub brak xattrs)"
  docker exec "$CONTAINER" ls -la "$path2" 2>/dev/null || echo "(plik nie istnieje)"
fi
