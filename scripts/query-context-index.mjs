import 'dotenv/config';
import * as lancedb from '@lancedb/lancedb';

const INDEX_DIR = '.agents/context-index';
const TABLE_NAME = 'chunks';
const DEFAULT_LIMIT = 8;

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

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('Użycie: node scripts/query-context-index.mjs "zapytanie" [--limit N]');
    process.exit(1);
  }
  const limitFlagIndex = process.argv.indexOf('--limit');
  const limit =
    limitFlagIndex !== -1 ? parseInt(process.argv[limitFlagIndex + 1], 10) : DEFAULT_LIMIT;

  if (!process.env.EMBEDDING_URL || !process.env.EMBEDDING_MODEL) {
    console.error('Brak EMBEDDING_URL/EMBEDDING_MODEL w .env — patrz .env.example.');
    process.exit(1);
  }

  const db = await lancedb.connect(INDEX_DIR);
  if (!(await db.tableNames()).includes(TABLE_NAME)) {
    console.error(
      `Brak indeksu w ${INDEX_DIR}. Najpierw uruchom: node scripts/build-context-index.mjs`,
    );
    process.exit(1);
  }
  const table = await db.openTable(TABLE_NAME);

  const vector = await embedText(query);
  const results = await table.search(vector).limit(limit).toArray();

  console.log(`Zapytanie: "${query}"\n`);
  results.forEach((r, i) => {
    const preview = r.text.replace(/\s+/g, ' ').trim().slice(0, 160);
    console.log(
      `${i + 1}. ${r.file}:${r.startLine}-${r.endLine}  (${r.name})  dystans=${r._distance.toFixed(4)}`,
    );
    console.log(`   ${preview}${preview.length === 160 ? '…' : ''}\n`);
  });
}

main().catch((err) => {
  console.error('Błąd zapytania:', err);
  process.exit(1);
});
