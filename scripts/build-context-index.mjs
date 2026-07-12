import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as lancedb from '@lancedb/lancedb';
import { chunkMarkdownFile } from './chunk-markdown.mjs';

const INDEX_DIR = '.agents/context-index';
const MANIFEST_FILE = path.join(INDEX_DIR, 'manifest.json');
const TABLE_NAME = 'chunks';
const MAX_CHUNK_CHARS = 6000;
const CHUNK_OVERLAP_CHARS = 300;

const SCAN_ROOT = 'context';
const EXCLUDE_DIR_NAMES = new Set(['node_modules']);

const onlyFilter = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1].replace(/\\/g, '/')
  : null;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
}

function discoverFiles() {
  if (!fs.existsSync(SCAN_ROOT)) return [];
  const files = [];
  walk(SCAN_ROOT, files);
  return onlyFilter ? files.filter((f) => f.startsWith(onlyFilter)) : files;
}

function hashContent(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function splitOversizedChunk(chunk) {
  if (chunk.text.length <= MAX_CHUNK_CHARS) return [chunk];
  const parts = [];
  let offset = 0;
  const totalLines = chunk.endLine - chunk.startLine + 1;
  const charsPerLine = chunk.text.length / totalLines;
  while (offset < chunk.text.length) {
    const end = Math.min(offset + MAX_CHUNK_CHARS, chunk.text.length);
    const partText = chunk.text.slice(offset, end);
    const startLine = chunk.startLine + Math.floor(offset / charsPerLine);
    const endLine = chunk.startLine + Math.floor(end / charsPerLine);
    parts.push({ ...chunk, text: partText, startLine, endLine });
    if (end === chunk.text.length) break;
    offset = end - CHUNK_OVERLAP_CHARS;
  }
  return parts;
}

async function embedText(text) {
  const url = `${process.env.EMBEDDING_URL}/embeddings`;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.EMBEDDING_API_KEY) {
    headers.Authorization = `Bearer ${process.env.EMBEDDING_API_KEY}`;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: process.env.EMBEDDING_MODEL, input: text }),
  });
  if (!response.ok) {
    throw new Error(`Embedding call failed (${response.status}): ${await response.text()}`);
  }
  const body = await response.json();
  return body.data[0].embedding;
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_FILE)) return { files: {} };
  return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
}

function saveManifest(manifest) {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

async function main() {
  if (!process.env.EMBEDDING_URL || !process.env.EMBEDDING_MODEL) {
    console.error('Brak EMBEDDING_URL/EMBEDDING_MODEL w .env — patrz .env.example.');
    process.exit(1);
  }

  fs.mkdirSync(INDEX_DIR, { recursive: true });
  const db = await lancedb.connect(INDEX_DIR);
  const tableExists = (await db.tableNames()).includes(TABLE_NAME);
  let table = tableExists ? await db.openTable(TABLE_NAME) : null;

  const manifest = loadManifest();
  const discovered = discoverFiles();
  const discoveredPaths = new Set(discovered);

  let indexed = 0;
  let skipped = 0;
  let removed = 0;
  const pendingRows = [];

  for (const file of discovered) {
    const sourceText = fs.readFileSync(file, 'utf8');
    const hash = hashContent(sourceText);
    const prior = manifest.files[file];

    if (prior && prior.hash === hash && tableExists) {
      skipped++;
      continue;
    }

    if (table) {
      await table.delete(`file = '${file.replace(/'/g, "''")}'`);
    }

    const rawChunks = chunkMarkdownFile(file, sourceText);
    const chunks = rawChunks.flatMap(splitOversizedChunk);

    const rowIds = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const id = `${file}#${chunk.startLine}-${chunk.endLine}#${i}`;
      const vector = await embedText(chunk.text);
      pendingRows.push({
        id,
        file,
        name: chunk.name,
        kind: chunk.kind,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        vector,
      });
      rowIds.push(id);
    }

    manifest.files[file] = { hash, rowIds };
    indexed++;
    console.log(`  [${indexed}] ${file} — ${chunks.length} chunk(ów)`);
  }

  for (const file of Object.keys(manifest.files)) {
    if (!discoveredPaths.has(file)) {
      if (table) await table.delete(`file = '${file.replace(/'/g, "''")}'`);
      delete manifest.files[file];
      removed++;
    }
  }

  if (pendingRows.length > 0) {
    if (!table) {
      table = await db.createTable(TABLE_NAME, pendingRows, { mode: 'overwrite' });
    } else {
      await table.add(pendingRows);
    }
  }

  saveManifest(manifest);

  console.log(
    `\nGotowe. Zaindeksowano: ${indexed}, bez zmian (pominięte): ${skipped}, usunięte: ${removed}.`,
  );
  console.log(`Wierszy w tabeli "${TABLE_NAME}": ${table ? await table.countRows() : 0}`);
}

main().catch((err) => {
  console.error('Błąd indeksowania:', err);
  process.exit(1);
});
