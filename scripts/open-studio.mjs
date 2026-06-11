import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const devVarsPath = resolve(process.cwd(), '.dev.vars');
let content;
try {
  content = readFileSync(devVarsPath, 'utf-8');
} catch {
  console.error('Brak pliku .dev.vars — uruchom najpierw: npm run env:local');
  process.exit(1);
}

const match = content.match(/^PUBLIC_SUPABASE_URL=(.+)$/m);
if (!match) {
  console.error('Brak PUBLIC_SUPABASE_URL w .dev.vars — uruchom: npm run env:local');
  process.exit(1);
}

const supabaseUrl = match[1].trim();
if (supabaseUrl.includes('supabase.co')) {
  console.error('Aktywny profil to REMOTE — Studio działa tylko dla lokalnego stacku.');
  console.error('Uruchom: npm run env:local');
  process.exit(1);
}

const studioUrl = supabaseUrl.replace(':54321', ':54323');
console.log(`Supabase Studio: ${studioUrl}`);

const isWsl =
  process.platform === 'linux' &&
  (() => {
    try {
      return readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
    } catch {
      return false;
    }
  })();

if (process.platform === 'win32') {
  execSync(`start "" "${studioUrl}"`, { shell: true });
} else if (isWsl) {
  execSync(`powershell.exe Start-Process "${studioUrl}"`);
} else {
  execSync(`open "${studioUrl}"`);
}
