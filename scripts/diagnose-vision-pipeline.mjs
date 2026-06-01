/**
 * Diagnostyczny skrypt do analizy pipeline vision dla konkretnego zdjęcia.
 * Odpytuje Supabase (service-role) i symuluje kroki procesu.
 *
 * Użycie: node scripts/diagnose-vision-pipeline.mjs [photo-id]
 * Domyślnie używa photo-id z arg lub ostatniego przetworzonego zdjęcia.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// --- Load credentials from .dev.vars ---
function loadDevVars() {
  const vars = {};
  try {
    const content = readFileSync(resolve(root, '.dev.vars'), 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (m) vars[m[1]] = m[2].trim();
    }
  } catch {}
  return vars;
}

const env = loadDevVars();
const SUPABASE_URL = env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Brak PUBLIC_SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w .dev.vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const PHOTO_ID = process.argv[2] || 'cf42bf3a-46a5-40c9-a7d7-3ca821bd0d90';

async function run() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`Diagnoza pipeline vision dla photo_id: ${PHOTO_ID}`);
  console.log(`${'═'.repeat(70)}\n`);

  // --- 1. Photo record ---
  const { data: photo, error: photoErr } = await supabase
    .from('photos')
    .select('id, shelf_id, storage_path, status, detected_count, error_message, vision_model, vision_cost_usd, vision_latency_ms, created_at, processed_at')
    .eq('id', PHOTO_ID)
    .single();

  if (photoErr || !photo) {
    console.error('❌ Nie znaleziono zdjęcia:', photoErr?.message);
    process.exit(1);
  }

  console.log('📷 Photo record:');
  console.log(`   status:         ${photo.status}`);
  console.log(`   detected_count: ${photo.detected_count}`);
  console.log(`   storage_path:   ${photo.storage_path}`);
  console.log(`   vision_model:   ${photo.vision_model}`);
  console.log(`   vision_cost:    $${photo.vision_cost_usd}`);
  console.log(`   latency_ms:     ${photo.vision_latency_ms}`);
  console.log(`   error_message:  ${photo.error_message ?? '(brak)'}`);
  console.log(`   processed_at:   ${photo.processed_at}`);

  // --- 2. Vision runs history ---
  const { data: runs } = await supabase
    .from('vision_runs')
    .select('id, model, prompt_version, status, cost_usd, latency_ms, error_message, created_at, completed_at')
    .eq('photo_id', PHOTO_ID)
    .order('created_at', { ascending: false });

  console.log(`\n🔄 Vision runs (${runs?.length ?? 0} total, najnowszy pierwszy):`);
  for (const r of (runs ?? []).slice(0, 5)) {
    const det = await supabase.from('detections').select('id', { count: 'exact', head: true }).eq('vision_run_id', r.id);
    const count = det.count ?? '?';
    const latency = r.latency_ms ? `${r.latency_ms}ms` : '-';
    console.log(`   [${r.created_at?.slice(0,19)}] ${r.status.padEnd(10)} prompt=${r.prompt_version} detections=${count} latency=${latency} cost=$${r.cost_usd ?? '0'}`);
    if (r.error_message) console.log(`     error: ${r.error_message}`);
  }

  // --- 3. Latest run detections ---
  const latestRun = runs?.[0];
  if (latestRun) {
    const { data: dets } = await supabase
      .from('detections')
      .select('position_index, raw_title, raw_author, vision_confidence, status, bbox_x1, bbox_y1, bbox_x2, bbox_y2, spine_color')
      .eq('vision_run_id', latestRun.id)
      .order('position_index', { ascending: true });

    console.log(`\n📚 Detekcje z najnowszego runu (${latestRun.id.slice(0,8)}..., ${dets?.length ?? 0} detekcji):`);
    if (!dets || dets.length === 0) {
      console.log('   ⚠️  Brak detekcji — vision zwrócił 0 lub parse_failure');
    }
    for (const d of (dets ?? []).slice(0, 20)) {
      const bbox = d.bbox_x1 != null
        ? `[${d.bbox_x1.toFixed(3)},${d.bbox_y1.toFixed(3)},${d.bbox_x2.toFixed(3)},${d.bbox_y2.toFixed(3)}] w=${(d.bbox_x2-d.bbox_x1).toFixed(3)}`
        : '(brak bbox)';
      console.log(`   #${String(d.position_index).padStart(2)} "${d.raw_title}" | conf=${d.vision_confidence?.toFixed(2)} | ${d.status} | ${bbox}`);
    }

    // --- 4. All detections across all runs for this photo ---
    const { data: allDets, count: totalDets } = await supabase
      .from('detections')
      .select('*', { count: 'exact', head: true })
      .eq('photo_id', PHOTO_ID);

    console.log(`\n📊 Łącznie detekcji we wszystkich runach dla tego zdjęcia: ${totalDets}`);

    // --- 5. Check storage access ---
    console.log('\n🗄️  Sprawdzam dostęp do Storage...');
    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from('shelf-photos')
        .download(photo.storage_path);
      if (dlErr) {
        console.log(`   ❌ Storage download failed: ${dlErr.message}`);
      } else {
        const buf = await blob.arrayBuffer();
        const size = buf.byteLength;
        const mediaType = blob.type;
        console.log(`   ✅ Storage OK: ${size.toLocaleString()} bytes, type=${mediaType}`);

        // Check if it's a valid JPEG/PNG (first bytes)
        const magic = new Uint8Array(buf.slice(0, 4));
        const isJpeg = magic[0] === 0xFF && magic[1] === 0xD8;
        const isPng = magic[0] === 0x89 && magic[1] === 0x50;
        if (isJpeg) console.log(`   ✅ Format: JPEG (magic bytes FF D8)`);
        else if (isPng) console.log(`   ✅ Format: PNG (magic bytes 89 50)`);
        else console.log(`   ⚠️  Nieznany format: ${Array.from(magic).map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
      }
    } catch (e) {
      console.log(`   ❌ Storage exception: ${e.message}`);
    }

    // --- 6. Analyze sanitizeBbox impact ---
    if (dets && dets.length > 0) {
      const withBbox = dets.filter(d => d.bbox_x1 != null);
      const nullBbox = dets.filter(d => d.bbox_x1 == null);
      console.log(`\n🔲 Analiza bbox:`);
      console.log(`   Z bbox:  ${withBbox.length}/${dets.length}`);
      console.log(`   Bez bbox: ${nullBbox.length}/${dets.length}`);

      // Simulate sanitizeBbox rejection reasons
      if (withBbox.length > 0) {
        let tooNarrow = 0, tooShort = 0, edgeStrip = 0, ok = 0;
        for (const d of dets.filter(d => d.bbox_x1 != null)) {
          const x1 = d.bbox_x1, y1 = d.bbox_y1, x2 = d.bbox_x2, y2 = d.bbox_y2;
          const w = x2 - x1, h = y2 - y1;
          if (w <= 0 || h <= 0) { tooNarrow++; continue; }
          if (w < 0.015) { tooNarrow++; continue; }
          if (h < 0.08) { tooShort++; continue; }
          const touchesEdge = x1 < 0.02 || x2 > 0.98;
          if (touchesEdge && w < 0.06 && h > 0.25) { edgeStrip++; continue; }
          ok++;
        }
        console.log(`   sanitizeBbox: OK=${ok} tooNarrow=${tooNarrow} tooShort=${tooShort} edgeStrip=${edgeStrip}`);
      }
    }
  }

  // --- 7. Check what GET /api/photos/:id returns (detekcje widoczne w UI) ---
  console.log('\n👁️  Co widzi UI (wszystkie detekcje przez RLS-respecting query)...');
  const { data: uiDets } = await supabase
    .from('detections')
    .select(`
      id, position_index, raw_title, status, vision_confidence,
      vision_run_id,
      book_candidates ( id, title, match_score, rank )
    `)
    .eq('photo_id', PHOTO_ID)
    .order('position_index', { ascending: true });

  if (!uiDets || uiDets.length === 0) {
    console.log('   ⚠️  Brak detekcji dla tego photo_id w bazie (we wszystkich runach łącznie)');
  } else {
    console.log(`   ${uiDets.length} detekcji łącznie. Próbka pierwszych 5:`);
    for (const d of uiDets.slice(0, 5)) {
      const runShort = d.vision_run_id?.slice(0,8) ?? '?';
      const cands = Array.isArray(d.book_candidates) ? d.book_candidates.length : 0;
      console.log(`   #${d.position_index} "${d.raw_title}" [run:${runShort}] status=${d.status} cands=${cands}`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('Diagnoza zakończona');
}

run().catch(e => { console.error(e); process.exit(1); });
