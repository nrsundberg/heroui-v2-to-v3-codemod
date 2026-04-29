'use strict';

// Per-file parser selection, mirroring HeroUI's own codemod approach.
// .tsx / .jsx / .js -> 'tsx' parser (handles JSX in .js files too)
// .ts / .mts / .cts -> 'ts' parser (handles TS-only constructs that 'tsx' rejects)
// .d.ts             -> 'ts' parser
// Anything else     -> 'babel' (safe default)

const path = require('path');

function parserForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.tsx' || ext === '.jsx' || ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return 'tsx';
  }
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
    return 'ts';
  }
  return 'babel';
}

module.exports = { parserForFile };
