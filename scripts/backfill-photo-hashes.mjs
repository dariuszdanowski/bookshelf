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
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
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

// --- SHA-256 z ArrayBuffer — identyczny wynik jak SubtleCrypto w przeglądarce ---
export function sha256hex(buffer) {
  return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
}

/**
 * Główna pętla backfillu. Klient Supabase wstrzykiwany — testowalne na fake'u.
 *
 * Paginacja: kursor `offset` przesuwa się WYŁĄCZNIE o wiersze, które po tej
 * stronie nadal mają hash=NULL (pominięte: brak pliku w Storage, duplikat 23505,
 * błąd UPDATE). Wiersze zaktualizowane wypadają ze zbioru filtra `IS NULL`,
 * więc zwiększanie offsetu o pełną stronę przeskakiwałoby nieprzetworzone
 * rekordy (shifting-window). W dry-run nic nie znika ze zbioru — offset
 * przesuwa się o całą stronę.
 *
 * @param {any} supabase — klient Supabase (service-role) lub fake w testach
 * @param {{ dryRun?: boolean, bucket?: string, pageSize?: number, log?: { log: (msg: string) => void, error: (msg: string) => void } }} [options]
 * @returns {Promise<{processed: number, skipped: number, errors: number}>}
 */
export async function backfillPhotoHashes(
  supabase,
  { dryRun = false, bucket = BUCKET, pageSize = PAGE_SIZE, log = console } = {},
) {
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
      .range(offset, offset + pageSize - 1);

    if (fetchErr) {
      log.error(`BŁĄD pobierania strony (offset=${offset}): ${fetchErr.message}`);
      throw new Error(`Fetch failed at offset=${offset}: ${fetchErr.message}`);
    }

    if (!photos || photos.length === 0) {
      hasMore = false;
      break;
    }

    log.log(`Strona offset=${offset}: ${photos.length} zdjęć do przetworzenia`);

    // Wiersze z tej strony, które po przetworzeniu NADAL mają hash=NULL —
    // tylko o nie wolno przesunąć kursor (zostają przed nim w zbiorze filtra).
    let pageStillNull = 0;

    for (const photo of photos) {
      // Pobierz plik ze Storage jako Blob
      const { data: blob, error: dlErr } = await supabase.storage
        .from(bucket)
        .download(photo.storage_path);

      if (dlErr || !blob) {
        log.log(
          `  [${photo.id}] ${photo.storage_path} … POMINIĘTO (Storage: ${dlErr?.message ?? 'brak danych'})`,
        );
        totalSkipped++;
        pageStillNull++;
        continue;
      }

      // Oblicz SHA-256 z bajtów pliku
      const buffer = await blob.arrayBuffer();
      const hash = sha256hex(buffer);

      if (dryRun) {
        log.log(`  [${photo.id}] ${photo.storage_path} … dry-run → ${hash}`);
        totalProcessed++;
        pageStillNull++; // dry-run nie zmienia DB — wiersz zostaje w zbiorze filtra
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
          log.log(
            `  [${photo.id}] ${photo.storage_path} … DUPLIKAT (hash już istnieje u tego usera — pomijam)`,
          );
          totalSkipped++;
        } else {
          log.log(`  [${photo.id}] ${photo.storage_path} … BŁĄD UPDATE: ${updateErr.message}`);
          totalErrors++;
        }
        pageStillNull++;
      } else {
        log.log(`  [${photo.id}] ${photo.storage_path} … OK → ${hash}`);
        totalProcessed++;
      }
    }

    if (photos.length < pageSize) {
      hasMore = false;
    } else {
      // Kursor mija tylko wiersze, które zostały w zbiorze `IS NULL`.
      offset += pageStillNull;
    }
  }

  return { processed: totalProcessed, skipped: totalSkipped, errors: totalErrors };
}

// --- CLI entrypoint (pomijany przy imporcie w testach) ---
async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');

  const devVars = loadDevVars();
  const SUPABASE_URL = devVars.PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = devVars.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('BŁĄD: Brak PUBLIC_SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY.');
    console.error('Upewnij się że .dev.vars zawiera dane remote Supabase (nie lokalnej).');
    process.exit(1);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Backfill photo file_hash_sha256${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`${'═'.repeat(60)}\n`);

  const { processed, skipped, errors } = await backfillPhotoHashes(supabase, {
    dryRun: DRY_RUN,
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Przetworzone : ${processed}`);
  console.log(`Pominięte   : ${skipped} (błąd Storage lub duplikat hash u tego samego usera)`);
  console.log(`Błędy UPDATE : ${errors}`);
  console.log(`${'─'.repeat(60)}\n`);

  if (errors > 0) {
    console.error('Zakończono z błędami UPDATE — sprawdź logi powyżej.');
    process.exit(1);
  }

  if (skipped > 0) {
    console.warn(
      `UWAGA: ${skipped} zdjęć pominiętych (duplikat hash w obrębie usera lub brak pliku w Storage). ` +
        `Wiersze photos pozostają z hash=NULL — dedup nie chroni tych rekordów przed ponownym uploadem.`,
    );
  }

  console.log(DRY_RUN ? 'Dry run zakończony.' : 'Backfill zakończony pomyślnie.');
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error('Nieoczekiwany błąd:', err);
    process.exit(1);
  });
}
