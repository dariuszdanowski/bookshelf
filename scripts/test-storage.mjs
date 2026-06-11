/**
 * test-storage.mjs
 *
 * Smoke lokalnego Storage: generuje signed URL dla znanego pliku i fetchuje go.
 * HTTP 200 + content-type image/* = plik leży poprawnie (ścieżka + xattry).
 *
 * Klucz/URL czytane z .dev.vars (nie hardkodować — rotują per `supabase start`).
 * Uruchom w WSL z Node 22:  source ~/.nvm/nvm.sh && node scripts/test-storage.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const devVars = readFileSync(resolve(__dir, '../.dev.vars'), 'utf8');
const parseVar = (key) => devVars.match(new RegExp(`^${key}=(.+)`, 'm'))?.[1]?.trim() ?? null;

const URL = parseVar('PUBLIC_SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const KEY = parseVar('SUPABASE_SERVICE_ROLE_KEY');
if (!KEY) {
  console.error('ERROR: Brak SUPABASE_SERVICE_ROLE_KEY w .dev.vars');
  process.exit(1);
}

// Plik testowy — podmień na istniejący w Twoim lokalnym bucket'cie jeśli trzeba.
const TEST_PATH =
  process.argv[2] ??
  'fec2631a-28a7-46ed-8a71-feff0d100311/aba60055-c55f-424c-91f9-3e5d5c289994.jpg';

const c = createClient(URL, KEY, { auth: { persistSession: false } });
const { data, error } = await c.storage.from('shelf-photos').createSignedUrl(TEST_PATH, 60);
if (error || !data) {
  console.error('createSignedUrl error:', error?.message);
  process.exit(1);
}

const res = await fetch(data.signedUrl);
console.log(
  'HTTP',
  res.status,
  'content-type:',
  res.headers.get('content-type'),
  'size:',
  res.headers.get('content-length'),
);
