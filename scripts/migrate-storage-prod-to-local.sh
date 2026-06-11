#!/usr/bin/env bash
# migrate-storage-prod-to-local.sh
#
# Kopiuje pliki ze storage produkcyjnego do lokalnego kontenera supabase_storage_bookshelf.
# Nie wymaga sudo — używa docker cp (wystarczy dostęp do Docker socket).
#
# Użycie:
#   PROD_KEY="eyJ..." bash scripts/migrate-storage-prod-to-local.sh
#
# PROD_KEY = Service Role Key z: Supabase Dashboard → Project Settings → API → service_role

set -euo pipefail

PROD_URL="https://foqpoqdbicgsrbkcuckc.supabase.co"
BUCKET="shelf-photos"
CONTAINER="supabase_storage_bookshelf"
CONTAINER_BASE="/mnt/$BUCKET"
TMPDIR="/tmp/storage_migration_$$"

if [[ -z "${PROD_KEY:-}" ]]; then
  echo "ERROR: Brak PROD_KEY. Uruchom: PROD_KEY='eyJ...' bash $0" >&2
  exit 1
fi

# Sprawdź czy kontener działa
if ! docker inspect "$CONTAINER" &>/dev/null; then
  echo "ERROR: Kontener $CONTAINER nie istnieje. Uruchom: npx supabase start" >&2
  exit 1
fi

FILES=(
  "143500a4-51c5-4467-91f6-232e73111184/19ea7b8bd97-1l7u8qbhfkv-782jcuf55b.jpg"
  "143500a4-51c5-4467-91f6-232e73111184/19ea7b8bd97-1l7u8qbhfkv-782jcuf55b.jpg.thumb.jpg"
  "143500a4-51c5-4467-91f6-232e73111184/19ea7b8e792-et34onf0py7-fkw92psg9f4.jpg"
  "143500a4-51c5-4467-91f6-232e73111184/19ea7b8e792-et34onf0py7-fkw92psg9f4.jpg.thumb.jpg"
  "143500a4-51c5-4467-91f6-232e73111184/19ea7b9084b-n6ixrl68clm-hm06xwqycy.jpg"
  "143500a4-51c5-4467-91f6-232e73111184/19ea7b9084b-n6ixrl68clm-hm06xwqycy.jpg.thumb.jpg"
  "143500a4-51c5-4467-91f6-232e73111184/aba60055-c55f-424c-91f9-3e5d5c289994.jpg"
  "143500a4-51c5-4467-91f6-232e73111184/b8323e8c-e3a1-48ac-babc-38b5979fc827.jpg"
  "143500a4-51c5-4467-91f6-232e73111184/daec0568-abc2-4a50-9a75-81cb2ded6f4e.jpg"
  "87e5e787-80e7-48b5-a703-bee2e8ab3dac/1d9a315e-a9af-4a9d-8816-3ac4f32745dd.jpg"
  "87e5e787-80e7-48b5-a703-bee2e8ab3dac/e5036162-9af9-48c9-a880-d48e5373ceb1.jpg"
  "d4684e52-88ad-45b3-b8f1-08e5863dc057/19ea6d6693a-r5njkrse56-b364rhwtdu.jpg"
  "d4684e52-88ad-45b3-b8f1-08e5863dc057/19ea6d6693a-r5njkrse56-b364rhwtdu.jpg.thumb.jpg"
  "d4684e52-88ad-45b3-b8f1-08e5863dc057/19ea79f3599-wkfb7rvcfwj-dv3s1sqfcp.jpg"
  "d4684e52-88ad-45b3-b8f1-08e5863dc057/19ea79f3599-wkfb7rvcfwj-dv3s1sqfcp.jpg.thumb.jpg"
  "d4684e52-88ad-45b3-b8f1-08e5863dc057/19ea79f9b2c-50uo46y90fs-542gxjl9plc.jpg"
  "d4684e52-88ad-45b3-b8f1-08e5863dc057/19ea79f9b2c-50uo46y90fs-542gxjl9plc.jpg.thumb.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/06947260-1b7e-43f0-8e37-8890e4a036e5.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/0aa15f78-8798-4cdd-9735-cad4ea28a807.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/16721eac-f2f7-4770-a427-2e9640d6a73e.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19e4d9c6-3406-4563-896a-3e858d035a4d.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea376f4b2-c1fr5ek94zh-3gp5jzj5011.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea376f4b2-c1fr5ek94zh-3gp5jzj5011.jpg.thumb.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea875d623-1ywdmu3oy71i-ese7nxc5ela.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea875d623-1ywdmu3oy71i-ese7nxc5ela.jpg.thumb.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea8e55351-0h9bxk2iifc-83gy5jn2j4j.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea8e55351-0h9bxk2iifc-83gy5jn2j4j.jpg.thumb.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea8ea5c4d-gwtue5w9ctu-8gd8iw9ywm6.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea8ea5c4d-gwtue5w9ctu-8gd8iw9ywm6.jpg.thumb.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea9cc9bbb-0dvh5wgmap5c-cqmu8rkgznp.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea9cc9bbb-0dvh5wgmap5c-cqmu8rkgznp.jpg.thumb.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea9cdd75b-xm4zmfcyvi-iisew1aodik.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/19ea9cdd75b-xm4zmfcyvi-iisew1aodik.jpg.thumb.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/3b40fbb5-2a50-47f0-9663-0b47e888d4a4.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/43f60b9b-4f28-41b5-8ce6-b5e4faa7375b.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/58ccd39c-bb81-4e3f-97df-a7242c9a6f3d.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/67e7c360-a187-426a-90d6-697b63397a34.png"
  "fec2631a-28a7-46ed-8a71-feff0d100311/75c43e91-dc8e-43a3-8393-9fda31c2bbbf.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/a660abc4-0091-40c1-8b8f-b63005eac432.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/aba60055-c55f-424c-91f9-3e5d5c289994.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/b8323e8c-e3a1-48ac-babc-38b5979fc827.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/d36a87be-7b5e-4762-94da-f5daf17c1c85.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/daec0568-abc2-4a50-9a75-81cb2ded6f4e.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/e62c4af4-50a7-4a22-80c6-8843482b025b.jpg"
  "fec2631a-28a7-46ed-8a71-feff0d100311/f5e332e6-3c74-47f0-a57b-c23a1cb83014.jpg"
)

