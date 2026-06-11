#!/usr/bin/env bash
# fix-storage-paths.sh
#
# Przesuwa pliki skopiowane przez migrate-storage-prod-to-local.mjs
# z /mnt/shelf-photos/{user}/{file} na właściwe ścieżki:
# /mnt/stub/stub/shelf-photos/{user}/{file}/{object.id}
#
# Uruchom w WSL: bash scripts/fix-storage-paths.sh

set -euo pipefail

CONTAINER="supabase_storage_bookshelf"
DB_CONTAINER="supabase_db_bookshelf"
BUCKET="shelf-photos"
OLD_BASE="/mnt/$BUCKET"
NEW_BASE="/mnt/stub/stub/$BUCKET"

echo "=== Fix storage paths: $OLD_BASE → $NEW_BASE/{object.id} ==="
echo ""

# Pobierz mapowanie name|id z lokalnej bazy
mapfile -t MAPPINGS < <(docker exec "$DB_CONTAINER" psql -U postgres -t -A -F'|' \
  -c "SELECT name, version FROM storage.objects WHERE bucket_id = '$BUCKET' ORDER BY name;")

OK=0
SKIP=0
FAIL=0

for row in "${MAPPINGS[@]}"; do
  [[ -z "$row" ]] && continue
  name="${row%%|*}"
  obj_id="${row##*|}"

  old_path="$OLD_BASE/$name"
  new_dir="$NEW_BASE/$name"
  new_path="$new_dir/$obj_id"

  # Sprawdź czy stary plik istnieje w kontenerze
  if ! docker exec "$CONTAINER" test -f "$old_path" 2>/dev/null; then
    echo "  SKIP (brak źródła): $name"
    SKIP=$((SKIP+1))
    continue
  fi

  # Utwórz katalog docelowy (name jako katalog + obiekt UUID jako plik)
  docker exec "$CONTAINER" mkdir -p "$new_dir"

  # Przesuń plik
  if docker exec "$CONTAINER" mv "$old_path" "$new_path" 2>/dev/null; then
    echo "  ✓ $name → .../$obj_id"
    OK=$((OK+1))
  else
    echo "  ✗ FAIL: $name"
    FAIL=$((FAIL+1))
  fi
done

# Usuń pusty katalog /mnt/shelf-photos jeśli zostały tylko puste katalogi
docker exec "$CONTAINER" find "$OLD_BASE" -type d -empty -delete 2>/dev/null || true

echo ""
echo "Gotowe: $OK przesunięte, $SKIP pominięte (brak pliku), $FAIL błędów"
echo ""
echo "Sprawdź w przeglądarce czy zdjęcia są widoczne na :4321"
