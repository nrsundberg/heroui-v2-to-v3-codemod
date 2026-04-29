'use strict';

const {
  COMPONENT_RENAMES,
  SUBCOMPONENT_TO_DOT,
  REMOVED_COMPONENTS,
  STRUCTURAL_FLAG_COMPONENTS,
} = require('./mappings');
const {
  jsxNameOf,
  buildJSXMember,
  insertJSXCommentBefore,
  recordWarning,
} = require('./utils');

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
