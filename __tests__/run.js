#!/usr/bin/env node
'use strict';

// Minimal test runner. For each fixture in __testfixtures__/, copy it to a
// temp dir, run the CLI in --dry mode, and print a colorized side-by-side
// summary. Exits non-zero if any fixture fails to transform at all.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIX_DIR = path.join(ROOT, '__testfixtures__');
const TMP = path.join(ROOT, '.tmp-fixture-out');

function clean() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
}

function copyFixtures() {
  for (const f of fs.readdirSync(FIX_DIR)) {
    if (!f.endsWith('.input.tsx')) continue;
    fs.copyFileSync(path.join(FIX_DIR, f), path.join(TMP, f));
  }
}

function run() {
  clean();
  copyFixtures();
  const cli = path.join(ROOT, 'bin', 'cli.js');
  const proc = spawnSync(process.execPath, [cli, TMP, '--no-tailwind', '--no-css-check'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stdout.write(proc.stdout || '');
  // Write transformed outputs side-by-side so the human can eyeball them.
  console.log('\n================ FIXTURE OUTPUTS ================\n');
  for (const f of fs.readdirSync(TMP)) {
    if (!f.endsWith('.input.tsx')) continue;
    const out = fs.readFileSync(path.join(TMP, f), 'utf8');
    console.log(`--- ${f} (after) ---`);
    console.log(out);
  }
  // Surface the worker stderr (filtered) so warnings are visible.
  const stderr = (proc.stderr || '').toString();
  const lines = stderr.split(/\r?\n/);
  const surfaceLines = lines.filter((l) => !l.startsWith('__HEROUI_MIGRATE__'));
  if (surfaceLines.some((l) => l.trim())) {
    console.error('\n--- jscodeshift stderr ---');
    console.error(surfaceLines.join('\n'));
  }
  // Print warnings summary
  const reportPath = path.join(ROOT, 'heroui-migrate-report.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log('\n--- Report summary ---');
    console.log(JSON.stringify(report.summary, null, 2));
    console.log('\nByRule:');
    console.log(JSON.stringify(report.byRule, null, 2));
  }
  // After JS fixtures, also run the CSS-fixture pass (if present).
  const cssRunner = path.join(__dirname, 'run-css.js');
  if (fs.existsSync(cssRunner)) {
    console.log('\n================ CSS FIXTURES ================\n');
    const cssProc = spawnSync(process.execPath, [cssRunner], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (cssProc.status && !proc.status) {
      process.exit(cssProc.status);
    }
  }
  process.exit(proc.status || 0);
}

run();
