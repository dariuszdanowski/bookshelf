/**
 * Backfill SHA-256 dla istniejących zdjęć (photo-hash-backfill).
 *
 * Kolumna photos.file_hash_sha256 dodana w migracji 0013 jest nullable —
 * zdjęcia wgrane przed wdrożeniem dedupu mają NULL. Ten skrypt uzupełnia
 * brakujące hashe pobierając pliki z Supabase Storage i licząc SHA-256
 * tym samym algorytmem co przeglądarka (SubtleCrypto → node:crypto, ten sam wynik).
 *
 * Użycie:
 *   node scripts/backfill-photo-hashes.mjs
 *   node scripts/backfill-photo-hashes.mjs --dry-run   # tylko podgląd, bez UPDATE
 *
 * Wymagania: .dev.vars z PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (remote).
 * Upewnij się że .dev.vars wskazuje na remote prod (nie lokalną Supabase).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const BUCKET = 'shelf-photos';
const PAGE_SIZE = 50;

// --- Załaduj credentials z .dev.vars ---
function loadDevVars() {
  const vars = {};
  try {
    const content = readFileSync(resolve(root, '.dev.vars'), 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
      if (m) vars[m[1]] = m[2].trim();
    }
  } catch {
    // ignorujemy brak pliku — fallback do process.env poniżej
  }
  return vars;
}

const devVars = loadDevVars();
const SUPABASE_URL = devVars.PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = devVars.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('BŁĄD: Brak PUBLIC_SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Upewnij się że .dev.vars zawiera dane remote Supabase (nie lokalnej).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// --- SHA-256 z ArrayBuffer — identyczny wynik jak SubtleCrypto w przeglądarce ---
function sha256hex(buffer) {
  return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
}

async function run() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Backfill photo file_hash_sha256${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`${'═'.repeat(60)}\n`);

  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    // Strona zdjęć bez hasha — service-role pomija RLS (dostęp do wszystkich userów)
    const { data: photos, error: fetchErr } = await supabase
      .from('photos')
      .select('id, user_id, storage_path')
      .is('file_hash_sha256', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (fetchErr) {
      console.error(`BŁĄD pobierania strony (offset=${offset}):`, fetchErr.message);
      process.exit(1);
    }

    if (!photos || photos.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`Strona offset=${offset}: ${photos.length} zdjęć do przetworzenia`);

    for (const photo of photos) {
      process.stdout.write(`  [${photo.id}] storage_path=${photo.storage_path} … `);

      // Pobierz plik ze Storage jako Blob
      const { data: blob, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(photo.storage_path);

      if (dlErr || !blob) {
        console.log(`POMINIĘTO (Storage: ${dlErr?.message ?? 'brak danych'})`);
        totalSkipped++;
        continue;
      }

      // Oblicz SHA-256 z bajtów pliku
      const buffer = await blob.arrayBuffer();
      const hash = sha256hex(buffer);

      if (DRY_RUN) {
        console.log(`dry-run → ${hash}`);
        totalProcessed++;
        continue;
      }

      // UPDATE photos
      const { error: updateErr } = await supabase
        .from('photos')
        .update({ file_hash_sha256: hash })
        .eq('id', photo.id);

      if (updateErr) {
        // 23505 = unique_violation: inne zdjęcie tego samego usera ma już ten hash.
        // Istniejący rekord (wgrany wcześniej) zachowuje hash; ten (późniejszy duplikat)
        // zostaje z hash=NULL — dedup działałby gdyby oba zostały wgrane po wdrożeniu 0013.
        if (updateErr.code === '23505') {
          console.log(`DUPLIKAT (hash już istnieje u tego usera — pomijam)`);
          totalSkipped++;
        } else {
          console.log(`BŁĄD UPDATE: ${updateErr.message}`);
          totalErrors++;
        }
      } else {
        console.log(`OK → ${hash}`);
        totalProcessed++;
      }
    }

    // Jeśli dostaliśmy pełną stronę, sprawdź czy jest kolejna
    if (photos.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += PAGE_SIZE;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Przetworzone : ${totalProcessed}`);
  console.log(`Pominięte   : ${totalSkipped} (błąd Storage lub duplikat hash u tego samego usera)`);
  console.log(`Błędy UPDATE : ${totalErrors}`);
  console.log(`${'─'.repeat(60)}\n`);

  if (totalErrors > 0) {
    console.error('Zakończono z błędami UPDATE — sprawdź logi powyżej.');
    process.exit(1);
  }

  if (totalSkipped > 0) {
    console.warn(
      `UWAGA: ${totalSkipped} zdjęć pominiętych (duplikat hash w obrębie usera lub brak pliku w Storage). ` +
        `Wiersze photos pozostają z hash=NULL — dedup nie chroni tych rekordów przed ponownym uploadem.`
    );
  }

  console.log(DRY_RUN ? 'Dry run zakończony.' : 'Backfill zakończony pomyślnie.');
}

run().catch((err) => {
  console.error('Nieoczekiwany błąd:', err);
  process.exit(1);
});
