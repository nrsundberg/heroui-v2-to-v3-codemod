'use strict';

const { HOOK_RENAMES, REMOVED_HOOKS } = require('./mappings');
const { attachLeadingComment, recordWarning } = require('./utils');

// Walk every CallExpression. If the callee identifier resolves to a HeroUI
// v2 hook binding, either rename (useDisclosure -> useOverlayState) or warn.
//
// We rewrite the callee identifier in-place and let finalizeImports rewrite
// the matching ImportSpecifier afterward. For user-aliased hooks
// (`import { useDisclosure as useDisc }`) we leave the call site alone and
// emit a warning — too risky to rename a user-chosen alias.
function rewriteHookUsages(j, root, ctx, importInfo) {
  const { bindings } = importInfo;

  root.find(j.CallExpression).forEach((path) => {
    const callee = path.node.callee;
    if (!callee || callee.type !== 'Identifier') return;
    const localName = callee.name;
    const binding = bindings.get(localName);
    if (!binding || binding.isV3) return;

    const v2Name = binding.v2Canonical;

    if (HOOK_RENAMES[v2Name]) {
      const newName = HOOK_RENAMES[v2Name];
      // Only rename the call site if the user didn't alias the import.
      if (localName === v2Name) {
        path.node.callee = j.identifier(newName);
        ctx.dirty = true;
      } else {
        recordWarning(
          ctx,
          ctx.filePath,
          path.node.loc && path.node.loc.start && path.node.loc.start.line,
          'aliased-hook-rename',
          `${v2Name} aliased as '${localName}' — codemod kept the alias; rename the callee or the alias to ${newName} manually.`
        );
      }
      const stmt = enclosingStatement(path);
      if (stmt) {
        attachLeadingComment(
          stmt,
          `${v2Name}() -> ${newName}(): API CHANGED. v2 returned {isOpen, onOpen, onClose, onOpenChange}; v3 returns a single state object with .isOpen, .open(), .close(), .toggle(), .setOpen(boolean). Update destructuring AND pass state={state} to <Modal>/<Drawer>. See https://heroui.com/docs/react/migration/hooks`
        );
        recordWarning(
          ctx,
          ctx.filePath,
          path.node.loc && path.node.loc.start && path.node.loc.start.line,
          'hook-api-changed',
          `${v2Name} -> ${newName} API change`
        );
      }
      return;
    }

    if (REMOVED_HOOKS[v2Name]) {
      const stmt = enclosingStatement(path);
      if (stmt) {
        attachLeadingComment(
          stmt,
          `${v2Name}() is REMOVED in v3. ${REMOVED_HOOKS[v2Name]} See https://heroui.com/docs/react/migration/hooks`
        );
        recordWarning(
          ctx,
          ctx.filePath,
          path.node.loc && path.node.loc.start && path.node.loc.start.line,
          'removed-hook',
          `${v2Name} removed: ${REMOVED_HOOKS[v2Name]}`
        );
      }
    }
  });
}

function enclosingStatement(path) {
  let p = path;
  while (p && p.node) {
    const t = p.node.type;
    if (
      t === 'VariableDeclaration' ||
      t === 'ExpressionStatement' ||
      t === 'ReturnStatement' ||
      t === 'IfStatement' ||
      t === 'ForStatement' ||
      t === 'FunctionDeclaration' ||
      t === 'ImportDeclaration'
    ) {
      return p.node;
    }
    p = p.parent;
  }
  return null;
}

module.exports = { rewriteHookUsages };
