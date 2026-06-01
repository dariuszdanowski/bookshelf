/**
 * Głęboka analiza bbox na rzeczywistym zdjęciu z Supabase.
 * Testuje 4 warianty promptu pod kątem:
 *  - leżących/poziomych książek (#1/#2 SYBIRPUNK)
 *  - brakujących bbox dla rozpoznanych tytułów (#33 Raz Wiedźmie Śmierć)
 *
 * Użycie: node scripts/bbox-deep-analysis.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  const vars = {};
  try {
    readFileSync(resolve(root, '.dev.vars'), 'utf-8').split('\n').forEach((l) => {
      const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (m) vars[m[1]] = m[2].trim();
    });
  } catch {}
  return vars;
}

const env = loadEnv();
const PHOTO_ID = 'cf42bf3a-46a5-40c9-a7d7-3ca821bd0d90';

// Znane problemy z produkcyjnego runu v3 — punkty odniesienia
const KNOWN_ISSUES = [
  { pos: 1, title: 'SYBIRPUNK', issue: 'bbox zbyt mały/przesunięty', expected_x_approx: [0.07, 0.12] },
  { pos: 2, title: 'SYBIRPUNK', issue: 'bbox zbyt mały/przesunięty', expected_x_approx: [0.07, 0.12] },
  { pos: 33, title: 'Raz Wiedźmie Śmierć', issue: 'NULL bbox (leżąca na górze stosu)', expected_x_approx: [0.35, 0.55] },
];

// ─── SPINE_COLORS (load-bearing, nie zmieniać) ────────────────────────────
const SPINE_COLORS = 'czerwony, pomarańczowy, żółty, zielony, niebieski, granatowy, fioletowy, różowy, brązowy, czarny, biały, szary';

// ─── WARIANTY PROMPTU ──────────────────────────────────────────────────────

const V_BASELINE = `Jesteś vision-asystentem do katalogowania książek. Otrzymujesz zdjęcie półki widzianej od grzbietów. Wymień każdą widoczną książkę od lewej do prawej.

Dla każdej książki zwróć JSON object:
- position: int (1 = pierwsza od lewej)
- title: string
- author: string | null
- confidence: float 0–1
- spine_color: string | null (z listy: ${SPINE_COLORS})
- bbox: [x1, y1, x2, y2] albo null

Instrukcja bbox: Współrzędne względem PEŁNEGO obrazu (0,0=lewy-górny, 1,1=prawy-dolny). Obejmuje CAŁY GRZBIET. Ustaw null tylko gdy naprawdę nie znasz lokalizacji.

Zwróć TYLKO JSON array.`;

// Wariant: wymuszony bbox — bez opcji null, zawsze best-effort
const V_FORCE_BBOX = `Jesteś vision-asystentem do katalogowania książek. Otrzymujesz zdjęcie półki widzianej od grzbietów. Wymień każdą widoczną książkę od lewej do prawej.

Dla każdej książki zwróć JSON object:
- position: int (1 = pierwsza od lewej)
- title: string
- author: string | null
- confidence: float 0–1
- spine_color: string | null (z listy: ${SPINE_COLORS})
- bbox: [x1, y1, x2, y2] — ZAWSZE podaj, nigdy nie null

Instrukcja bbox (OBOWIĄZKOWE dla każdej książki):
Współrzędne względem PEŁNEGO obrazu (0,0=lewy-górny, 1,1=prawy-dolny).
bbox obejmuje CAŁY GRZBIET (nie tylko tekst).

WAŻNE — dwa tryby orientacji:
• Książka STOJĄCA PIONOWO: x1,x2 to lewa/prawa krawędź grzbietu (wąskie); y1,y2 to top/bottom (prawie pełna wysokość obrazu)
• Książka LEŻĄCA POZIOMO (na stosie, poziomy grzbiet): x1,x2 to lewa/prawa krawędź grzbietu (szerokie); y1,y2 to cienki pasek górnej/dolnej krawędzi grzbietu

Jeśli jesteś niepewny lokalizacji, podaj best-effort estimate — 80% trafienia jest lepsze niż null.
Nie pomijaj bbox nawet dla trudnych przypadków (leżące stosy, częściowo zasłonięte).

Zwróć TYLKO JSON array.`;

// Wariant: chain-of-thought dla każdej książki (orientation-first)
const V_COT_ORIENTATION = `Jesteś vision-asystentem do katalogowania książek. Otrzymujesz zdjęcie półki.

Przed podaniem JSON przeprowadź analizę przestrzenną (jeden akapit, krótko):
- Ile książek stoi pionowo, ile leży poziomo (w stosach)?
- Gdzie są stosy leżące i co jest na wierzchu każdego stosu?

Następnie zwróć JSON array. Dla każdej książki:
- position: int (1 = pierwsza od lewej)
- title: string
- author: string | null
- confidence: float 0–1
- orientation: "vertical" | "horizontal"  ← NOWE POLE
- spine_color: string | null (z listy: ${SPINE_COLORS})
- bbox: [x1, y1, x2, y2]

REGUŁY BBOX (zawsze podaj, nigdy null):
Dla "vertical" (stojące): x-zakres wąski (1-5% obrazu), y-zakres wysoki (≥20%).
Dla "horizontal" (leżące): bbox leży wzdłuż górnej lub bocznej krawędzi stosu; x-zakres SZEROKI (5-25%), y-zakres CIENKI (2-8%).

Wymagana kolejność: najpierw analiza, potem JSON array.
Jeśli kończysz analizę i zaczynasz JSON, podaj tylko JSON — żadnych komentarzy.`;

// Wariant: two-pass — najpierw grid/strefa, potem bbox per-book
const V_GRID_ZONES = `Jesteś vision-asystentem do katalogowania książek.

KROK 1 — Podziel obraz na strefy poziome (jeden wiersz opisu):
  górna strefa (y=0.0-0.3): co tam jest (stosy poziome, wisząca torba, itp.)
  główna półka (y=0.3-0.7): książki stojące pionowo
  dolna (y=0.7-1.0): co tam jest

KROK 2 — Dla każdej widocznej książki zwróć JSON:
- position: int (lewa→prawa, kontynuując przez strefy)
- title: string
- author: string | null
- confidence: float 0–1
- zone: "top_stack" | "main_shelf" | "right_stack"  ← z analizy Krok 1
- spine_color: string | null (z listy: ${SPINE_COLORS})
- bbox: [x1, y1, x2, y2]  ← ZAWSZE, best-effort

BBOX:
Współrzędne względem pełnego obrazu (0,0=lewy-górny, 1,1=prawy-dolny).
"top_stack" (leżące): y zakres ≈ strefa_top, x zakres pokrywa szerokość grzbietu.
"main_shelf" (stojące): x zakres 1-5%, y od ~y_polki do ~0.85.

Zwróć: najpierw 3 linijki analizy stref, potem JSON array.`;

const VARIANTS = [
  { label: 'v3-baseline (aktualny produkcyjny)', prompt: V_BASELINE },
  { label: 'v4-force-bbox (bez null, best-effort)', prompt: V_FORCE_BBOX },
  { label: 'v4-cot-orientation (orientation+cot)', prompt: V_COT_ORIENTATION },
  { label: 'v4-grid-zones (strefy+zone field)', prompt: V_GRID_ZONES },
];

// ─── Utilities ─────────────────────────────────────────────────────────────

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

function tryParseJson(text) {
  // Dla wariantów z pre-amble (COT/zones) wytnij ostatni [...] blok
  const arrMatch = text.match(/(\[[\s\S]*\])\s*$/);
  const raw = arrMatch ? arrMatch[1] : stripFences(text);
  try { return JSON.parse(raw); } catch { return null; }
}

function bboxInfo(det) {
  if (!det.bbox || !Array.isArray(det.bbox) || det.bbox.length !== 4) return '(NULL)';
  const [x1, y1, x2, y2] = det.bbox;
  const w = (x2 - x1).toFixed(3), h = (y2 - y1).toFixed(3);
  return `[${[x1, y1, x2, y2].map(v => v.toFixed(3)).join(',')}] w=${w} h=${h}`;
}

function analyzeResult(dets) {
  if (!dets) return { ok: false };
  const withBbox = dets.filter(d => d.bbox && Array.isArray(d.bbox));
  const nullBbox = dets.filter(d => !d.bbox || !Array.isArray(d.bbox));
  const tooNarrow = withBbox.filter(d => (d.bbox[2] - d.bbox[0]) < 0.015);

  // Check specific problem cases
  const sybirpunk = dets.filter(d => d.title?.toUpperCase().includes('SYBIRPUNK'));
  const wiedzmie = dets.find(d => d.title?.toLowerCase().includes('wiedźm') || d.title?.toLowerCase().includes('wiedzm'));
  const horizontal = dets.filter(d => d.orientation === 'horizontal' || d.zone === 'top_stack');

  return {
    ok: true,
    total: dets.length,
    withBbox: withBbox.length,
    nullBbox: nullBbox.length,
    tooNarrow: tooNarrow.length,
    sybirpunk,
    wiedzmie,
    horizontal,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  const sb = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Download photo from storage
  console.log('📥 Pobieranie zdjęcia z Supabase Storage...');
  const { data: photo } = await sb.from('photos').select('storage_path').eq('id', PHOTO_ID).single();
  const { data: blob } = await sb.storage.from('shelf-photos').download(photo.storage_path);
  const buf = await blob.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  const size = Math.round(buf.byteLength / 1024);
  console.log(`   ✅ ${size} KB, type=image/jpeg\n`);

  const results = [];

  for (const variant of VARIANTS) {
    console.log(`${'═'.repeat(72)}`);
    console.log(`🔬 ${variant.label}`);
    console.log(`${'═'.repeat(72)}`);

    const start = Date.now();
    let rawText = '';
    let dets = null;

    try {
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: variant.prompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
              { type: 'text', text: 'Wymień książki na zdjęciu.' },
            ],
          },
        ],
      });
      rawText = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
      dets = tryParseJson(rawText);
      const cost = (resp.usage.input_tokens / 1e6) * 3 + (resp.usage.output_tokens / 1e6) * 15;
      const latency = Date.now() - start;
      console.log(`   latency=${latency}ms  cost=$${cost.toFixed(5)}  tokens_in=${resp.usage.input_tokens} out=${resp.usage.output_tokens}`);
    } catch (e) {
      console.error(`   ❌ API error:`, e.message);
      results.push({ label: variant.label, error: e.message });
      continue;
    }

    if (!dets) {
      console.log('   ❌ JSON parse failed');
      console.log('   Raw (first 300 chars):', rawText.slice(0, 300));
      results.push({ label: variant.label, parseError: true, rawText });
      continue;
    }

    const stats = analyzeResult(dets);
    console.log(`   Detekcji: ${stats.total} | bbox: ${stats.withBbox}/${stats.total} | null: ${stats.nullBbox} | tooNarrow: ${stats.tooNarrow}`);

    // SYBIRPUNK analysis
    if (stats.sybirpunk.length > 0) {
      console.log(`\n   📍 SYBIRPUNK (${stats.sybirpunk.length} detekcji):`);
      for (const d of stats.sybirpunk) {
        console.log(`      #${d.position} "${d.title}" ${d.orientation ? '['+d.orientation+']' : ''} → ${bboxInfo(d)}`);
      }
    } else {
      console.log(`\n   ⚠️  SYBIRPUNK: nie wykryto`);
    }

    // Wiedźmie analysis
    if (stats.wiedzmie) {
      const d = stats.wiedzmie;
      console.log(`\n   📍 "Raz Wiedźmie Śmierć" → ${bboxInfo(d)} (pos #${d.position})`);
      if (d.zone) console.log(`      zone: ${d.zone}`);
    } else {
      console.log(`\n   ⚠️  "Raz Wiedźmie Śmierć": nie wykryto`);
    }

    // Horizontal books (if tagged)
    if (stats.horizontal.length > 0) {
      console.log(`\n   📚 Horizontal/top_stack (${stats.horizontal.length}):`);
      for (const d of stats.horizontal.slice(0, 5)) {
        console.log(`      #${d.position} "${d.title.slice(0, 40)}" → ${bboxInfo(d)}`);
      }
    }

    // NULL bbox list
    const nullList = dets.filter(d => !d.bbox || !Array.isArray(d.bbox));
    if (nullList.length > 0) {
      console.log(`\n   🔴 NULL bbox (${nullList.length}):`);
      for (const d of nullList) {
        console.log(`      #${d.position} "${d.title.slice(0, 50)}"`);
      }
    }

    results.push({ label: variant.label, stats, rawText, dets });
    console.log('');

    // throttle between calls
    await new Promise(r => setTimeout(r, 2000));
  }

  // ── Porównanie zbiorcze ──────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(72)}`);
  console.log('PODSUMOWANIE PORÓWNAWCZE');
  console.log(`${'═'.repeat(72)}`);
  console.log('Wariant'.padEnd(42) + 'Total  Bbox   Null   SYBIR  WieŹm');
  console.log('─'.repeat(72));
  for (const r of results) {
    if (r.error || r.parseError) {
      console.log(r.label.padEnd(42) + 'ERROR');
      continue;
    }
    const s = r.stats;
    const sybir = s.sybirpunk.length > 0 ? s.sybirpunk[0].bbox ? '✅' : '❌null' : '❌brak';
    const wiedz = s.wiedzmie ? (s.wiedzmie.bbox ? '✅' : '❌null') : '❌brak';
    console.log(
      r.label.padEnd(42) +
        String(s.total).padEnd(7) +
        `${s.withBbox}/${s.total}`.padEnd(7) +
        String(s.nullBbox).padEnd(7) +
        sybir.padEnd(7) +
        wiedz
    );
  }

  // Save raw results for inspection
  const outPath = resolve(root, 'docs/image-analysis/bbox-deep-analysis.json');
  writeFileSync(outPath, JSON.stringify(results.map(r => ({ label: r.label, stats: r.stats, rawText: r.rawText?.slice(0, 2000) })), null, 2));
  console.log(`\nWyniki zapisane do ${outPath}`);
}

run().catch(e => { console.error(e); process.exit(1); });
