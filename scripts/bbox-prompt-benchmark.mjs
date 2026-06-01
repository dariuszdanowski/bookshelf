/**
 * Benchmark porównujący 3 warianty promptu pod kątem jakości bbox.
 * Uruchom: node scripts/bbox-prompt-benchmark.mjs
 * Wymaga: ANTHROPIC_API_KEY w .dev.vars lub env
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// --- Load API key from .dev.vars or environment ---
function loadApiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return key;
  try {
    const devVars = readFileSync(resolve(root, '.dev.vars'), 'utf-8');
    for (const line of devVars.split('\n')) {
      const m = line.match(/^ANTHROPIC_API_KEY\s*=\s*(.+)$/);
      if (m) return m[1].trim();
    }
  } catch {}
  throw new Error('Brak ANTHROPIC_API_KEY w env ani .dev.vars');
}

const SPINE_COLORS =
  'czerwony, pomarańczowy, żółty, zielony, niebieski, granatowy, fioletowy, różowy, brązowy, czarny, biały, szary';

// ─── WARIANT 1: v1 (oryginał sprzed v2, bez bbox) ──────────────────────────
const PROMPT_V1 = `Jesteś vision-asystentem do katalogowania książek. Otrzymujesz zdjęcie półki widzianej od grzbietów. Wymień każdą widoczną książkę od lewej do prawej.

Dla każdej książki zwróć JSON object:
- position: int (1 = pierwsza od lewej)
- title: string (tytuł na grzbiecie; dokładnie to co widzisz, bez poprawiania pisowni)
- author: string | null (autor jeśli widoczny na grzbiecie, null jeśli niewidoczny)
- confidence: float 0–1 (pewność odczytu; < 0.7 gdy tekst zasłonięty lub niewyraźny)
- spine_color: string | null (dominujący kolor grzbietu z listy: ${SPINE_COLORS}; null jeśli nie pasuje żaden)

Reguły:
- NIE zgaduj tytułu — pusta lista lepsza niż halucynacja
- Tekst częściowo zasłonięty → zwróć z confidence < 0.7
- Tytuły i autorów polskich zostaw po polsku
- Zwróć TYLKO JSON array, bez żadnego tekstu przed ani po
- Jeśli nie ma książek lub nic nie widać → zwróć []

Format: [{"position":1,"title":"...","author":"...","confidence":0.95,"spine_color":"niebieski"}, ...]`;

// ─── WARIANT 2: v2 (aktualny, zbyt restrykcyjny — do wycofania) ─────────────
const PROMPT_V2_CURRENT = `Jesteś vision-asystentem do katalogowania książek. Otrzymujesz zdjęcie półki widzianej od grzbietów. Wymień tylko te książki, których grzbiet i tytuł są rzeczywiście czytelne; jeśli masz wątpliwości, pomiń książkę.

Dla każdej książki zwróć JSON object:
- position: int (1 = pierwsza od lewej)
- title: string (tytuł na grzbiecie; dokładnie to co widzisz, bez poprawiania pisowni)
- author: string | null (autor jeśli widoczny na grzbiecie, null jeśli niewidoczny)
- confidence: float 0–1 (pewność odczytu; < 0.7 gdy tekst zasłonięty lub niewyraźny)
- spine_color: string | null (dominujący kolor grzbietu z listy: ${SPINE_COLORS}; null jeśli nie pasuje żaden)
- bbox: [x1, y1, x2, y2] (opcjonalne; znormalizowane 0..1, top-left origin, względem całego obrazu; pomiń jeśli niepewny lokalizacji)

Reguły:
- NIE zgaduj — pusta lista lepsza niż halucynacja
- Jeśli tytuł jest częściowo zasłonięty lub rozmazany, pomiń książkę zamiast zwracać niskiej jakości guess
- Jeśli nie możesz odczytać co najmniej 70% tytułu, pomiń książkę całkowicie
- Tekst częściowo zasłonięty lub niepewny → zwróć confidence <= 0.65
- Tytuły i autorów polskich zostaw po polsku
- bbox musi obejmować TEN SAM obiekt, z którego czytasz title/author
- nie zwracaj bbox dla ściany, cienia, krawędzi półki, przerw między książkami
- Preferuj mniej wyników o wysokiej jakości zamiast wielu słabych
- Zwróć TYLKO JSON array, bez żadnego tekstu przed ani po
- Jeśli nie ma książek lub nic nie widać → zwróć []

Format: [{"position":1,"title":"...","author":"...","confidence":0.95,"spine_color":"niebieski","bbox":[0.1,0.05,0.2,0.95]}, ...]`;

// ─── WARIANT 3: v3 — v1 recall + proceduralne bbox ──────────────────────────
const PROMPT_V3_BBOX_PROCEDURAL = `Jesteś vision-asystentem do katalogowania książek. Otrzymujesz zdjęcie półki widzianej od grzbietów. Wymień każdą widoczną książkę od lewej do prawej.

Dla każdej książki zwróć JSON object:
- position: int (1 = pierwsza od lewej)
- title: string (tytuł na grzbiecie; dokładnie to co widzisz, bez poprawiania pisowni)
- author: string | null
- confidence: float 0–1 (< 0.7 gdy tekst zasłonięty lub niewyraźny)
- spine_color: string | null (z listy: ${SPINE_COLORS}; null jeśli nie pasuje żaden)
- bbox: [x1, y1, x2, y2] albo null — instrukcja poniżej

Reguły odczytu:
- NIE zgaduj tytułu — pusta lista lepsza niż halucynacja
- Tekst częściowo zasłonięty → zwróć z confidence < 0.7 (nie pomijaj)
- Tytuły i autorów polskich zostaw po polsku
- Zwróć TYLKO JSON array, bez żadnego tekstu przed ani po

Instrukcja bbox (ważna — czytaj uważnie):

Współrzędne ZAWSZE względem PEŁNEGO obrazu:
  - [0.0, 0.0] = lewy-górny narożnik zdjęcia
  - [1.0, 1.0] = prawy-dolny narożnik zdjęcia

bbox musi obejmować CAŁY GRZBIET tej książki (nie tylko tekst; pełną szerokość między sąsiednimi grzbietami).

Procedura dla każdej książki:
1. Gdzie jest lewa fizyczna krawędź grzbietu tej książki (granica z lewym sąsiadem lub krawędzią półki)? → x1
2. Gdzie jest prawa fizyczna krawędź grzbietu (granica z prawym sąsiadem)? → x2
3. Gdzie zaczyna się grzbiet od góry (górna krawędź półki/oprawy)? → y1
4. Gdzie kończy się grzbiet od dołu (dolna krawędź)? → y2

Wskazówki do szerokości:
- Każda książka zajmuje min 1.5% szerokości pełnego obrazu (x2-x1 >= 0.015).
- Cienkie paperbacki: 1.5–3%, grube tomy/albumy: 3–8%, słowniki/encyklopedie: 5–12%.
- Suma szerokości wszystkich grzbietów ≈ szerokość całej sekcji półki z książkami na obrazie.

Pomiń bbox (ustaw null) tylko gdy naprawdę nie wiesz gdzie jest ta książka na zdjęciu.

Format: [{"position":1,"title":"...","author":"...","confidence":0.95,"spine_color":"niebieski","bbox":[0.12,0.15,0.18,0.95]}, ...]`;

// ─── Pomocnicze ─────────────────────────────────────────────────────────────

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return Buffer.from(bytes).toString('base64');
}

function stripCodeFences(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

function calcCost(usage) {
  return (usage.input_tokens / 1_000_000) * 3 + (usage.output_tokens / 1_000_000) * 15;
}

async function runVariant(client, imageB64, mediaType, systemPrompt, label) {
  const start = Date.now();
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
          { type: 'text', text: 'Wymień książki na zdjęciu.' },
        ],
      },
    ],
  });
  const latency = Date.now() - start;
  const cost = calcCost(resp.usage);
  let detections = [];
  try {
    detections = JSON.parse(stripCodeFences(resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('')));
  } catch (e) {
    console.error(`  [${label}] JSON parse error:`, e.message);
  }
  return { label, detections, latency, cost, tokens: resp.usage };
}

function analyzeBboxes(detections) {
  const withBbox = detections.filter((d) => d.bbox && Array.isArray(d.bbox) && d.bbox.length === 4);
  const withoutBbox = detections.filter((d) => !d.bbox);

  const widths = withBbox.map((d) => d.bbox[2] - d.bbox[0]);
  const tooNarrow = widths.filter((w) => w < 0.015).length;
  const avgWidth = widths.length > 0 ? widths.reduce((a, b) => a + b, 0) / widths.length : 0;
  const minWidth = widths.length > 0 ? Math.min(...widths) : 0;
  const maxWidth = widths.length > 0 ? Math.max(...widths) : 0;

  return { withBbox: withBbox.length, withoutBbox: withoutBbox.length, tooNarrow, avgWidth, minWidth, maxWidth };
}

function printResult(result) {
  const { label, detections, latency, cost } = result;
  const count = detections.length;
  const bbox = analyzeBboxes(detections);

  console.log(`\n  ┌─ [${label}]`);
  console.log(`  │  Detekcji: ${count}  |  latency: ${latency}ms  |  koszt: $${cost.toFixed(5)}`);
  console.log(`  │  bbox: ${bbox.withBbox}/${count} mają | ${bbox.tooNarrow} za wąskich (<1.5%) | avg_width=${bbox.avgWidth.toFixed(3)} min=${bbox.minWidth.toFixed(3)} max=${bbox.maxWidth.toFixed(3)}`);

  if (detections.length > 0) {
    console.log(`  │  Pierwsze 5 detekcji:`);
    for (const d of detections.slice(0, 5)) {
      const bboxStr = d.bbox ? `[${d.bbox.map((v) => v.toFixed(3)).join(',')}] w=${(d.bbox[2]-d.bbox[0]).toFixed(3)}` : '(brak)';
      console.log(`  │    p${d.position}: "${d.title}" conf=${d.confidence?.toFixed(2)} bbox=${bboxStr}`);
    }
    if (detections.length > 5) {
      console.log(`  │    ... i ${detections.length - 5} więcej`);
    }
  }
  console.log(`  └─`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = loadApiKey();
  const client = new Anthropic({ apiKey });

  const images = [
    { name: 'Shelf-A (komiksy/albumy)', path: 'docs/image-analysis/research-cases/9a154e01-7e6e-4c39-8018-1bf084273386.jpg' },
    { name: 'Shelf-B (powieści)', path: 'docs/image-analysis/research-cases/ca035e1e-a58d-42ff-86be-66eb521853e1.jpg' },
  ];

  const variants = [
    { label: 'v1-baseline (bez bbox)', prompt: PROMPT_V1 },
    { label: 'v2-current (restrykcyjny)', prompt: PROMPT_V2_CURRENT },
    { label: 'v3-bbox-procedural (kandydat)', prompt: PROMPT_V3_BBOX_PROCEDURAL },
  ];

  const summary = [];

  for (const img of images) {
    const imgPath = resolve(root, img.path);
    const imgBuffer = readFileSync(imgPath);
    const imgB64 = Buffer.from(imgBuffer).toString('base64');
    const mediaType = 'image/jpeg';

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📷 ${img.name} — ${img.path}`);
    console.log(`${'═'.repeat(70)}`);

    for (const v of variants) {
      try {
        const result = await runVariant(client, imgB64, mediaType, v.prompt, v.label);
        printResult(result);
        summary.push({ image: img.name, ...result, bboxStats: analyzeBboxes(result.detections) });
      } catch (e) {
        console.error(`  [${v.label}] BŁĄD:`, e.message);
      }
      // Throttle between calls
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('PODSUMOWANIE');
  console.log(`${'═'.repeat(70)}`);
  let totalCost = 0;
  for (const r of summary) {
    const b = r.bboxStats;
    console.log(`${r.image} | ${r.label}: count=${r.detections.length} bbox=${b.withBbox} tooNarrow=${b.tooNarrow} avgW=${b.avgWidth.toFixed(3)} cost=$${r.cost.toFixed(5)}`);
    totalCost += r.cost;
  }
  console.log(`\nŁączny koszt benchmarku: $${totalCost.toFixed(5)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
