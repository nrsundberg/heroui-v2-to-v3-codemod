'use strict';

const { FUNCTION_RENAMES } = require('./mappings');
const { recordWarning } = require('./utils');

// Rewrite call sites of removed-or-renamed v2 named exports.
//
// 1. `getKeyValue(row, key)` -> `(row as any)[key as string]`. Import is
//    dropped by lib/imports.js (REMOVED_NAMED_EXPORTS); call sites would
//    otherwise leave a dangling reference.
//
// 2. FUNCTION_RENAMES (e.g. `addToast` -> `toast`). Import specifier is
//    rewritten by lib/imports.js. Here we rename every reference to the v2
//    local name in this file. We only rename when the local name matches
//    the imported name (no alias) — when aliased, the import becomes
//    `toast as foo` and `foo()` call sites already resolve to `toast`.
//
// All rewrites are gated on importInfo.bindings, so user-defined helpers
// with the same name from other modules are left alone.
function rewriteCallSites(j, root, ctx, importInfo) {
  const { bindings } = importInfo;

  // (1) getKeyValue
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

    const rowSrc = j(path.get('arguments', 0)).toSource();
    const keySrc = j(path.get('arguments', 1)).toSource();
    const replacement = j.template.expression(
      [`(${rowSrc} as any)[${keySrc} as string]`]
    );

    j(path).replaceWith(replacement);
    ctx.dirty = true;
  });

  // (2) FUNCTION_RENAMES — rename every Identifier reference whose name
  //     matches a v2 export AND whose binding traces to v2 HeroUI AND whose
  //     local name was NOT aliased by the user.
  for (const [v2Name, info] of Object.entries(FUNCTION_RENAMES)) {
    const binding = bindings.get(v2Name);
    if (!binding || binding.isV3) continue;
    // If the user aliased the import (`import { addToast as foo }`), the
    // local binding is `foo` not `addToast` — bindings.get('addToast') would
    // miss. The lookup hitting means localName === importedName.
    root.find(j.Identifier, { name: v2Name }).forEach((path) => {
      // Skip the ImportSpecifier itself — imports.js handles those.
      const parent = path.parent && path.parent.node;
      if (!parent) return;
      if (parent.type === 'ImportSpecifier') return;
      if (parent.type === 'ImportDefaultSpecifier') return;
      if (parent.type === 'ImportNamespaceSpecifier') return;
      // Skip property keys (`obj.addToast`, `{addToast: ...}`) — those are
      // not references to the imported binding.
      if (
        parent.type === 'MemberExpression' &&
        parent.property === path.node &&
        !parent.computed
      ) return;
      if (
        (parent.type === 'Property' || parent.type === 'ObjectProperty') &&
        parent.key === path.node &&
        !parent.computed
      ) return;
      path.node.name = info.to;
      ctx.dirty = true;
    });
  }
}

module.exports = { rewriteCallSites };
