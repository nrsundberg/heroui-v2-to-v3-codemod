'use strict';

// jscodeshift transform: HeroUI v2 -> v3.
//
// Usage (direct):
//   npx jscodeshift -t ./transform.js \
//     --extensions tsx,ts,jsx,js \
//     ./src/ui
//
// Usage (via this package's CLI):
//   npx heroui-v2-to-v3 ./src/ui
//
// The CLI is preferred because it also patches tailwind.config.{js,ts},
// emits a JSON report, and configures the parser per file.

const jscodeshift = require('jscodeshift');
const { parserForFile } = require('./lib/parse');
const { scanImports, finalizeImports } = require('./lib/imports');
const { rewriteJSXElements } = require('./lib/components');
const { rewriteJSXAttributes } = require('./lib/props');
const { rewriteHookUsages } = require('./lib/hooks');
const { DEFAULT_V3_ALIASES } = require('./lib/mappings');

function transformer(file, api, options) {
  // Per-file parser selection: 'tsx' parser is happy with .js/.jsx/.tsx but
  // chokes on some TS-only constructs. For .ts/.mts/.cts use the 'ts' parser.
  const parserName = parserForFile(file.path);
  const j = jscodeshift.withParser(parserName);
  const root = j(file.source);

  const ctx = {
    filePath: file.path,
    dirty: false,
    warnings: [],
  };

  const v3Aliases = options['v3-aliases']
    ? String(options['v3-aliases']).split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_V3_ALIASES;

  // Pass 1: rewrite import SOURCES only; build the bindings map keyed by
  //         the user's original local names. Don't touch specifier names yet.
  const importInfo = scanImports(j, root, ctx, { v3Aliases });

  // Pass 2: rewrite hook call sites, JSX attributes, then JSX elements.
  //         Attributes go BEFORE element renames so that <DropdownItem ...>
  //         is still in v2 form when we resolve `key`/`color`/`onValueChange`/
  //         per-component prop tables (which are keyed on v2 canonical names).
  rewriteHookUsages(j, root, ctx, importInfo);
  rewriteJSXAttributes(j, root, ctx, importInfo);
  rewriteJSXElements(j, root, ctx, importInfo);

  // Pass 3: rewrite import SPECIFIERS to match the v3 names produced above,
  //         drop unused/renamed specifiers, dedupe, and consolidate multiple
  //         @heroui/react imports.
  finalizeImports(j, root, ctx, importInfo);

  // Surface warnings via stderr — the CLI tail-collects them.
  if (ctx.warnings.length) {
    for (const w of ctx.warnings) {
      // eslint-disable-next-line no-console
      console.error(
        '__HEROUI_MIGRATE__ ' + JSON.stringify({ ...w, file: ctx.filePath })
      );
    }
  }

  if (!ctx.dirty) return null;
  return root.toSource({ quote: 'single', reuseWhitespace: true });
}

// We do per-file parser selection inside the transform via withParser, so
// the CLI's --parser flag is irrelevant. We deliberately do NOT export
// `module.exports.parser` (it would short-circuit our per-file logic).

module.exports = transformer;
module.exports.default = transformer; // ES interop for jscodeshift