TOTAL=${#FILES[@]}
OK=0
FAIL=0

echo "Migracja $TOTAL plików: prod → $CONTAINER:$CONTAINER_BASE/"
echo "Pobieranie do $TMPDIR, potem docker cp"
echo ""

mkdir -p "$TMPDIR"
trap 'rm -rf "$TMPDIR"' EXIT

for path in "${FILES[@]}"; do
  uid_dir="$(dirname "$path")"
  filename="$(basename "$path")"
  local_dir="$TMPDIR/$uid_dir"
  mkdir -p "$local_dir"
  local_file="$local_dir/$filename"

  # 1. Pobierz z prod
  http_code=$(curl -s -o "$local_file" -w "%{http_code}" \
    -H "Authorization: Bearer $PROD_KEY" \
    "$PROD_URL/storage/v1/object/$BUCKET/$path")

  if [[ "$http_code" != "200" ]]; then
    echo "  ✗ DOWNLOAD $path → HTTP $http_code"
    ((FAIL++))
    continue
  fi

  # 2. Utwórz katalog w kontenerze
  docker exec "$CONTAINER" mkdir -p "$CONTAINER_BASE/$uid_dir" 2>/dev/null || true

  # 3. Skopiuj do kontenera przez docker cp
  if docker cp "$local_file" "$CONTAINER:$CONTAINER_BASE/$path" 2>/dev/null; then
    size=$(stat -c%s "$local_file" 2>/dev/null || echo "?")
    echo "  ✓ $path (${size} B)"
    ((OK++))
  else
    echo "  ✗ COPY $path → docker cp failed"
    ((FAIL++))
  fi
done

echo ""
echo "Gotowe: $OK/$TOTAL sukces, $FAIL błędów"

if [[ $FAIL -eq 0 ]]; then
  echo "Wszystkie pliki przeniesione. Odśwież lokalną aplikację — zdjęcia powinny być widoczne."
else
  echo "Część plików nie powiodła się. Możesz uruchomić skrypt ponownie (pomija istniejące jeśli ok)."
  exit 1
fi
