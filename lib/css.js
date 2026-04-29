'use strict';

// Raw CSS / SCSS file rewriter.
//
// The JS/TS codemod doesn't see token references that live in plain stylesheets
// (`@apply bg-primary`, `var(--primary)`, `:root { --primary: hsl(...) }`,
// `@import "@heroui/theme"`). This module sweeps every *.css / *.scss file
// in the project tree and applies a small set of mechanical rewrites.
//
// Returns:
//   { changed, warnings: [{line, ruleId, message}], counts: {vars, classes} }
//
// Color-space conversions (HSL -> OKLCH) are flagged but not auto-rewritten:
// they require palette knowledge we don't have here.

const fs = require('fs');
const {
  CLASSNAME_TOKEN_REWRITES,
  CSS_VAR_REWRITES,
  CSS_VAR_FLAGGED,
} = require('./mappings');

// Compute the 1-based line number of an offset by counting newlines before it.
function lineOf(src, idx) {
  if (idx < 0 || idx > src.length) return null;
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (src.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

// Rewrite all matches of `re` in `src` using `to`. Counts replacements.
function applyRegexRewrite(src, re, to) {
  let count = 0;
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const r = new RegExp(re.source, flags);
  const out = src.replace(r, () => {
    count++;
    return to;
  });
  return { src: out, count };
}

// Walk every match of a regex (without mutating) and yield {match, index}.
function* iterMatches(src, re) {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const r = new RegExp(re.source, flags);
  let m;
  while ((m = r.exec(src)) !== null) {
    yield { match: m[0], index: m.index };
    if (m.index === r.lastIndex) r.lastIndex++;
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Find HSL color values that appear as the value of one of our renamed
// CSS variables inside a `:root { ... }` block. We don't try to be fancy about
// nested at-rules — the heuristic is: scan inside any `:root { ... }` block
// for `<--var-name>: hsl(...)`. Emits one warning per occurrence.
function findHslWarnings(src, varNames) {
  const warnings = [];
  const rootRe = /:root\s*\{([^}]*)\}/g;
  let rootMatch;
  while ((rootMatch = rootRe.exec(src)) !== null) {
    const body = rootMatch[1];
    const bodyStart = rootMatch.index + rootMatch[0].indexOf('{') + 1;
    for (const name of varNames) {
      const re = new RegExp(
        '(' + escapeRegex(name) + ')\\s*:\\s*(hsla?\\([^)]*\\))',
        'g'
      );
      let m;
      while ((m = re.exec(body)) !== null) {
        const absIndex = bodyStart + m.index;
        warnings.push({
          line: lineOf(src, absIndex),
          ruleId: 'css-var-hsl',
          message:
            'HSL color value detected for ' + name +
            '. v3 ships an OKLCH palette; consider converting (e.g. via culori or oklch.com) for consistent color-mix behavior.',
        });
      }
    }
  }
  return warnings;
}

function rewriteCssFile(filePath, opts) {
  const apply = !opts || opts.apply !== false;
  const original = fs.readFileSync(filePath, 'utf8');
  let src = original;
  const warnings = [];
  let varCount = 0;
  let classCount = 0;

  // 1. @import "@heroui/theme" -> @import "@heroui/styles"
  const importRe = /@import\s+(["'])@heroui\/theme\1/g;
  let importChanges = 0;
  src = src.replace(importRe, (_full, q) => {
    importChanges++;
    return '@import ' + q + '@heroui/styles' + q;
  });
  if (importChanges > 0) varCount += importChanges;

  // Dedupe consecutive identical `@import "@heroui/styles"` lines that may
  // arise when an earlier inspectGlobalCss pass already inserted one.
  src = src.replace(
    /(@import\s+(["'])@heroui\/styles\2;?\s*\n)(?=@import\s+(["'])@heroui\/styles\3;?\s*\n)/g,
    ''
  );

  // 2. CSS variable rewrites — collect line warnings BEFORE rewriting.
  for (const rule of CSS_VAR_REWRITES) {
    for (const m of iterMatches(src, rule.from)) {
      warnings.push({
        line: lineOf(src, m.index),
        ruleId: rule.ruleId,
        message: 'Renamed ' + m.match + ' -> ' + rule.to + '.',
      });
    }
    const r = applyRegexRewrite(src, rule.from, rule.to);
    src = r.src;
    varCount += r.count;
  }

  // 3. Flagged CSS variables (no auto-rewrite).
  for (const rule of CSS_VAR_FLAGGED) {
    for (const m of iterMatches(src, rule.from)) {
      warnings.push({
        line: lineOf(src, m.index),
        ruleId: rule.ruleId,
        message: m.match + ': ' + rule.message,
      });
    }
  }

  // 4. Class-name token rewrites (re-uses the JSX className rewrite list).
  for (const rule of CLASSNAME_TOKEN_REWRITES) {
    const r = applyRegexRewrite(src, rule.from, rule.to);
    src = r.src;
    classCount += r.count;
  }

  // 5. HSL detection — run against the REWRITTEN source so we report the
  //    new variable names (--accent, --separator, ...) the user will see.
  const renamedVars = CSS_VAR_REWRITES.map((r) => r.to);
  const allVars = Array.from(new Set(renamedVars));
  const hsl = findHslWarnings(src, allVars);
  for (const w of hsl) warnings.push(w);

  const changed = src !== original;
  if (changed && apply) {
    fs.writeFileSync(filePath, src, 'utf8');
  }

  return {
    changed,
    warnings,
    counts: { vars: varCount, classes: classCount },
  };
}

module.exports = { rewriteCssFile };
