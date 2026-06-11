/**
 * migrate-storage-prod-to-local.mjs
 *
 * Kopiuje pliki photo z Supabase Storage prod → lokalny kontener Docker.
 * Używa @supabase/supabase-js SDK (obsługuje stare i nowe formaty kluczy).
 *
 * Użycie (w WSL lub PowerShell):
 *   PROD_KEY="sb_secret_..." node scripts/migrate-storage-prod-to-local.mjs
 *
 * PROD_KEY = Service Role Key z: Supabase Dashboard → Project Settings → API
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const PROD_URL = 'https://foqpoqdbicgsrbkcuckc.supabase.co';
const BUCKET = 'shelf-photos';
const CONTAINER = 'supabase_storage_bookshelf';
const CONTAINER_BASE = `/mnt/${BUCKET}`;
const TMPDIR = join(tmpdir(), `storage_migration_${process.pid}`);

const PROD_KEY = process.env.PROD_KEY;
if (!PROD_KEY) {
  console.error(
    'ERROR: Brak PROD_KEY. Uruchom: PROD_KEY="sb_secret_..." node scripts/migrate-storage-prod-to-local.mjs',
  );
  process.exit(1);
}

// Sprawdź czy kontener działa
try {
  execSync(`docker inspect ${CONTAINER}`, { stdio: 'pipe' });
} catch {
  console.error(`ERROR: Kontener ${CONTAINER} nie istnieje. Uruchom: npx supabase start`);
  process.exit(1);
}

const prod = createClient(PROD_URL, PROD_KEY, {
  auth: { persistSession: false },
});

const FILES = [
  '143500a4-51c5-4467-91f6-232e73111184/19ea7b8bd97-1l7u8qbhfkv-782jcuf55b.jpg',
  '143500a4-51c5-4467-91f6-232e73111184/19ea7b8bd97-1l7u8qbhfkv-782jcuf55b.jpg.thumb.jpg',
  '143500a4-51c5-4467-91f6-232e73111184/19ea7b8e792-et34onf0py7-fkw92psg9f4.jpg',
  '143500a4-51c5-4467-91f6-232e73111184/19ea7b8e792-et34onf0py7-fkw92psg9f4.jpg.thumb.jpg',
  '143500a4-51c5-4467-91f6-232e73111184/19ea7b9084b-n6ixrl68clm-hm06xwqycy.jpg',
  '143500a4-51c5-4467-91f6-232e73111184/19ea7b9084b-n6ixrl68clm-hm06xwqycy.jpg.thumb.jpg',
  '143500a4-51c5-4467-91f6-232e73111184/aba60055-c55f-424c-91f9-3e5d5c289994.jpg',
  '143500a4-51c5-4467-91f6-232e73111184/b8323e8c-e3a1-48ac-babc-38b5979fc827.jpg',
  '143500a4-51c5-4467-91f6-232e73111184/daec0568-abc2-4a50-9a75-81cb2ded6f4e.jpg',
  '87e5e787-80e7-48b5-a703-bee2e8ab3dac/1d9a315e-a9af-4a9d-8816-3ac4f32745dd.jpg',
  '87e5e787-80e7-48b5-a703-bee2e8ab3dac/e5036162-9af9-48c9-a880-d48e5373ceb1.jpg',
  'd4684e52-88ad-45b3-b8f1-08e5863dc057/19ea6d6693a-r5njkrse56-b364rhwtdu.jpg',
  'd4684e52-88ad-45b3-b8f1-08e5863dc057/19ea6d6693a-r5njkrse56-b364rhwtdu.jpg.thumb.jpg',
  'd4684e52-88ad-45b3-b8f1-08e5863dc057/19ea79f3599-wkfb7rvcfwj-dv3s1sqfcp.jpg',
  'd4684e52-88ad-45b3-b8f1-08e5863dc057/19ea79f3599-wkfb7rvcfwj-dv3s1sqfcp.jpg.thumb.jpg',
  'd4684e52-88ad-45b3-b8f1-08e5863dc057/19ea79f9b2c-50uo46y90fs-542gxjl9plc.jpg',
  'd4684e52-88ad-45b3-b8f1-08e5863dc057/19ea79f9b2c-50uo46y90fs-542gxjl9plc.jpg.thumb.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/06947260-1b7e-43f0-8e37-8890e4a036e5.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/0aa15f78-8798-4cdd-9735-cad4ea28a807.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/16721eac-f2f7-4770-a427-2e9640d6a73e.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19e4d9c6-3406-4563-896a-3e858d035a4d.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea376f4b2-c1fr5ek94zh-3gp5jzj5011.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea376f4b2-c1fr5ek94zh-3gp5jzj5011.jpg.thumb.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea875d623-1ywdmu3oy71i-ese7nxc5ela.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea875d623-1ywdmu3oy71i-ese7nxc5ela.jpg.thumb.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea8e55351-0h9bxk2iifc-83gy5jn2j4j.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea8e55351-0h9bxk2iifc-83gy5jn2j4j.jpg.thumb.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea8ea5c4d-gwtue5w9ctu-8gd8iw9ywm6.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea8ea5c4d-gwtue5w9ctu-8gd8iw9ywm6.jpg.thumb.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea9cc9bbb-0dvh5wgmap5c-cqmu8rkgznp.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea9cc9bbb-0dvh5wgmap5c-cqmu8rkgznp.jpg.thumb.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea9cdd75b-xm4zmfcyvi-iisew1aodik.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/19ea9cdd75b-xm4zmfcyvi-iisew1aodik.jpg.thumb.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/3b40fbb5-2a50-47f0-9663-0b47e888d4a4.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/43f60b9b-4f28-41b5-8ce6-b5e4faa7375b.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/58ccd39c-bb81-4e3f-97df-a7242c9a6f3d.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/67e7c360-a187-426a-90d6-697b63397a34.png',
  'fec2631a-28a7-46ed-8a71-feff0d100311/75c43e91-dc8e-43a3-8393-9fda31c2bbbf.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/a660abc4-0091-40c1-8b8f-b63005eac432.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/aba60055-c55f-424c-91f9-3e5d5c289994.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/b8323e8c-e3a1-48ac-babc-38b5979fc827.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/d36a87be-7b5e-4762-94da-f5daf17c1c85.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/daec0568-abc2-4a50-9a75-81cb2ded6f4e.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/e62c4af4-50a7-4a22-80c6-8843482b025b.jpg',
  'fec2631a-28a7-46ed-8a71-feff0d100311/f5e332e6-3c74-47f0-a57b-c23a1cb83014.jpg',
];

mkdirSync(TMPDIR, { recursive: true });

let ok = 0;
let fail = 0;

console.log(`Migracja ${FILES.length} plików: prod → ${CONTAINER}:${CONTAINER_BASE}/`);
console.log(`Temp: ${TMPDIR}\n`);

for (const path of FILES) {
  const localFile = join(TMPDIR, path.replace(/\//g, '_'));

  // 1. Pobierz z prod przez SDK
  const { data, error } = await prod.storage.from(BUCKET).download(path);
  if (error || !data) {
    console.log(`  ✗ DOWNLOAD ${path}: ${error?.message ?? 'brak danych'}`);
    fail++;
    continue;
  }

  // 2. Zapisz do pliku tymczasowego
  const buf = Buffer.from(await data.arrayBuffer());
  writeFileSync(localFile, buf);

  // 3. Utwórz katalog w kontenerze
  const containerDir = `${CONTAINER_BASE}/${dirname(path)}`;
  execSync(`docker exec ${CONTAINER} mkdir -p "${containerDir}"`, { stdio: 'pipe' });

  // 4. docker cp do kontenera
  const containerPath = `${CONTAINER}:${CONTAINER_BASE}/${path}`;
  try {
    execSync(`docker cp "${localFile}" "${containerPath}"`, { stdio: 'pipe' });
    console.log(`  ✓ ${path} (${buf.length} B)`);
    ok++;
  } catch (e) {
    console.log(`  ✗ COPY ${path}: ${e.message}`);
    fail++;
  }
}

// Sprzątanie
rmSync(TMPDIR, { recursive: true, force: true });

console.log(`\nGotowe: ${ok}/${FILES.length} sukces, ${fail} błędów`);
if (fail > 0) process.exit(1);
