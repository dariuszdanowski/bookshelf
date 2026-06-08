/**
 * Bbox self-test (BEZ API) — S-40.
 *
 * Porównuje 3 źródła bboxów względem ręcznego ground-truth usera:
 *   - GT          : <photo>.json                (ręczna anotacja usera)
 *   - llm-read    : <photo>.llm.json            (detekcja agenta Claude via Read tool)
 *   - model-v6    : <photo>-model-v6.json       (realny output API Sonnet, prompt v6)
 *
 * Cel: rozstrzygnąć czy słaby bbox to (a) wrodzona słabość modelu w lokalizacji,
 * czy (b) artefakt promptu/inferencji — przez kontrast careful-read vs single-shot-API.
 *
 * Dodatkowo liczy DOPASOWANIE AFINICZNE (regresja środków bbox źródła vs GT):
 *   src_center = a * gt_center + b  (osobno X i Y).
 *   slope a≈1, offset b≈0 → wierne; a≠1 → rozciągnięcie; b≠0 → przesunięcie.
 *
 * Uruchom: node scripts/bbox-llm-selftest.mjs
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GT_DIR = resolve(ROOT, 'docs/image-analysis/bbox-groundtruth');

// Realny baseline API v6 (z results.md, single-run pomiary) dla referencji w raporcie.
const PROD_V6_REF = {
  '01': { medIoU: 0.28, recall: 0.78, pctY2: 1.0 },
  '02': { medIoU: 0.15, recall: 0.67, pctY2: 0.67 },
  '03': { medIoU: 0.14, recall: 0.63, pctY2: 0.17 },
};

const PHOTOS = [
  {
    id: '01',
    gt: '01-shelf-vertical.json',
    sources: { 'llm-read': '01-shelf-vertical.llm.json', 'model-v6': '01-model-v6.json' },
  },
  { id: '02', gt: '02-mixed.json', sources: { 'llm-read': '02-mixed.llm.json' } },
  { id: '03', gt: '03-bed-nonshelf.json', sources: { 'llm-read': '03-bed-nonshelf.llm.json' } },
  {
    id: '04',
    gt: '04-shelf-dariusz.json',
    sources: { 'llm-read': '04-shelf-dariusz.llm.json', 'model-v6': '01-model-v6.json' },
  },
];

// ─── geometria ────────────────────────────────────────────────────────────────
function iou(a, b) {
  const ix1 = Math.max(a[0], b[0]),
    iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]),
    iy2 = Math.min(a[3], b[3]);
  const iw = Math.max(0, ix2 - ix1),
    ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
}

function greedyMatch(dets, gtList) {
  const used = new Set();
  const matches = gtList.map((gt) => {
    let best = 0,
      bestIdx = -1;
    for (let i = 0; i < dets.length; i++) {
      if (used.has(i)) continue;
      const s = iou(gt.bbox, dets[i].bbox);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      return { gt, det: dets[bestIdx], iou: best };
    }
    return { gt, det: null, iou: 0 };
  });
  return { matches, falsePositives: dets.length - used.size };
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clustering(dets) {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const y2 = dets.map((d) => r3(d.bbox[3]));
  const y1 = dets.map((d) => r3(d.bbox[1]));
  const freq = (a) => a.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {});
  const maxf = (a) => Math.max(...Object.values(freq(a)));
  const mode = (a) => {
    const f = freq(a);
    const mx = maxf(a);
    return parseFloat(Object.entries(f).find(([, c]) => c === mx)[0]);
  };
  return {
    pctY2: maxf(y2) / dets.length,
    modeY2: mode(y2),
    modeY2n: maxf(y2),
    pctY1: maxf(y1) / dets.length,
  };
}

// regresja liniowa y = a*x + b + R²
function linfit(xs, ys) {
  const n = xs.length;
  if (n < 2) return { a: NaN, b: NaN, r2: NaN };
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const a = sxy / sxx;
  const b = my - a * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  return { a, b, r2 };
}

const cx = (bb) => (bb[0] + bb[2]) / 2;
const cy = (bb) => (bb[1] + bb[3]) / 2;
const wdt = (bb) => bb[2] - bb[0];

// 1D IoU na interwale [x1,x2] — lokalizacja pozioma niezależna od szumu w Y.
function iou1d(a, b) {
  const lo = Math.max(a[0], b[0]),
    hi = Math.min(a[1], b[1]);
  const inter = Math.max(0, hi - lo);
  if (inter === 0) return 0;
  return inter / (a[1] - a[0] + (b[1] - b[0]) - inter);
}
const load = (f) => {
  const j = JSON.parse(readFileSync(resolve(GT_DIR, f), 'utf-8'));
  return Array.isArray(j) ? j : j.detections;
};

// ─── main ───────────────────────────────────────────────────────────────────
const rows = [];
const affineRows = [];
const out = [];
const log = (s) => {
  out.push(s);
  process.stdout.write(s + '\n');
};

log('\nBbox SELF-TEST (bez API) — GT usera vs LLM-via-Read vs API v6');
log('═'.repeat(78));

for (const photo of PHOTOS) {
  const gtPath = resolve(GT_DIR, photo.gt);
  if (!existsSync(gtPath)) {
    log(`\n⚠ ${photo.id}: brak GT ${photo.gt}`);
    continue;
  }
  const gt = load(photo.gt);
  log(`\n📷 ${photo.id}  GT=${gt.length} książek`);

  for (const [srcName, srcFile] of Object.entries(photo.sources)) {
    if (!existsSync(resolve(GT_DIR, srcFile))) {
      log(`   ${srcName}: brak pliku ${srcFile}`);
      continue;
    }
    const dets = load(srcFile).filter((d) => d.bbox && d.bbox.length === 4);
    const { matches, falsePositives } = greedyMatch(dets, gt);
    const ious = matches.map((m) => m.iou);
    const matched = matches.filter((m) => m.det).length;
    const recall = matched / gt.length;
    const cl = clustering(dets);

    // afiniczne dopasowanie na sparowanych środkach
    const pairs = matches.filter((m) => m.det);
    const gx = pairs.map((m) => cx(m.gt.bbox)),
      sx = pairs.map((m) => cx(m.det.bbox));
    const gy = pairs.map((m) => cy(m.gt.bbox)),
      sy = pairs.map((m) => cy(m.det.bbox));
    const fx = linfit(gx, sx),
      fy = linfit(gy, sy);

    // diagnostyki kierunkowe na sparowanych boxach
    const xIoUs = pairs.map((m) =>
      iou1d([m.gt.bbox[0], m.gt.bbox[2]], [m.det.bbox[0], m.det.bbox[2]]),
    );
    const widthRatios = pairs.map((m) => wdt(m.det.bbox) / wdt(m.gt.bbox));
    const y2errs = pairs.map((m) => Math.abs(m.det.bbox[3] - m.gt.bbox[3]));
    const centerHits = pairs.filter(
      (m) => cx(m.det.bbox) >= m.gt.bbox[0] && cx(m.det.bbox) <= m.gt.bbox[2],
    ).length;
    const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

    rows.push({
      id: photo.id,
      src: srcName,
      medIoU: median(ious),
      meanIoU: mean(ious),
      recall,
      fp: falsePositives,
      pctY2: cl.pctY2,
      modeY2: cl.modeY2,
      modeY2n: cl.modeY2n,
      pctY1: cl.pctY1,
      n: dets.length,
      xIoU: median(xIoUs),
      widthRatio: mean(widthRatios),
      y2err: mean(y2errs),
      centerHit: pairs.length ? centerHits / pairs.length : 0,
    });
    affineRows.push({ id: photo.id, src: srcName, fx, fy });

    log(
      `   ${srcName.padEnd(9)} dets=${dets.length} recall=${(recall * 100).toFixed(0)}% medIoU(2D)=${median(ious).toFixed(3)} med-xIoU(1D)=${median(xIoUs).toFixed(3)} fp=${falsePositives}`,
    );
    log(
      `             centerHit=${pairs.length ? ((centerHits / pairs.length) * 100).toFixed(0) : 0}% (środek detekcji w GT książce)  szerokość×${mean(widthRatios).toFixed(2)}  |Δy2|=${mean(y2errs).toFixed(3)}`,
    );
    log(
      `             klaster: %Y2=${(cl.pctY2 * 100).toFixed(0)}% (mode=${cl.modeY2} ×${cl.modeY2n})  %Y1=${(cl.pctY1 * 100).toFixed(0)}%`,
    );
    log(
      `             afiniczne X: src=${fx.a.toFixed(2)}·gt${fx.b >= 0 ? '+' : ''}${fx.b.toFixed(3)} (R²=${fx.r2.toFixed(3)})`,
    );
  }
}

// ─── tabela zbiorcza ──────────────────────────────────────────────────────────
log(`\n${'═'.repeat(78)}`);
log('PODSUMOWANIE');
log('═'.repeat(78));
log('Photo Źródło    recall 2D-IoU 1D-xIoU ctrHit  szer×  |Δy2|  %Y2cl');
log('-'.repeat(78));
for (const r of rows) {
  log(
    `${r.id}    ${r.src.padEnd(9)} ${(r.recall * 100).toFixed(0).padStart(4)}%  ${r.medIoU.toFixed(3)}  ${r.xIoU.toFixed(3)}  ${(r.centerHit * 100).toFixed(0).padStart(4)}%  ${r.widthRatio.toFixed(2)}  ${r.y2err.toFixed(3)}  ${(r.pctY2 * 100).toFixed(0).padStart(4)}%`,
  );
}

log('\nReferencja prod API v6 (results.md, single-run):');
for (const [id, ref] of Object.entries(PROD_V6_REF)) {
  log(
    `  ${id}: medIoU≈${ref.medIoU} recall≈${(ref.recall * 100).toFixed(0)}% %Y2cluster≈${(ref.pctY2 * 100).toFixed(0)}%`,
  );
}

log('\nInterpretacja afiniczna: slope a≈1.0 & offset b≈0.0 = wierne odwzorowanie.');
log('  a>1 = rozciągnięcie osi, |b|>0.05 = przesunięcie. Niskie R² = szum (brak liniowości).');

writeFileSync(
  resolve(GT_DIR, 'selftest-results.md'),
  '# Bbox self-test (bez API) — wyniki\n\n```\n' + out.join('\n') + '\n```\n',
  'utf-8',
);
process.stdout.write('\n📄 Zapisano → docs/image-analysis/bbox-groundtruth/selftest-results.md\n');
