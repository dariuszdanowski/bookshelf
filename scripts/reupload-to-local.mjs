/**
 * reupload-to-local.mjs
 *
 * Pobiera pliki z prod i re-uploaduje do lokalnego Supabase przez SDK.
 * SDK przejdzie przez storage-api → poprawne xattry, metadane, wersje.
 *
 * Uruchom w WSL z Node 22:
 *   source ~/.nvm/nvm.sh
 *   PROD_KEY="sb_secret_..." node scripts/reupload-to-local.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const devVars = readFileSync(resolve(__dir, '../.dev.vars'), 'utf8');
const parseVar = (key) => devVars.match(new RegExp(`^${key}=(.+)`, 'm'))?.[1]?.trim() ?? null;

const PROD_URL = 'https://foqpoqdbicgsrbkcuckc.supabase.co';
const LOCAL_URL = parseVar('PUBLIC_SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const BUCKET = 'shelf-photos';

const PROD_KEY = parseVar('REMOTE_SUPABASE_SERVICE_ROLE_KEY');
const LOCAL_KEY = parseVar('SUPABASE_SERVICE_ROLE_KEY');

if (!PROD_KEY) {
  console.error('ERROR: Brak REMOTE_SUPABASE_SERVICE_ROLE_KEY w .dev.vars');
  process.exit(1);
}
if (!LOCAL_KEY) {
  console.error('ERROR: Brak SUPABASE_SERVICE_ROLE_KEY w .dev.vars');
  process.exit(1);
}

const prod = createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false } });
const local = createClient(LOCAL_URL, LOCAL_KEY, { auth: { persistSession: false } });

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

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.thumb.jpg': 'image/jpeg',
};

function mimeFor(path) {
  if (path.endsWith('.thumb.jpg')) return 'image/jpeg';
  const ext = path.slice(path.lastIndexOf('.'));
  return MIME[ext] ?? 'application/octet-stream';
}

let ok = 0,
  fail = 0;
console.log(`Re-upload ${FILES.length} plików: prod → local (przez SDK)\n`);

for (const path of FILES) {
  const { data, error } = await prod.storage.from(BUCKET).download(path);
  if (error || !data) {
    console.log(`  ✗ DOWNLOAD ${path}: ${error?.message}`);
    fail++;
    continue;
  }

  const contentType = mimeFor(path);
  const buf = await data.arrayBuffer();

  const { error: upErr } = await local.storage.from(BUCKET).upload(path, buf, {
    contentType,
    upsert: true,
    cacheControl: '3600',
  });

  if (upErr) {
    console.log(`  ✗ UPLOAD ${path}: ${upErr.message}`);
    fail++;
  } else {
    console.log(`  ✓ ${path} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
    ok++;
  }
}

console.log(`\nGotowe: ${ok}/${FILES.length} sukces, ${fail} błędów`);
if (fail > 0) process.exit(1);
