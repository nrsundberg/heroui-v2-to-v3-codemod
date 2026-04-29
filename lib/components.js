'use strict';

const {
  COMPONENT_RENAMES,
  SUBCOMPONENT_TO_DOT,
  UNWRAP_COMPONENTS,
  REMOVED_COMPONENTS,
  STRUCTURAL_FLAG_COMPONENTS,
} = require('./mappings');
const {
  jsxNameOf,
  buildJSXMember,
  insertJSXCommentBefore,
  recordWarning,
} = require('./utils');

// Mark a binding's local name for cleanup by finalizeImports. We piggyback
// on importInfo.unusedLocals so finalizeImports drops the specifier.
function markBindingUnused(importInfo, localRoot) {
  if (!importInfo.unusedLocals) importInfo.unusedLocals = new Set();
  importInfo.unusedLocals.add(localRoot);
}

// Rewrite JSXElements: rename top-level components, expand flat sub-components
// into dot-notation, flag removed components, flag structural-restructure cases.
//
// Skips elements whose opening identifier doesn't resolve to a v2 binding.
function rewriteJSXElements(j, root, ctx, importInfo) {
  const { bindings, removedImportLocals } = importInfo;

  root.find(j.JSXElement).forEach((path) => {
    const opening = path.node.openingElement;
    const closing = path.node.closingElement;
    const nameNode = opening.name;
    if (!nameNode) return;

    // Resolve the local binding root: for <Foo>, it's "Foo"; for
    // <NS.Foo>, it's "NS"; for <NS.Foo.Bar>, still "NS".
    let localRoot;
    if (nameNode.type === 'JSXIdentifier') {
      localRoot = nameNode.name;
    } else if (nameNode.type === 'JSXMemberExpression') {
      let obj = nameNode.object;
      while (obj.type === 'JSXMemberExpression') obj = obj.object;
      if (obj.type === 'JSXIdentifier') localRoot = obj.name;
    }
    if (!localRoot) return;

    const binding = bindings.get(localRoot);
    if (!binding) return; // not a HeroUI-imported component
    if (binding.isV3) return; // user explicitly imported from a v3 alias; leave alone

    // Compute the v2 canonical name for THIS element. For namespace imports
    // (<HUI.Card.Header/>), strip the namespace and use the rest.
    let canonicalName;
    if (nameNode.type === 'JSXIdentifier') {
      canonicalName = binding.v2Canonical === '*default*' || binding.v2Canonical === '*namespace*'
        ? null
        : binding.v2Canonical;
    } else {
      // Member expression — for namespace import, the path under the namespace
      // is the v2 canonical. For a plain import (binding is a single identifier),
      // user wrote <Foo.Bar/> meaning "Foo" was imported as v2 binding; the
      // canonical is just the imported name (e.g. they imported the v3-ish
      // <Card.Header> already which is fine — we leave it alone).
      if (binding.importKind !== 'namespace') return;
      canonicalName = jsxNameOf(nameNode).split('.').slice(1).join('.');
      if (!canonicalName) return;
    }
    if (!canonicalName) return;

    // 1a. UNWRAP components: <HeroUIProvider>X</HeroUIProvider> -> X.
    //     Replace the JSX element with its children list (or a Fragment if >1).
    if (UNWRAP_COMPONENTS[canonicalName]) {
      const msg = UNWRAP_COMPONENTS[canonicalName];
      const children = (path.node.children || []).filter((c) => c != null);
      // Drop the outermost newline-only JSXText so the parent's existing
      // indentation reads cleanly.
      let replacement;
      if (children.length === 0) {
        // No children — just delete the element if its parent allows it.
        const parent = path.parent && path.parent.node;
        if (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) {
          const idx = parent.children.indexOf(path.node);
          if (idx >= 0) parent.children.splice(idx, 1);
          ctx.dirty = true;
          markBindingUnused(importInfo, localRoot);
          recordWarning(
            ctx, ctx.filePath,
            opening.loc && opening.loc.start && opening.loc.start.line,
            'unwrapped-provider', msg
          );
          return;
        }
        // Otherwise leave a comment-only fragment.
        replacement = j.jsxFragment(j.jsxOpeningFragment(), j.jsxClosingFragment(), []);
      } else if (children.length === 1 && children[0].type === 'JSXElement') {
        replacement = children[0];
      } else {
        replacement = j.jsxFragment(j.jsxOpeningFragment(), j.jsxClosingFragment(), children);
      }
      const parent = path.parent && path.parent.node;
      if (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) {
        const idx = parent.children.indexOf(path.node);
        if (idx >= 0) parent.children.splice(idx, 1, replacement);
      } else {
        // Top-level / inside expression container — replace the path's value.
        path.replace(replacement);
      }
      markBindingUnused(importInfo, localRoot);
      ctx.dirty = true;
      recordWarning(
        ctx, ctx.filePath,
        opening.loc && opening.loc.start && opening.loc.start.line,
        'unwrapped-provider', msg
      );
      return;
    }

    // 1. Removed components — emit FIXME, do not transform.
    if (REMOVED_COMPONENTS[canonicalName]) {
      const msg = `<${canonicalName}> is removed in HeroUI v3. ${REMOVED_COMPONENTS[canonicalName]}`;
      insertJSXCommentBefore(j, path, msg);
      recordWarning(
        ctx,
        ctx.filePath,
        opening.loc && opening.loc.start && opening.loc.start.line,
        'removed-component-jsx',
        msg
      );
      ctx.dirty = true;
      return;
    }

    // 2. Structural restructure flags (warn but transform what we can).
    //    Emit BEFORE renaming so the comment refers to the v2 name the user
    //    will recognize.
    if (STRUCTURAL_FLAG_COMPONENTS[canonicalName]) {
      const msg = STRUCTURAL_FLAG_COMPONENTS[canonicalName];
      insertJSXCommentBefore(j, path, msg);
      recordWarning(
        ctx,
        ctx.filePath,
        opening.loc && opening.loc.start && opening.loc.start.line,
        'structural-flag',
        `<${canonicalName}>: ${msg}`
      );
      ctx.dirty = true;
      // Fall through — we still rename if applicable.
    }

    // 3. Top-level component rename (Divider->Separator, etc.)
    let newName = COMPONENT_RENAMES[canonicalName];

    // 4. Sub-component flat -> dot-notation. (Don't double-apply if both
    //    tables match somehow; SUBCOMPONENT_TO_DOT wins for Item/Section/etc.)
    if (SUBCOMPONENT_TO_DOT[canonicalName]) {
      newName = SUBCOMPONENT_TO_DOT[canonicalName];
    }

    if (!newName || newName === canonicalName) return;

    // For namespace-imported elements we need to keep the namespace prefix.
    if (nameNode.type === 'JSXMemberExpression' && binding.importKind === 'namespace') {
      newName = localRoot + '.' + newName;
    }

    opening.name = buildJSXMember(j, newName);
    if (closing) closing.name = buildJSXMember(j, newName);
    ctx.dirty = true;
  });
}

module.exports = { rewriteJSXElements };
