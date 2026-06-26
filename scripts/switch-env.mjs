#!/usr/bin/env node
// Przepina aktywny .dev.vars między profilem lokalnym (kontenery z `supabase start`)
// a remote (prod Supabase). Astro czyta tylko `.dev.vars` — pozostałe pliki to wzorce/backup.
//
// Tryb `local` na Windows: .dev.vars.local trzyma URL z `127.0.0.1`, ale realnie
// Supabase biegnie w WSL2. Windows nie ma localhost-forwardingu dla portów Dockera,
// więc dynamicznie wykrywamy WSL IP (zmienia się po restartach) i podstawiamy
// w generowanym .dev.vars. Source-of-truth (.dev.vars.local) pozostaje stabilny.

import { existsSync, copyFileSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import os from 'node:os';

const root = process.cwd();
const ACTIVE = resolve(root, '.dev.vars');
const LOCAL = resolve(root, '.dev.vars.local');
const REMOTE_BAK = resolve(root, '.dev.vars.remote.bak');

const mode = process.argv[2];

function detectSupabaseHost(localTemplate) {
  if (os.platform() !== 'win32') return '127.0.0.1';
  // Gdy .dev.vars.local zawiera SUPABASE_LOCALHOST_FORWARDING=true, localhost-forwarding
  // działa na tej maszynie (Docker porty WSL dostępne przez 127.0.0.1 z Windows).
  // Pomijamy wtedy wykrywanie WSL IP — 127.0.0.1 jest stabilne i nie zmienia się po restartach.
  if (/^SUPABASE_LOCALHOST_FORWARDING=true$/m.test(localTemplate)) return '127.0.0.1';
  // `wsl -e ...` lub `wsl -- ...` bezpośrednio przez spawn (bez cmd.exe shell);
  // execSync z stringiem psuje quoting cudzysłowów na Windows.
  const r = spawnSync('wsl.exe', ['--', 'hostname', '-I'], { encoding: 'utf8', timeout: 8000 });
  if (r.status === 0 && r.stdout) {
    const ip = r.stdout.split(/\s+/).find((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s));
    if (ip) return ip;
  }
  console.warn(
    `UWAGA: nie udalo sie wykryc WSL IP (status=${r.status} err=${r.error?.code ?? '-'}); uzywam 127.0.0.1.`,
  );
  return '127.0.0.1';
}

function detectActive() {
  if (!existsSync(ACTIVE)) return 'none';
  const url =
    readFileSync(ACTIVE, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('PUBLIC_SUPABASE_URL=')) ?? '';
  if (!url) return 'unknown';
  const value = url.split('=', 2)[1] ?? '';
  // Local profil: dowolne IP prywatne 192.168.* / 172.* / 10.* lub 127.0.0.1 / localhost
  if (
    value.includes('127.0.0.1') ||
    value.includes('localhost') ||
    /:\/\/(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(value)
  ) {
    return 'local';
  }
  return 'remote';
}

function status() {
  console.log(`Aktywny profil .dev.vars: ${detectActive()}`);
  console.log(`  .dev.vars              ${existsSync(ACTIVE) ? 'present' : 'MISSING'}`);
  console.log(`  .dev.vars.local        ${existsSync(LOCAL) ? 'present' : 'MISSING'}`);
  console.log(`  .dev.vars.remote.bak   ${existsSync(REMOTE_BAK) ? 'present' : '—'}`);
  if (existsSync(ACTIVE)) {
    const url =
      readFileSync(ACTIVE, 'utf8')
        .split(/\r?\n/)
        .find((l) => l.startsWith('PUBLIC_SUPABASE_URL=')) ?? '(brak)';
    console.log(`  PUBLIC_SUPABASE_URL    ${url.replace('PUBLIC_SUPABASE_URL=', '')}`);
  }
}

function toLocal() {
  if (!existsSync(LOCAL)) {
    console.error(
      'Brak .dev.vars.local — najpierw `npm run db:start` i skopiuj output kluczy do pliku.',
    );
    process.exit(1);
  }
  const active = detectActive();
  if (active === 'remote' && existsSync(ACTIVE)) {
    renameSync(ACTIVE, REMOTE_BAK);
    console.log('  backup: .dev.vars → .dev.vars.remote.bak');
  }
  const template = readFileSync(LOCAL, 'utf8');
  const host = detectSupabaseHost(template);
  const rewritten = template.replace(/(:\/\/)127\.0\.0\.1(:\d+)/g, `$1${host}$2`);
  writeFileSync(ACTIVE, rewritten);
  console.log(`✓ Aktywowano profil lokalny — PUBLIC_SUPABASE_URL hostuje na ${host}`);
  if (host !== '127.0.0.1') {
    console.log(`  (WSL IP — dynamiczne; po wsl --shutdown odpal "npm run env:local" ponownie)`);
  }
}

function toRemote() {
  const active = detectActive();
  if (active === 'remote') {
    console.log('Profil remote już aktywny — nic nie robię.');
    return;
  }
  if (!existsSync(REMOTE_BAK)) {
    console.error('Brak .dev.vars.remote.bak — nie mam skąd przywrócić sekretów remote.');
    console.error('Skopiuj sekrety z Worker Dashboard Secrets (Cloudflare) do .dev.vars ręcznie.');
    process.exit(1);
  }
  copyFileSync(REMOTE_BAK, ACTIVE);
  console.log('✓ Aktywowano profil remote (.dev.vars.remote.bak → .dev.vars)');
  console.log('');
  console.log('  ⚠️  UWAGA: profil REMOTE = egress chmury + MAU prod Supabase.');
  console.log('  Używaj tylko do debugowania prod. Wróć: npm run env:local');
}

switch (mode) {
  case 'local':
    toLocal();
    break;
  case 'remote':
    toRemote();
    break;
  case 'status':
  case undefined:
    status();
    break;
  default:
    console.error(`Nieznany tryb: ${mode}. Użycie: switch-env.mjs <local|remote|status>`);
    process.exit(1);
}
