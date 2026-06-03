#!/usr/bin/env node
// PostToolUse hook (M3L3): po każdym Edit/Write na pliku TS/TSX/Astro/JS
// uruchamia ESLint --fix na TYM JEDNYM pliku i — jeśli zostają błędy —
// zwraca je agentowi jako additionalContext, żeby sam je naprawił w następnej
// iteracji zamiast zostawiać do CI. Zawsze advisory (exit 0), nigdy nie blokuje.
//
// .cjs bo package.json ma "type": "module" — hook musi być CommonJS.
//
// Kontrakt Claude Code:
//   - input: JSON na stdin, m.in. tool_input.file_path, cwd
//   - output: JSON na stdout { hookSpecificOutput: { hookEventName, additionalContext } }
//   - env: CLAUDE_PROJECT_DIR
// Dokumentacja: https://code.claude.com/docs/en/hooks.md

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const LINTABLE = new Set(['.ts', '.tsx', '.astro', '.js', '.mjs', '.cjs', '.jsx']);

function readStdin() {
  try {
    const fs = require('node:fs');
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function emit(context) {
  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: context,
        },
      })
    );
  }
  process.exit(0); // advisory — nigdy nie blokujemy
}

let input;
try {
  input = JSON.parse(readStdin() || '{}');
} catch {
  emit(''); // nie udało się sparsować — cicho wyjdź
}

const filePath = input?.tool_input?.file_path;
if (!filePath) emit('');

const ext = path.extname(filePath).toLowerCase();
if (!LINTABLE.has(ext)) emit(''); // .json/.md/.sql/.css itd. — pomiń

const projectDir = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();

// Rozwiąż binarkę ESLint bezpośrednio — uruchamiamy ją przez `node`, bez shella
// i bez npx (cmd.exe/npx.cmd bywają niedostępne w środowisku runnera hooków).
// `bin/eslint.js` nie jest w `exports` pakietu, więc require.resolve subpath pada —
// idziemy przez package.json (zwykle eksportowany) i składamy ścieżkę.
const fsx = require('node:fs');
let eslintBin;
try {
  const pkgJson = require.resolve('eslint/package.json', { paths: [projectDir] });
  eslintBin = path.join(path.dirname(pkgJson), 'bin', 'eslint.js');
} catch {
  eslintBin = path.join(projectDir, 'node_modules', 'eslint', 'bin', 'eslint.js');
}
if (!fsx.existsSync(eslintBin)) emit(''); // brak ESLint w projekcie — cicho wyjdź

let stdout = '';
try {
  // --fix: auto-naprawa fixowalnych reguł (import order, formatowanie itd.)
  // --format json: maszynowy odczyt pozostałych błędów
  stdout = execFileSync(
    process.execPath,
    [eslintBin, filePath, '--fix', '--format', 'json', '--no-error-on-unmatched-pattern', '--no-warn-ignored'],
    { cwd: projectDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
} catch (err) {
  // ESLint zwraca exit 1 gdy są błędy — JSON jest w stdout mimo throw
  stdout = err.stdout || '';
  if (!stdout) emit(`Hook lint: nie udało się uruchomić ESLint na ${path.basename(filePath)} (${err.message?.split('\n')[0] ?? 'unknown'}).`);
}

let results;
try {
  results = JSON.parse(stdout);
} catch {
  emit('');
}

const errors = results.flatMap((f) => f.messages.filter((m) => m.severity === 2));
const warnings = results.flatMap((f) => f.messages.filter((m) => m.severity === 1));

if (errors.length === 0 && warnings.length === 0) emit(''); // czysto (po --fix)

const base = path.basename(filePath);
const fmt = (m) => `  ${m.line}:${m.column}  ${m.ruleId ?? '(syntax)'}  ${m.message}`;
const parts = [`ESLint po edycji ${base}: ${errors.length} błąd(ów), ${warnings.length} ostrzeż. (po auto-fix). Napraw pozostałe:`];
if (errors.length) parts.push('Błędy:', ...errors.slice(0, 15).map(fmt));
if (warnings.length) parts.push('Ostrzeżenia:', ...warnings.slice(0, 10).map(fmt));

emit(parts.join('\n'));
