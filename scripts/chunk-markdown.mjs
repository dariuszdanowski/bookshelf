import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HEADING_RE = /^(#{2,3})\s+(.*)/;
const H1_RE = /^#\s+(.*)/;

export function chunkMarkdownFile(filePath, sourceText) {
  const lines = sourceText.split('\n');
  const chunks = [];
  let current = { name: null, startLine: 1, lines: [] };

  const flush = (endLine) => {
    const text = current.lines.join('\n').trim();
    if (!text) return;
    let name = current.name;
    if (!name) {
      const h1Line = current.lines.find((l) => H1_RE.test(l));
      name = h1Line ? h1Line.match(H1_RE)[1].trim() : path.basename(filePath);
    }
    chunks.push({
      file: filePath,
      name,
      kind: 'section',
      startLine: current.startLine,
      endLine,
      text,
    });
  };

  lines.forEach((line, idx) => {
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flush(idx);
      current = { name: headingMatch[2].trim(), startLine: idx + 1, lines: [line] };
    } else {
      current.lines.push(line);
    }
  });
  flush(lines.length);

  return chunks;
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const target = process.argv[2];
  if (!target) {
    console.error('Użycie: node scripts/chunk-markdown.mjs <plik.md>');
    process.exit(1);
  }
  const sourceText = fs.readFileSync(target, 'utf8');
  const chunks = chunkMarkdownFile(target, sourceText);
  console.log(`Plik: ${target}`);
  console.log(`Chunków: ${chunks.length}\n`);
  chunks.forEach((c) => {
    console.log(
      `[${c.kind}] ${c.name}  (linie ${c.startLine}-${c.endLine}, ${c.text.length} znaków)`,
    );
  });
}
