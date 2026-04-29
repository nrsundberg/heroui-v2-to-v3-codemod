#!/usr/bin/env node
'use strict';

// Companion test runner for raw CSS/SCSS rewriting. Copies every
// __testfixtures__/css/*.input.css into .tmp-fixture-css-out/, then runs the
// CLI against that directory with --no-tailwind --no-package --no-report.
// The CLI's own CSS step picks up *.css under cwd, so we run with cwd set to
// the temp dir to keep the surface contained.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIX_DIR = path.join(ROOT, '__testfixtures__', 'css');
const TMP = path.join(ROOT, '.tmp-fixture-css-out');

function clean() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
}

function copyFixtures() {
  if (!fs.existsSync(FIX_DIR)) {
    console.log(`(no css fixtures at ${path.relative(ROOT, FIX_DIR)})`);
    return [];
  }
  const out = [];
  for (const f of fs.readdirSync(FIX_DIR)) {
    if (!f.endsWith('.input.css') && !f.endsWith('.input.scss')) continue;
    fs.copyFileSync(path.join(FIX_DIR, f), path.join(TMP, f));
    out.push(f);
  }
  return out;
}

function run() {
  clean();
  const fixtures = copyFixtures();
  if (fixtures.length === 0) {
    console.log('No CSS fixtures to run.');
    process.exit(0);
  }

  const cli = path.join(ROOT, 'bin', 'cli.js');
  // We pass TMP as the JS path target. The CLI requires at least one path;
  // jscodeshift will find no matching JS files and exit cleanly. The CSS
  // step iterates files under process.cwd(), which we set to TMP so only
  // our fixtures are affected.
  const proc = spawnSync(
    process.execPath,
    [cli, '.', '--no-tailwind', '--no-package', '--no-report'],
    {
      cwd: TMP,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  process.stdout.write(proc.stdout || '');
  const stderr = (proc.stderr || '').toString();
  if (stderr.trim()) {
    process.stderr.write(stderr);
  }

  console.log('\n================ CSS FIXTURE OUTPUTS ================\n');
  for (const f of fixtures) {
    const out = fs.readFileSync(path.join(TMP, f), 'utf8');
    console.log(`--- ${f} (after) ---`);
    console.log(out);
  }

  // Don't fail the build on jscodeshift's no-matching-files exit (>=0 is fine
  // since jscodeshift returns 0 for "no matches"). We only care about the CSS
  // pipeline's success here.
  process.exit(proc.status || 0);
}

run();
