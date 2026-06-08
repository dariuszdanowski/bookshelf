/**
 * Identity-test (S-40 reframe) — czy prompt BEZ bbox czyta tytuły lepiej niż v6 z bbox?
 *
 * Mierzy to, co naprawdę liczy się produktowo: ROZPOZNANIE (title-recall + precyzja),
 * nie lokalizację. Dopasowanie po fuzzy-tytule (znorm. Levenshtein ≥ próg), NIE po IoU.
 *
 * Uruchom: node scripts/bbox-identity-test.mjs [--runs 2] [--photo 04,02,03]
 * Porównuje: v6 (z bbox) vs identity-only (bez bbox) na tych samych zdjęciach.
 * Wymaga ANTHROPIC_API_KEY w .dev.vars lub env.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GT_DIR = resolve(ROOT, 'docs/image-analysis/bbox-groundtruth');

const PHOTOS = [
  { id: '04', file: '04-shelf-dariusz.jpg', gtFile: '04-shelf-dariusz.json', type: 'shelf' },
  { id: '02', file: '02-mixed-display.jpg', gtFile: '02-mixed.json', type: 'mixed' },
  { id: '03', file: '03-bed-nonshelf-display.jpg', gtFile: '03-bed-nonshelf.json', type: 'none' },
];

// v6 verbatim (z bbox) — skopiowany z bbox-iou-benchmark.mjs dla porównania
const PROMPT_V6 = readFileSync(
  resolve(__dirname, 'bbox-variants/_v6-snapshot.txt'),
  'utf-8',
).trim();
const PROMPT_IDENTITY = readFileSync(
  resolve(__dirname, 'bbox-variants/identity-only.txt'),
  'utf-8',
).trim();

function parseArgs() {
  const argv = process.argv.slice(2);
  let runs = 2,
    photoId = '04,02,03';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs' && argv[i + 1]) runs = parseInt(argv[++i], 10);
    else if (argv[i] === '--photo' && argv[i + 1]) photoId = argv[++i];
  }
  return { runs, photoId };
}

function loadApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const devVars = readFileSync(resolve(ROOT, '.dev.vars'), 'utf-8');
  for (const line of devVars.split('\n')) {
    const m = line.match(/^ANTHROPIC_API_KEY\s*=\s*(.+)$/);
    if (m) return m[1].trim();
  }
  throw new Error('Brak ANTHROPIC_API_KEY');
}

// ─── normalizacja + fuzzy ──────────────────────────────────────────────────────
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diakrytyki
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function lev(a, b) {
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[m][n];
}
function titleSim(a, b) {
  const na = norm(a),
    nb = norm(b);
  if (!na || !nb) return 0;
  // token-aware: nagroda za wspólny rdzeń tytułu (model często dodaje/gubi podtytuł)
  const full = 1 - lev(na, nb) / Math.max(na.length, nb.length);
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  const contains = longer.includes(shorter) ? 0.85 : 0;
  return Math.max(full, contains);
}

const SIM_THRESHOLD = 0.6;

// greedy title matching GT↔detekcje
function matchTitles(gtTitles, detTitles) {
  const used = new Set();
  const matches = gtTitles.map((gt) => {
    let best = 0,
      bi = -1;
    detTitles.forEach((dt, i) => {
      if (used.has(i)) return;
      const s = titleSim(gt, dt);
      if (s > best) {
        best = s;
        bi = i;
      }
    });
    if (bi >= 0 && best >= SIM_THRESHOLD) {
      used.add(bi);
      return { gt, det: detTitles[bi], sim: best };
    }
    return { gt, det: null, sim: best };
  });
  return { matches, falsePositives: detTitles.length - used.size };
}

async function runVision(client, imgB64, systemPrompt) {
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgB64 } },
          { type: 'text', text: 'Wymień pozycje na zdjęciu.' },
        ],
      },
    ],
  });
  const cost = (resp.usage.input_tokens / 1e6) * 3 + (resp.usage.output_tokens / 1e6) * 15;
  let dets = [];
  try {
    const raw = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    dets = JSON.parse(
      raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim(),
    );
    if (!Array.isArray(dets)) dets = [];
  } catch (e) {
    process.stderr.write(`  parse error: ${e.message}\n`);
  }
  return { dets, cost };
}

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  const { runs, photoId } = parseArgs();
  const ids = photoId.split(',').map((s) => s.trim());
  const photos = PHOTOS.filter((p) => ids.includes(p.id));
  const client = new Anthropic({ apiKey: loadApiKey() });
  const variants = [
    { label: 'v6 (z bbox)', text: PROMPT_V6 },
    { label: 'identity (bez bbox)', text: PROMPT_IDENTITY },
  ];

  const out = [];
  const log = (s) => {
    out.push(s);
    process.stdout.write(s + '\n');
  };
  log('\nIdentity-test — rozpoznanie tytułów (fuzzy match), v6 vs identity-only');
  log('═'.repeat(72));

  const summary = [];
  for (const photo of photos) {
    const imgB64 = readFileSync(resolve(GT_DIR, photo.file)).toString('base64');
    const gt = JSON.parse(readFileSync(resolve(GT_DIR, photo.gtFile), 'utf-8'));
    const gtTitles = gt.detections.map((d) => d.title).filter((t) => t && !/niezn/i.test(t));
    log(`\n📷 ${photo.id} (${photo.type})  GT czytelnych tytułów=${gtTitles.length}`);

    for (const v of variants) {
      const recalls = [],
        precisions = [],
        counts = [],
        costs = [];
      for (let r = 0; r < runs; r++) {
        const { dets, cost } = await runVision(client, imgB64, v.text);
        const detTitles = dets.map((d) => d.title).filter(Boolean);
        const { matches } = matchTitles(gtTitles, detTitles);
        const hit = matches.filter((m) => m.det).length;
        const recall = gtTitles.length ? hit / gtTitles.length : 0;
        const precision = detTitles.length ? hit / detTitles.length : 0;
        recalls.push(recall);
        precisions.push(precision);
        counts.push(detTitles.length);
        costs.push(cost);
        if (r < runs - 1) await new Promise((res) => setTimeout(res, 1500));
      }
      const medR = median(recalls),
        medP = median(precisions),
        medC = median(counts);
      const totalCost = costs.reduce((s, c) => s + c, 0);
      summary.push({
        photo: photo.id,
        type: photo.type,
        variant: v.label,
        medR,
        medP,
        medC,
        gt: gtTitles.length,
        totalCost,
      });
      log(
        `   ${v.label.padEnd(20)} title-recall=${(medR * 100).toFixed(0)}%  precyzja=${(medP * 100).toFixed(0)}%  wykrytych=${medC}  $${totalCost.toFixed(4)}`,
      );
    }
  }

  log(`\n${'═'.repeat(72)}\nPODSUMOWANIE (mediana z ${runs} przebiegów)`);
  log('Photo Type   Wariant               recall  precyzja  wykrytych/GT');
  log('-'.repeat(72));
  let total = 0;
  for (const s of summary) {
    log(
      `${s.photo}   ${s.type.padEnd(6)} ${s.variant.padEnd(20)} ${(s.medR * 100).toFixed(0).padStart(4)}%   ${(s.medP * 100).toFixed(0).padStart(4)}%     ${s.medC}/${s.gt}`,
    );
    total += s.totalCost;
  }
  log(`\nŁączny koszt: $${total.toFixed(4)}`);
  writeFileSync(
    resolve(GT_DIR, 'identity-test-results.md'),
    '# Identity-test — wyniki\n\n```\n' + out.join('\n') + '\n```\n',
    'utf-8',
  );
  process.stdout.write('\n📄 → docs/image-analysis/bbox-groundtruth/identity-test-results.md\n');
}

main().catch((e) => {
  process.stderr.write(e.message + '\n');
  process.exit(1);
});
