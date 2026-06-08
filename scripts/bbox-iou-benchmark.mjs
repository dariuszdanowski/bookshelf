/**
 * IoU-based bbox quality benchmark dla S-40.
 *
 * Uruchom: node scripts/bbox-iou-benchmark.mjs --prompt v6 --photo all [--runs 3]
 * Opcje:
 *   --prompt v6            produkcyjny prompt v6 (src/lib/vision/prompt.ts)
 *   --prompt scripts/bbox-variants/v7a.txt  wariant z pliku
 *   --photo all            wszystkie 3 zdjęcia referencyjne
 *   --photo 01             tylko zdjęcie 01-shelf-vertical
 *   --runs 3               liczba przebiegów per zdjęcie (domyślnie 3)
 *
 * Wymaga: ANTHROPIC_API_KEY w .dev.vars lub env
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GT_DIR = resolve(ROOT, 'docs/image-analysis/bbox-groundtruth');
const RESULTS_PATH = resolve(GT_DIR, 'results.md');

// ─── Produkcyjny prompt v6 (verbatim z src/lib/vision/prompt.ts) ─────────────
// Adaptacja literalna: nie możemy importować .ts z .mjs bez transpilera —
// wartość skopiowana ręcznie; przy zmianie prompt.ts synchronizować.
const PROMPT_V6 = `Jesteś vision-asystentem do katalogowania książek. Otrzymujesz zdjęcie półki widzianej od grzbietów. Wymień każdą widoczną książkę od lewej do prawej, uwzględniając zarówno książki stojące pionowo jak i leżące poziomo w stosach.

Dla każdej książki zwróć JSON object:
- position: int (1 = pierwsza, licząc od lewej; stosy poziome zanim pionowe tego rzędu)
- title: string (tytuł na grzbiecie; dokładnie to co widzisz, bez poprawiania pisowni)
- author: string | null (autor jeśli widoczny na grzbiecie)
- confidence: float 0–1 (pewność odczytu; < 0.7 gdy tekst zasłonięty lub niewyraźny)
- orientation: "vertical" | "horizontal" (vertical = stoi pionowo, horizontal = leży w stosie)
- spine_color: string | null (dominujący kolor grzbietu z listy: czerwony, pomarańczowy, żółty, zielony, niebieski, granatowy, fioletowy, różowy, brązowy, czarny, biały, szary; null jeśli nie pasuje żaden)
- bbox: [x1, y1, x2, y2]

Reguły odczytu:
- NIE zgaduj tytułu — pusta lista lepsza niż halucynacja
- Tekst częściowo zasłonięty → zwróć z confidence < 0.7 (nie pomijaj)
- Tytuły i autorów polskich zostaw po polsku
- Zwróć TYLKO JSON array, bez żadnego tekstu przed ani po
- Jeśli nie ma książek → zwróć []

Instrukcja bbox — współrzędne 0..1 względem PEŁNEGO zdjęcia (NIGDY piksele, NIGDY wartości >1):

PRZYKŁAD obliczania bbox dla stosu poziomego (książki leżą, grzbiety widoczne z boku):
  Wyobraź sobie poziomy pasek. Każda książka to OSOBNY cienki pasek.
  x1 = lewa krawędź stosu = gdzie grzbiety się zaczynają
  x2 = prawa krawędź stosu = gdzie grzbiety się kończą  [x2-x1 typowo 0.10–0.25]
  y1 = górna powierzchnia tej jednej książki
  y2 = dolna powierzchnia tej jednej książki             [y2-y1 typowo 0.03–0.07]
  Wynik: SZEROKIE w osi x, CIENKIE w osi y → np. [0.03, 0.63, 0.22, 0.67]

PRZYKŁAD obliczania bbox dla stojącej pionowo:
  x1,x2 = lewa/prawa krawędź grzbietu                  [x2-x1 typowo 0.015–0.05]
  y1 = szczyt grzbietu (górna krawędź okładki)          [typowo 0.18–0.28]
  y2 = DOŁ grzbietu = deska półki (NIE dół tekstu!)     [typowo 0.75–0.88]
  Wynik: WĄSKIE w osi x, SIĘGAJĄCE DO PÓŁKI w osi y → np. [0.22, 0.24, 0.25, 0.82]

Jeśli niepewny lokalizacji: podaj best-effort (przybliżenie > null).

Format: [{"position":1,"title":"...","author":"...","confidence":0.95,"orientation":"vertical","spine_color":"niebieski","bbox":[0.12,0.24,0.17,0.82]}, ...]`;

// ─── Manifest zdjęć referencyjnych ──────────────────────────────────────────
// exif: 1 = brak rotacji (GT ↔ model = ten sam układ współrzędnych)
// 02/03: wysyłamy plik -display.jpg (ExifTranspose → czyste EXIF=1 portrait 1848×4000);
//        GT anotowane w tym samym układzie display-coords (x_d=1-y_raw, y_d=x_raw).
const PHOTOS = [
  { id: '01', file: '01-shelf-vertical.jpg', gtFile: '01-shelf-vertical.json', exif: 1 },
  { id: '02', file: '02-mixed-display.jpg', gtFile: '02-mixed.json', exif: 1 },
  { id: '03', file: '03-bed-nonshelf-display.jpg', gtFile: '03-bed-nonshelf.json', exif: 1 },
  { id: '04', file: '04-shelf-dariusz.jpg', gtFile: '04-shelf-dariusz.json', exif: 1 },
];

// ─── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  let promptKey = 'v6';
  let photoId = 'all';
  let runs = 3;
  let showTitles = false;
  let thinkingBudget = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--prompt' && argv[i + 1]) promptKey = argv[++i];
    else if (argv[i] === '--photo' && argv[i + 1]) photoId = argv[++i];
    else if (argv[i] === '--runs' && argv[i + 1]) runs = parseInt(argv[++i], 10);
    else if (argv[i] === '--thinking' && argv[i + 1]) thinkingBudget = parseInt(argv[++i], 10);
    else if (argv[i] === '--titles') showTitles = true;
  }
  return { promptKey, photoId, runs, showTitles, thinkingBudget };
}

// --photo akceptuje 'all', pojedynczy id, lub listę przez przecinek (np. 02,03,04)
function selectPhotos(photoId) {
  if (photoId === 'all') return PHOTOS;
  const ids = photoId.split(',').map((s) => s.trim());
  return PHOTOS.filter((p) => ids.includes(p.id));
}

// ─── API key ─────────────────────────────────────────────────────────────────
function loadApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const devVars = readFileSync(resolve(ROOT, '.dev.vars'), 'utf-8');
    for (const line of devVars.split('\n')) {
      const m = line.match(/^ANTHROPIC_API_KEY\s*=\s*(.+)$/);
      if (m) return m[1].trim();
    }
  } catch {}
  throw new Error('Brak ANTHROPIC_API_KEY w env ani .dev.vars');
}

// ─── Prompt loader ───────────────────────────────────────────────────────────
function loadPrompt(promptKey) {
  if (promptKey === 'v6') return { label: 'v6', text: PROMPT_V6 };
  const filePath = resolve(ROOT, promptKey);
  if (!existsSync(filePath)) throw new Error(`Plik promptu nie istnieje: ${filePath}`);
  const text = readFileSync(filePath, 'utf-8').trim();
  const label = promptKey.replace(/.*[\\/]/, '').replace(/\.txt$/, '');
  return { label, text };
}

// ─── IoU ─────────────────────────────────────────────────────────────────────
function iou(a, b) {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter === 0) return 0;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
}

// 1D IoU na interwale (oś X) — lokalizacja pozioma niezależna od szumu/konwencji w Y.
function iou1d(a0, a1, b0, b1) {
  const lo = Math.max(a0, b0),
    hi = Math.min(a1, b1);
  const inter = Math.max(0, hi - lo);
  if (inter === 0) return 0;
  return inter / (a1 - a0 + (b1 - b0) - inter);
}

// Metryki kierunkowe na sparowanych boxach (S-40 self-test: 2D-IoU za grubo na wąskie grzbiety).
function directionalMetrics(matches) {
  const pairs = matches.filter((m) => m.det);
  if (!pairs.length) return { xIoU: 0, widthRatio: 0, y2err: 0, centerHit: 0 };
  const cx = (bb) => (bb[0] + bb[2]) / 2;
  const xIoUs = pairs.map((m) => iou1d(m.gt.bbox[0], m.gt.bbox[2], m.det.bbox[0], m.det.bbox[2]));
  const widthRatios = pairs.map(
    (m) => (m.det.bbox[2] - m.det.bbox[0]) / (m.gt.bbox[2] - m.gt.bbox[0]),
  );
  const y2errs = pairs.map((m) => Math.abs(m.det.bbox[3] - m.gt.bbox[3]));
  const hits = pairs.filter(
    (m) => cx(m.det.bbox) >= m.gt.bbox[0] && cx(m.det.bbox) <= m.gt.bbox[2],
  ).length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const med = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return {
    xIoU: med(xIoUs),
    widthRatio: mean(widthRatios),
    y2err: mean(y2errs),
    centerHit: hits / pairs.length,
  };
}

// Greedy max-IoU matching: każdy GT sparowany z najbliższą detekcją (F4).
function greedyMatch(detections, gtList) {
  const dets = detections.filter((d) => d.bbox && d.bbox.length === 4);
  const used = new Set();
  const matches = gtList.map((gt) => {
    let bestScore = 0;
    let bestIdx = -1;
    for (let i = 0; i < dets.length; i++) {
      if (used.has(i)) continue;
      const score = iou(gt.bbox, dets[i].bbox);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      return { gt, det: dets[bestIdx], iou: bestScore };
    }
    return { gt, det: null, iou: 0 };
  });
  const falsePositives = dets.filter((_, i) => !used.has(i)).length;
  return { matches, falsePositives };
}

// ─── Metryki klastrowania ─────────────────────────────────────────────────────
function clusteringMetrics(detections) {
  const bboxDets = detections.filter((d) => d.bbox && d.bbox.length === 4);
  if (bboxDets.length === 0)
    return { pctY2: 0, pctY1: 0, modeY2: null, modeY1: null, offFrame: 0, total: 0 };

  const r3 = (v) => Math.round(v * 1000) / 1000;
  const y2vals = bboxDets.map((d) => r3(d.bbox[3]));
  const y1vals = bboxDets.map((d) => r3(d.bbox[1]));

  const freq = (arr) =>
    arr.reduce((acc, v) => {
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});
  const y2freq = freq(y2vals);
  const y1freq = freq(y1vals);
  const maxY2 = Math.max(...Object.values(y2freq));
  const maxY1 = Math.max(...Object.values(y1freq));
  const modeY2 = parseFloat(Object.entries(y2freq).find(([, c]) => c === maxY2)?.[0] ?? 0);
  const modeY1 = parseFloat(Object.entries(y1freq).find(([, c]) => c === maxY1)?.[0] ?? 0);
  const offFrame = bboxDets.filter(
    (d) => d.bbox[0] < 0 || d.bbox[1] < 0 || d.bbox[2] > 1 || d.bbox[3] > 1,
  ).length;

  return {
    pctY2: maxY2 / bboxDets.length,
    pctY1: maxY1 / bboxDets.length,
    modeY2Count: maxY2,
    modeY1Count: maxY1,
    modeY2,
    modeY1,
    offFrame,
    total: bboxDets.length,
  };
}

// ─── Statystyki ──────────────────────────────────────────────────────────────
function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
}

// ─── Vision call ─────────────────────────────────────────────────────────────
function stripFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function calcCost(usage) {
  return (usage.input_tokens / 1_000_000) * 3 + (usage.output_tokens / 1_000_000) * 15;
}

async function runVision(client, imgB64, systemPrompt, thinkingBudget = 0) {
  const params = {
    model: 'claude-sonnet-4-6',
    max_tokens: thinkingBudget > 0 ? thinkingBudget + 4096 : 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgB64 } },
          { type: 'text', text: 'Wymień książki na zdjęciu.' },
        ],
      },
    ],
  };
  if (thinkingBudget > 0) params.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
  const resp = await client.messages.create(params);
  const cost = calcCost(resp.usage);
  let detections = [];
  try {
    const raw = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    detections = JSON.parse(stripFences(raw));
    if (!Array.isArray(detections)) detections = [];
  } catch (e) {
    process.stderr.write(`  [vision] JSON parse error: ${e.message}\n`);
  }
  return { detections, cost };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { promptKey, photoId, runs, showTitles, thinkingBudget } = parseArgs();
  const promptInfo = loadPrompt(promptKey);
  if (thinkingBudget > 0) promptInfo.label += `+think${thinkingBudget}`;
  const apiKey = loadApiKey();
  const client = new Anthropic({ apiKey });

  const photos = selectPhotos(photoId);
  if (photos.length === 0)
    throw new Error(
      `Nieznane --photo: ${photoId}. Dostępne: all, 01, 02, 03, 04 (lub lista 02,03,04)`,
    );

  process.stdout.write(`\nBbox IoU Benchmark — S-40\n`);
  process.stdout.write(
    `Prompt: ${promptInfo.label}  |  Photos: ${photos.map((p) => p.id).join(',')}  |  Runs: ${runs}\n`,
  );
  process.stdout.write('═'.repeat(70) + '\n');

  const allResults = [];

  for (const photo of photos) {
    const imgPath = resolve(GT_DIR, photo.file);
    const gtPath = resolve(GT_DIR, photo.gtFile);

    if (!existsSync(imgPath)) {
      process.stdout.write(
        `\n⚠ Brak obrazu: ${photo.file} — pomijam (gitignored, pobierz z Storage)\n`,
      );
      continue;
    }

    const gt = JSON.parse(readFileSync(gtPath, 'utf-8'));
    const imgB64 = readFileSync(imgPath).toString('base64');
    const exifNote =
      photo.exif !== 1
        ? ` ⚠ EXIF=${photo.exif} (GT może być w orientacji RAW — IoU niereptzentatywne do re-anotacji)`
        : '';

    process.stdout.write(
      `\n📷 ${photo.id} (${gt.type})  GT=${gt.detections.length} książek${exifNote}\n`,
    );

    const runResults = [];

    for (let r = 0; r < runs; r++) {
      process.stdout.write(`  run ${r + 1}/${runs}... `);
      const { detections, cost } = await runVision(client, imgB64, promptInfo.text, thinkingBudget);
      const { matches, falsePositives } = greedyMatch(detections, gt.detections);
      const ious = matches.map((m) => m.iou);
      const matched = matches.filter((m) => m.det !== null).length;
      const recall = gt.detections.length > 0 ? matched / gt.detections.length : 0;
      const cluster = clusteringMetrics(detections);
      const dir = directionalMetrics(matches);

      // Zapis surowych detekcji (do późniejszego overlay / re-scoringu, F: dane nie giną)
      writeFileSync(
        resolve(GT_DIR, `${photo.id}-${promptInfo.label}-run${r + 1}.raw.json`),
        JSON.stringify(detections, null, 2),
        'utf-8',
      );

      runResults.push({
        ious,
        recall,
        cluster,
        dir,
        detCount: detections.length,
        falsePositives,
        cost,
      });
      process.stdout.write(
        `dets=${detections.length} recall=${(recall * 100).toFixed(0)}% medIoU=${median(ious).toFixed(3)} xIoU=${dir.xIoU.toFixed(3)} szer×${dir.widthRatio.toFixed(2)} |Δy2|=${dir.y2err.toFixed(3)} ctr=${(dir.centerHit * 100).toFixed(0)}% fp=${falsePositives} $${cost.toFixed(4)}\n`,
      );

      if (showTitles) {
        const trunc = (s, n) => (s ? (s.length > n ? s.slice(0, n - 1) + '…' : s) : '—');
        process.stdout.write(`  ${'GT tytuł'.padEnd(42)}  ${'Model tytuł'.padEnd(42)}  IoU\n`);
        process.stdout.write(`  ${'-'.repeat(42)}  ${'-'.repeat(42)}  ----\n`);
        for (const m of matches) {
          const gtT = trunc(m.gt.title, 42).padEnd(42);
          const detT = trunc(m.det?.title ?? '(miss)', 42).padEnd(42);
          const iouStr = m.iou > 0 ? m.iou.toFixed(3) : '  — ';
          const marker = m.det === null ? '✗' : m.iou < 0.3 ? '⚠' : '✓';
          process.stdout.write(`  ${marker} ${gtT}  ${detT}  ${iouStr}\n`);
        }
        const fps = detections.filter(
          (_, i) => !matches.some((m) => m.det && detections.indexOf(m.det) === i),
        );
        for (const fp of fps) {
          process.stdout.write(
            `  + (fp) ${''.padEnd(39)}  ${trunc(fp.title, 42).padEnd(42)}  fp\n`,
          );
        }
      }

      if (r < runs - 1) await new Promise((res) => setTimeout(res, 2000));
    }

    // Agregat po N przebiegach (F1)
    const allIoUs = runResults.flatMap((r) => r.ious);
    const recalls = runResults.map((r) => r.recall);
    const pctY2s = runResults.map((r) => r.cluster.pctY2);
    const pctY1s = runResults.map((r) => r.cluster.pctY1);
    const xIoUs = runResults.map((r) => r.dir.xIoU);
    const widthRatios = runResults.map((r) => r.dir.widthRatio);
    const y2errs = runResults.map((r) => r.dir.y2err);
    const centerHits = runResults.map((r) => r.dir.centerHit);
    const totalCost = runResults.reduce((s, r) => s + r.cost, 0);

    const result = {
      photoId: photo.id,
      type: gt.type,
      exif: photo.exif,
      gtCount: gt.detections.length,
      promptLabel: promptInfo.label,
      runs,
      medIoU: median(allIoUs),
      stdIoU: stddev(allIoUs),
      medRecall: median(recalls),
      medPctY2: median(pctY2s),
      medPctY1: median(pctY1s),
      medXIoU: median(xIoUs),
      medWidthRatio: median(widthRatios),
      medY2err: median(y2errs),
      medCenterHit: median(centerHits),
      modeY2: runResults[0]?.cluster.modeY2 ?? null,
      modeY2Count: runResults[0]?.cluster.modeY2Count ?? 0,
      totalCost,
      exifNote: photo.exif !== 1,
      runResults,
    };
    allResults.push(result);

    process.stdout.write(
      `  ── agregat: medIoU=${result.medIoU.toFixed(3)} ±${result.stdIoU.toFixed(3)} recall=${(result.medRecall * 100).toFixed(0)}% xIoU=${result.medXIoU.toFixed(3)} szer×${result.medWidthRatio.toFixed(2)} |Δy2|=${result.medY2err.toFixed(3)} ctr=${(result.medCenterHit * 100).toFixed(0)}% %Y2cl=${(result.medPctY2 * 100).toFixed(0)}%\n`,
    );
    if (result.exifNote) {
      process.stdout.write(
        `  ── ⚠ EXIF!=1: IoU powyżej może być błędne (GT w RAW, model widzi display)\n`,
      );
    }
  }

  // ─── Tabela podsumowania ─────────────────────────────────────────────────
  process.stdout.write(`\n${'═'.repeat(70)}\n`);
  process.stdout.write('PODSUMOWANIE\n');
  process.stdout.write(`${'═'.repeat(70)}\n`);
  process.stdout.write('Photo  Type     medIoU  xIoU   szer×  |Δy2|  ctrHit Recall %Y2cl  Cost\n');
  process.stdout.write('-'.repeat(70) + '\n');

  let totalCost = 0;
  for (const r of allResults) {
    const warn = r.exifNote ? '*' : ' ';
    process.stdout.write(
      `${warn}${r.photoId}   ${r.type.padEnd(8)} ${r.medIoU.toFixed(3)}  ${r.medXIoU.toFixed(3)}  ${r.medWidthRatio.toFixed(2)}   ${r.medY2err.toFixed(3)}  ${(r.medCenterHit * 100).toFixed(0).padStart(4)}%  ${(r.medRecall * 100).toFixed(0).padStart(4)}%  ${(r.medPctY2 * 100).toFixed(0).padStart(4)}%  $${r.totalCost.toFixed(5)}\n`,
    );
    totalCost += r.totalCost;
  }
  if (allResults.some((r) => r.exifNote)) {
    process.stdout.write(
      `\n* EXIF!=1: GT orientacja może nie pasować do modelu — IoU niereptzentatywne\n`,
    );
  }
  process.stdout.write(`Łączny koszt: $${totalCost.toFixed(5)}\n`);

  // ─── Zapis results.md ────────────────────────────────────────────────────
  const runDate = new Date().toISOString().split('T')[0];

  const tableRows = allResults
    .map((r) => {
      const warn = r.exifNote ? '⚠' : '';
      return `| ${warn}${r.photoId} (${r.type}) | ${r.promptLabel} | ${r.medIoU.toFixed(3)} | ${r.medXIoU.toFixed(3)} | ${r.medWidthRatio.toFixed(2)} | ${r.medY2err.toFixed(3)} | ${(r.medCenterHit * 100).toFixed(0)}% | ${(r.medRecall * 100).toFixed(0)}% | ${(r.medPctY2 * 100).toFixed(0)}% (mode=${r.modeY2?.toFixed(3) ?? '?'} ×${r.modeY2Count}) | $${r.totalCost.toFixed(5)} |`;
    })
    .join('\n');

  const newSection = [
    `## ${runDate} — ${promptInfo.label} (${runs} runs/photo)\n`,
    '_Metryki kierunkowe (S-40 self-test): xIoU=1D IoU w osi X; szer×=stosunek szerokości det/GT (>1 za szerokie); |Δy2|=śr. błąd dolnej krawędzi; ctrHit=% środków detekcji w GT książce._\n',
    '| Foto (typ) | Prompt | medIoU | xIoU | szer× | \\|Δy2\\| | ctrHit | Recall | %Y2cluster | Koszt |',
    '|---|---|---|---|---|---|---|---|---|---|',
    tableRows,
    '',
    '⚠ = EXIF!=1: GT anotowane w orientacji RAW, model widzi display — IoU niereprezentatywne, re-anotacja wymagana.',
    '',
  ].join('\n');

  let existing = '';
  try {
    existing = readFileSync(RESULTS_PATH, 'utf-8');
  } catch {}

  if (existing) {
    writeFileSync(RESULTS_PATH, existing + '\n---\n\n' + newSection, 'utf-8');
  } else {
    writeFileSync(
      RESULTS_PATH,
      `# Bbox IoU Benchmark — S-40\n\n_Metryki: medIoU = median IoU po N przebiegach; ±σ = std dev; %Y2cluster = % detekcji z identycznym y2 (mod okrąglenie 0.001); Recall = dopasowane GT / łączne GT (greedy max-IoU)._\n\n` +
        newSection,
      'utf-8',
    );
  }

  process.stdout.write(`\n📄 Wyniki → docs/image-analysis/bbox-groundtruth/results.md\n`);
}

main().catch((e) => {
  process.stderr.write(e.message + '\n');
  process.exit(1);
});
