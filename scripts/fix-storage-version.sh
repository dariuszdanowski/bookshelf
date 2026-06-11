#!/usr/bin/env bash
# fix-storage-version.sh
# Przesuwa pliki z {name}/{id} → {name}/{version} (storage-api v1.58+ używa version jako filename)
set -euo pipefail

CONTAINER="supabase_storage_bookshelf"
DB_CONTAINER="supabase_db_bookshelf"
BUCKET="shelf-photos"
BASE="/mnt/stub/stub/$BUCKET"

echo "=== Fix: {id} → {version} w $BASE ==="
echo ""

OK=0; SKIP=0; FAIL=0

mapfile -t ROWS < <(docker exec "$DB_CONTAINER" psql -U postgres -t -A -F'|' \
  -c "SELECT name, id, version FROM storage.objects WHERE bucket_id = '$BUCKET' ORDER BY name;")

for row in "${ROWS[@]}"; do
  [[ -z "$row" ]] && continue
  name="${row%%|*}"
  rest="${row#*|}"
  obj_id="${rest%%|*}"
  version="${rest##*|}"

  dir="$BASE/$name"
  old_file="$dir/$obj_id"
  new_file="$dir/$version"

  if docker exec "$CONTAINER" test -f "$new_file" 2>/dev/null; then
    SKIP=$((SKIP+1))
    continue
  fi

  if ! docker exec "$CONTAINER" test -f "$old_file" 2>/dev/null; then
    echo "  SKIP (brak pliku): $name"
    SKIP=$((SKIP+1))
    continue
  fi

  if docker exec "$CONTAINER" mv "$old_file" "$new_file" 2>/dev/null; then
    echo "  ✓ ${name##*/}: $obj_id → $version"
    OK=$((OK+1))
  else
    echo "  ✗ FAIL: $name"
    FAIL=$((FAIL+1))
  fi
done

echo ""
echo "Gotowe: $OK przesunięte, $SKIP pominięte, $FAIL błędów"
