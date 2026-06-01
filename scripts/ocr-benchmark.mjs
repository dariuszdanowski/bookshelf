import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorker, PSM } from 'tesseract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.resolve(
  ROOT,
  process.argv[2] ?? 'docs/image-analysis/research-cases/benchmark-manifest.json'
);
const RESULTS_JSON_PATH = path.resolve(ROOT, 'docs/image-analysis/ocr-benchmark-results-2026-06.json');
const REPORT_MD_PATH = path.resolve(ROOT, 'docs/image-analysis/ocr-benchmark-report-2026-06.md');

const PROFILES = [
  {
    id: 'tesseract_psm7',
    name: 'Tesseract.js (PSM 7, single line)',
    psm: PSM.SINGLE_LINE,
  },
  {
    id: 'tesseract_psm6',
    name: 'Tesseract.js (PSM 6, uniform block)',
    psm: PSM.SINGLE_BLOCK,
  },
];

function normalizeText(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function similarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

function baselineSuccessRate(cases, threshold) {
  const primary = cases.filter((c) => c.track === 'ocr_repair');
  const hits = primary.filter((c) => similarity(c.baselineRawTitle ?? '', c.expectedTitle ?? '') >= threshold).length;
  return primary.length === 0 ? 0 : hits / primary.length;
}

function profileSummary(profileId, rows, threshold) {
  const primaryRows = rows.filter((r) => r.track === 'ocr_repair');
  const allRows = rows.filter((r) => r.profileId === profileId);
  const primaryProfile = primaryRows.filter((r) => r.profileId === profileId);
  const hits = primaryProfile.filter((r) => r.titleSimilarity >= threshold).length;
  const avgConfidence =
    allRows.length === 0
      ? 0
      : allRows.reduce((sum, r) => sum + (Number.isFinite(r.confidence) ? r.confidence : 0), 0) / allRows.length;

  return {
    profileId,
    totalCases: allRows.length,
    primaryCases: primaryProfile.length,
    recallAtTop1: primaryProfile.length === 0 ? 0 : hits / primaryProfile.length,
    avgConfidence,
  };
}

function pickBestProfile(summaries) {
  return summaries
    .slice()
    .sort((a, b) => {
      if (b.recallAtTop1 !== a.recallAtTop1) return b.recallAtTop1 - a.recallAtTop1;
      return b.avgConfidence - a.avgConfidence;
    })[0];
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function runProfile(profile, cases) {
  const worker = await createWorker('pol+eng');
  await worker.setParameters({
    tessedit_pageseg_mode: String(profile.psm),
    preserve_interword_spaces: '1',
  });

  const rows = [];
  for (const testCase of cases) {
    const imagePath = path.resolve(ROOT, testCase.image);
    const {
      data: { text, confidence },
    } = await worker.recognize(imagePath);

    rows.push({
      caseId: testCase.id,
      track: testCase.track,
      profileId: profile.id,
      profileName: profile.name,
      expectedTitle: testCase.expectedTitle,
      expectedAuthor: testCase.expectedAuthor,
      baselineRawTitle: testCase.baselineRawTitle,
      ocrText: text.trim(),
      confidence: Number(confidence) / 100,
      titleSimilarity: similarity(text, testCase.expectedTitle ?? ''),
      authorSimilarity: similarity(text, testCase.expectedAuthor ?? ''),
      image: testCase.image,
    });
  }

  await worker.terminate();
  return rows;
}

function buildReportMarkdown({
  benchmarkDate,
  caseCount,
  primaryCaseCount,
  threshold,
  baselineRate,
  summaries,
  best,
  lift,
  decision,
  rows,
}) {
  const lines = [];
  lines.push('# OCR benchmark report (2026-06)');
  lines.push('');
  lines.push(`Benchmark date: ${benchmarkDate}`);
  lines.push(`Cases evaluated: ${caseCount} (primary OCR-repair subset: ${primaryCaseCount})`);
  lines.push(`Success threshold (title similarity): ${threshold.toFixed(2)}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Baseline recall@top1 (existing raw_title): ${formatPct(baselineRate)}`);
  lines.push(`- Best OCR profile: ${best.profileId} (${best.profileName})`);
  lines.push(`- Best OCR recall@top1: ${formatPct(best.recallAtTop1)}`);
  lines.push(`- Lift vs baseline: ${(lift * 100).toFixed(1)} pp`);
  lines.push(`- Decision: **${decision}**`);
  lines.push('');
  lines.push('## Profile comparison');
  lines.push('');
  lines.push('| Profile | Recall@top1 | Avg confidence | Primary cases |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const summary of summaries) {
    lines.push(
      `| ${summary.profileId} | ${formatPct(summary.recallAtTop1)} | ${formatPct(summary.avgConfidence)} | ${summary.primaryCases} |`
    );
  }
  lines.push('');
  lines.push('## Per-case results (best profile)');
  lines.push('');
  lines.push('| Case | Track | Similarity | OCR text (trimmed) |');
  lines.push('| --- | --- | ---: | --- |');

  const bestRows = rows.filter((r) => r.profileId === best.profileId);
  for (const row of bestRows) {
    const text = row.ocrText.replace(/\|/g, '\\|').slice(0, 90);
    lines.push(
      `| ${row.caseId} | ${row.track} | ${formatPct(row.titleSimilarity)} | ${text || '(empty)'} |`
    );
  }
  lines.push('');
  lines.push('## Recommendation');
  lines.push('');
  lines.push(
    decision === 'go'
      ? '- GO for OCR-first on clean-single-spine crops, keep LLM refine as fallback.'
      : '- NO-GO for OCR-first at this stage. Keep manual LLM refine as primary fallback and revisit after localization improvements and broader OCR evaluation.'
  );

  return `${lines.join('\n')}\n`;
}

async function main() {
  const manifestRaw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const cases = manifest.cases ?? [];

  if (cases.length === 0) {
    throw new Error('Benchmark manifest has no cases.');
  }

  const threshold = 0.75;
  const allRows = [];

  for (const profile of PROFILES) {
    const rows = await runProfile(profile, cases);
    allRows.push(...rows);
  }

  const summaries = PROFILES.map((profile) => {
    const summary = profileSummary(profile.id, allRows, threshold);
    return { ...summary, profileName: profile.name };
  });

  const best = pickBestProfile(summaries);
  const baselineRate = baselineSuccessRate(cases, threshold);
  const lift = best.recallAtTop1 - baselineRate;

  const decision = lift >= 0.1 ? 'go' : 'no-go';
  const now = new Date().toISOString();

  const jsonOut = {
    generatedAt: now,
    manifestPath: path.relative(ROOT, MANIFEST_PATH).replaceAll('\\\\', '/'),
    threshold,
    baselineRecallAtTop1: baselineRate,
    bestProfile: best,
    liftPp: lift * 100,
    decision,
    summaries,
    rows: allRows,
  };

  await fs.writeFile(RESULTS_JSON_PATH, `${JSON.stringify(jsonOut, null, 2)}\n`, 'utf8');

  const report = buildReportMarkdown({
    benchmarkDate: now,
    caseCount: cases.length,
    primaryCaseCount: cases.filter((c) => c.track === 'ocr_repair').length,
    threshold,
    baselineRate,
    summaries,
    best,
    lift,
    decision,
    rows: allRows,
  });
  await fs.writeFile(REPORT_MD_PATH, report, 'utf8');

  console.log('OCR benchmark finished.');
  console.log(`- Results JSON: ${path.relative(ROOT, RESULTS_JSON_PATH).replaceAll('\\\\', '/')}`);
  console.log(`- Report MD: ${path.relative(ROOT, REPORT_MD_PATH).replaceAll('\\\\', '/')}`);
  console.log(`- Decision: ${decision}`);
}

main().catch((error) => {
  console.error('OCR benchmark failed:', error);
  process.exitCode = 1;
});