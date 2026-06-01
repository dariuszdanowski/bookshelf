/**
 * 3 eksperymenty promptów pod kątem poprawy bbox poziomych i pionowych.
 * Test-case: SYBIRPUNK (leżące w lewym stosie), pionowe stojące.
 * Używa lokalnego zdjęcia badawczego (bez Supabase download).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  const vars = {};
  try {
    readFileSync(resolve(root, '.dev.vars'), 'utf-8').split('\n').forEach(l => {
      const m = l.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (m) vars[m[1]] = m[2].trim();
    });
  } catch {}
  return vars;
}
const env = loadEnv();

const IMG_PATH = resolve(root, 'docs/image-analysis/research-cases/ca035e1e-a58d-42ff-86be-66eb521853e1.jpg');
const imgB64 = Buffer.from(readFileSync(IMG_PATH)).toString('base64');

// Znane pozycje do weryfikacji (oczekiwane):
// SYBIRPUNK lying flat: x≈0.04-0.17, y≈0.67-0.79 (wide+thin)
// Raz Wiedźmie (top stack): x≈0.33-0.57, y≈0.20-0.25 (wide+thin)
// CZAS ŻNIW (standing): x≈0.22-0.25, y≈0.22-0.82 (narrow+tall)

const SPINE_COLORS = 'czerwony, pomarańczowy, żółty, zielony, niebieski, granatowy, fioletowy, różowy, brązowy, czarny, biały, szary';

// ── Eksperyment 1: Anchor-first ───────────────────────────────────────────
// Model najpierw wyznacza kotwice przestrzenne, potem bbox per-book.
const EXP1_ANCHOR = `Jesteś vision-asystentem do katalogowania książek.

KROK 1 — Wyznacz kotwice obrazu (jeden wiersz JSON, PRZED tablicą książek):
{"shelf_y": float, "stack_left_x2": float, "standing_y1": float, "standing_y2": float}
  shelf_y = y-pozycja górnej powierzchni deski półki (float 0..1)
  stack_left_x2 = prawa krawędź lewego stosu leżących książek (float 0..1)
  standing_y1 = y górnej krawędzi stojących książek (float 0..1)
  standing_y2 = y dolnej krawędzi stojących książek = SHELF_Y (float 0..1)

KROK 2 — Zwróć tablicę JSON książek:
- position, title, author, confidence, orientation ("vertical"/"horizontal"), spine_color (z: ${SPINE_COLORS}), bbox [x1,y1,x2,y2]

REGUŁY bbox (floaty 0..1, NIGDY piksele):
vertical: x wąskie (0.01-0.06), y1=standing_y1, y2=standing_y2 (ZAWSZE do deski półki!)
horizontal w stosie: x SZEROKIE (pełna długość grzbietu 0.08-0.25), y cienkie (grubość 1 książki 0.03-0.07)

Format: najpierw wiersz kotwic {"shelf_y":...}, potem tablica [...].`;

// ── Eksperyment 2: Center+size ────────────────────────────────────────────
// Model podaje środek i rozmiar zamiast narożników — intuicyjniejsze.
const EXP2_CENTER_SIZE = `Jesteś vision-asystentem do katalogowania książek.

Dla każdej widocznej książki zwróć JSON:
- position, title, author, confidence, orientation ("vertical"/"horizontal"), spine_color (z: ${SPINE_COLORS})
- cx: float 0..1 — x środka grzbietu w pełnym obrazie
- cy: float 0..1 — y środka grzbietu w pełnym obrazie
- w: float 0..1 — szerokość grzbietu (x2-x1)
- h: float 0..1 — wysokość grzbietu (y2-y1)

WAŻNE dla rozmiaru:
vertical (stoi): w=0.01-0.06 (wąskie), h=0.40-0.65 (od szczytu do deski półki)
horizontal (leży w stosie): w=0.10-0.25 (pełna długość grzbietu), h=0.03-0.07 (grubość 1 książki)

Przykład pionowej: cx=0.14, cy=0.52, w=0.025, h=0.58
Przykład poziomej (SYBIRPUNK-like): cx=0.10, cy=0.71, w=0.14, h=0.05

Zwróć TYLKO JSON array. Bez objaśnień.`;

// ── Eksperyment 3: Worked example dla stosu poziomego ──────────────────
// Konkretny przepracowany przykład dla leżących książek.
const EXP3_WORKED_EXAMPLE = `Jesteś vision-asystentem do katalogowania książek.

Dla każdej książki zwróć JSON z polami:
position, title, author, confidence, orientation, spine_color (z: ${SPINE_COLORS}), bbox [x1,y1,x2,y2]

Współrzędne 0..1 (lewy-górny=[0,0], prawy-dolny=[1,1]). NIGDY wartości >1.

PRZYKŁAD OBLICZANIA bbox:

Stos poziomy (książki leżą, grzbiety widoczne z boku):
  → Wyobraź sobie poziomy pasek na zdjęciu.
  → x1 = lewa krawędź stosu (gdzie grzbiety się zaczynają) ~ 0.02-0.05
  → x2 = prawa krawędź stosu (gdzie grzbiety się kończą) ~ 0.15-0.25
  → y1 = górna powierzchnia tej jednej książki (cienki pasek)
  → y2 = dolna powierzchnia tej jednej książki, y2-y1 ≈ 0.03-0.06
  Wynik: szerokie w osi x, cienkie w osi y, np. [0.04, 0.68, 0.17, 0.73]

Stojąca pionowo (grzbiet pionowy na półce):
  → x1, x2: lewa i prawa krawędź grzbietu, x2-x1 ≈ 0.02-0.05
  → y1: szczyt grzbietu (gdzie zaczyna się okładka)
  → y2: DOŁ grzbietu = deska półki, y2 ≈ 0.78-0.85
  Wynik: wąskie w osi x, sięgające do deski półki, np. [0.22, 0.24, 0.25, 0.82]

Dla każdej książki najpierw oceń orientation, potem policz bbox wg powyższego wzoru.
Zwróć TYLKO JSON array.`;

const VARIANTS = [
  { label: 'EXP2-center+size', prompt: EXP2_CENTER_SIZE },
  { label: 'EXP3-worked-example', prompt: EXP3_WORKED_EXAMPLE },
];

function calcCost(u) {
  return (u.input_tokens/1e6)*3 + (u.output_tokens/1e6)*15;
}

function parseResult(text) {
  // Dla EXP1: pomijamy pierwszy wiersz JSON (kotwice), bierzemy tablicę
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (!arrMatch) return null;
  try { return JSON.parse(arrMatch[0]); } catch { return null; }
}

function bboxFromCenterSize(d) {
  if (d.bbox) return d.bbox;
  if (d.cx != null && d.cy != null && d.w != null && d.h != null) {
    return [d.cx - d.w/2, d.cy - d.h/2, d.cx + d.w/2, d.cy + d.h/2];
  }
  return null;
}

function analyze(dets, label, text = '') {
  if (!dets) { console.log(`  [${label}] PARSE FAIL`); return; }

  const sybirpunk = dets.filter(d => d.title?.toUpperCase().includes('SYBIRPUNK'));
  const topStack = dets.filter(d => {
    const b = bboxFromCenterSize(d);
    return b && b[1] < 0.35 && (b[2]-b[0]) > 0.10; // top area, wide
  });
  const standing = dets.filter(d => d.orientation === 'vertical');

  console.log(`\n  Total: ${dets.length} | vertical: ${standing.length}`);

  // SYBIRPUNK test
  if (sybirpunk.length === 0) {
    console.log('  ⚠️  SYBIRPUNK: nie wykryto');
  } else {
    for (const s of sybirpunk) {
      const b = bboxFromCenterSize(s);
      if (!b) { console.log(`  SYBIRPUNK #${s.position}: bbox=null`); continue; }
      const w = b[2]-b[0], h = b[3]-b[1];
      const isWide = w > 0.08; // powinno być szerokie
      const isThin = h < 0.10; // powinno być cienkie
      const yOk = b[1] > 0.50; // powinno być w dolnej połowie
      const status = (isWide && isThin && yOk) ? '✅' : `❌(w=${w.toFixed(3)} h=${h.toFixed(3)} y1=${b[1].toFixed(3)})`;
      console.log(`  SYBIRPUNK #${s.position} [${s.orientation}] ${status} → [${b.map(v=>v.toFixed(3)).join(',')}]`);
    }
  }

  // Top stack (Raz Wiedźmie etc.)
  console.log(`  Top-stack (y<0.35, w>0.10): ${topStack.length}`);
  for (const d of topStack.slice(0,4)) {
    const b = bboxFromCenterSize(d);
    if (!b) continue;
    console.log(`    #${d.position} "${d.title.slice(0,30)}" → w=${(b[2]-b[0]).toFixed(3)} h=${(b[3]-b[1]).toFixed(3)}`);
  }

  // Vertical y2 check
  const y2vals = standing.map(d => { const b = bboxFromCenterSize(d); return b ? b[3] : null; }).filter(Boolean);
  if (y2vals.length > 0) {
    const avgY2 = y2vals.reduce((a,b)=>a+b,0)/y2vals.length;
    const y2Ok = avgY2 > 0.70;
    console.log(`  Vertical y2: avg=${avgY2.toFixed(3)} ${y2Ok ? '✅ (>0.70)' : '❌ (<0.70, cut off)'}`);
  }

  // Anchor info (EXP1 only)
  const anchorMatch = text?.match(/\{"shelf_y"[^}]+\}/);
  if (anchorMatch) {
    console.log(`  Kotwice: ${anchorMatch[0]}`);
  }
}

async function run() {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let totalCost = 0;

  for (const v of VARIANTS) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`🔬 ${v.label}`);
    console.log('═'.repeat(65));

    const start = Date.now();
    let text = '', dets = null;
    try {
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: v.prompt,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgB64 } },
          { type: 'text', text: 'Wymień książki na zdjęciu.' }
        ]}],
      });
      text = resp.content.filter(b=>b.type==='text').map(b=>b.text).join('');
      dets = parseResult(text);
      const cost = calcCost(resp.usage);
      totalCost += cost;
      console.log(`  latency=${Date.now()-start}ms cost=$${cost.toFixed(5)}`);
    } catch(e) {
      console.error(`  ERROR: ${e.message}`);
      continue;
    }

    analyze(dets, v.label, text);

    // Show first 200 chars of raw for EXP1 (to see anchors)
    if (v.label.includes('anchor')) {
      console.log(`  Raw preview: ${text.slice(0, 200).replace(/\n/g,' ')}`);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n${'═'.repeat(65)}`);
  console.log(`Łączny koszt: $${totalCost.toFixed(5)}`);
}

run().catch(e => { console.error(e); process.exit(1); });
