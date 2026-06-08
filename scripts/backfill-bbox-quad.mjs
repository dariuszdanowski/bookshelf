/**
 * Backfill bbox_quad dla istniejących detekcji.
 *
 * Kolumna detections.bbox_quad dodana w migracji 0022 jest nullable —
 * detekcje istniejące przed wdrożeniem obsługi czworokątów mają NULL.
 * Ten skrypt uzupełnia bbox_quad wartością wyliczoną z prostokąta:
 *   [[x1,y1], [x2,y1], [x2,y2], [x1,y2]]  (TL→TR→BR→BL, clockwise)
 *
 * Użycie:
 *   node scripts/backfill-bbox-quad.mjs
 *   node scripts/backfill-bbox-quad.mjs --dry-run   # tylko podgląd, bez UPDATE
 *
 * Wymagania: .dev.vars z PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (remote).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const PAGE_SIZE = 500;
const DRY_RUN = process.argv.includes('--dry-run');

// --- Załaduj credentials z .dev.vars ---
function loadDevVars() {
  const vars = {};
  try {
    const content = readFileSync(resolve(root, '.dev.vars'), 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=]+)=(.*)$/);
      if (m) vars[m[1].trim()] = m[2].trim();
    }
  } catch {
    console.error(
      'Brak pliku .dev.vars — wymagane PUBLIC_SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY',
    );
    process.exit(1);
  }
  return vars;
}

const vars = loadDevVars();
const SUPABASE_URL = vars['PUBLIC_SUPABASE_URL'];
const SERVICE_KEY = vars['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Brak PUBLIC_SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w .dev.vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function bboxToQuad(x1, y1, x2, y2) {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

async function run() {
  console.log(DRY_RUN ? '=== DRY RUN — brak UPDATE ===' : '=== LIVE RUN ===');

  let offset = 0;
  let totalFound = 0;
  let totalUpdated = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from('detections')
      .select('id, bbox_x1, bbox_y1, bbox_x2, bbox_y2')
      .is('bbox_quad', null)
      .not('bbox_x1', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('Błąd odczytu:', error.message);
      process.exit(1);
    }

    if (!rows || rows.length === 0) break;

    totalFound += rows.length;
    console.log(`Strona offset=${offset}: ${rows.length} detekcji do uzupełnienia`);

    if (!DRY_RUN) {
      for (const row of rows) {
        const quad = bboxToQuad(row.bbox_x1, row.bbox_y1, row.bbox_x2, row.bbox_y2);
        const { error: updErr } = await supabase
          .from('detections')
          .update({ bbox_quad: quad })
          .eq('id', row.id);

        if (updErr) {
          console.error(`  ERROR id=${row.id}:`, updErr.message);
        } else {
          totalUpdated++;
        }
      }
    } else {
      // W dry-run pokaż przykład pierwszego wiersza
      if (offset === 0 && rows.length > 0) {
        const ex = rows[0];
        console.log(
          `  Przykład id=${ex.id}: bbox=[${ex.bbox_x1},${ex.bbox_y1},${ex.bbox_x2},${ex.bbox_y2}]`,
          `→ quad=${JSON.stringify(bboxToQuad(ex.bbox_x1, ex.bbox_y1, ex.bbox_x2, ex.bbox_y2))}`,
        );
      }
      totalUpdated += rows.length;
    }

    if (rows.length < PAGE_SIZE) break;
    // W live mode: po UPDATE wiersze znikają z wyniku IS NULL, więc offset
    // zawsze startuje od 0. W dry-run: offset musi rosnąć bo wiersze zostają.
    if (!DRY_RUN) {
      offset = 0;
    } else {
      offset += PAGE_SIZE;
    }
  }

  console.log(`\nZnaleziono: ${totalFound} detekcji bez bbox_quad`);
  if (DRY_RUN) {
    console.log(`Do aktualizacji: ${totalUpdated} (dry-run — nie zapisano)`);
  } else {
    console.log(`Zaktualizowano: ${totalUpdated}`);
  }
}

run().catch((err) => {
  console.error('Nieoczekiwany błąd:', err);
  process.exit(1);
});
