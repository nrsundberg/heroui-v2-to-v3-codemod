'use strict';

const { recordWarning } = require('./utils');

// Rewrite call sites of removed v2 named exports.
//
// Today this only handles `getKeyValue(row, key)` -> `(row as any)[key as string]`.
// The matching import is dropped by lib/imports.js (REMOVED_NAMED_EXPORTS),
// but the call sites would otherwise remain and produce TS2304 errors.
//
// We only rewrite calls whose callee identifier resolves to a v2 HeroUI
// binding (via importInfo.bindings). User-defined `getKeyValue` functions
// from elsewhere are left alone.
function rewriteCallSites(j, root, ctx, importInfo) {
  const { bindings } = importInfo;

  root.find(j.CallExpression).forEach((path) => {
    const callee = path.node.callee;
    if (!callee || callee.type !== 'Identifier') return;
    if (callee.name !== 'getKeyValue') return;

    const binding = bindings.get('getKeyValue');
    if (!binding || binding.isV3) return;

    const args = path.node.arguments || [];
    const line = path.node.loc && path.node.loc.start && path.node.loc.start.line;

    if (args.length !== 2) {
      recordWarning(
        ctx,
        ctx.filePath,
        line,
        'getkeyvalue-arity',
        `getKeyValue() expected 2 arguments, found ${args.length}; left as-is. Replace manually with (row as any)[key as string].`
      );
      return;
    }

    // Build (row as any)[key as string] using a string-prefix replacement.
    // jscodeshift's tsAsExpression node prints without parentheses inside a
    // MemberExpression.object, which produces invalid TS (`row as any[...]`).
    // Going through j.template.expression with the source text of each arg
    // keeps original formatting (identifiers, member expressions, etc.) and
    // sidesteps the printing issue.
    const rowSrc = j(path.get('arguments', 0)).toSource();
    const keySrc = j(path.get('arguments', 1)).toSource();
    const replacement = j.template.expression(
      [`(${rowSrc} as any)[${keySrc} as string]`]
    );

    j(path).replaceWith(replacement);
    ctx.dirty = true;
  });
}

module.exports = { rewriteCallSites };
