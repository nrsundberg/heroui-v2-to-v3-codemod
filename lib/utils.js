'use strict';

// Shared utilities used across transforms.

// Get the JSXOpeningElement.name as a "canonical" string suitable for
// looking up in our mapping tables. Returns the dotted path for member
// expressions (e.g. "Card.Header") and the identifier name otherwise.
function jsxName(jsxName) {
  if (!jsxName) return null;
  if (jsxName.type === 'JSXIdentifier') return jsxName.name;
  if (jsxName.type === 'JSXMemberExpression') {
    return jsxName(jsxName.object) + '.' + jsxName.property.name;
  }
  return null;
}

// Recursive form (the parameter shadowing was bad).
function jsxNameOf(node) {
  if (!node) return null;
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') {
    return jsxNameOf(node.object) + '.' + node.property.name;
  }
  return null;
}

// Given a "Card.Header" string and the jscodeshift API, build the
// JSXMemberExpression node for use as openingElement/closingElement name.
function buildJSXMember(j, dotted) {
  const parts = dotted.split('.');
  if (parts.length === 1) return j.jsxIdentifier(parts[0]);
  let acc = j.jsxIdentifier(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    acc = j.jsxMemberExpression(acc, j.jsxIdentifier(parts[i]));
  }
  return acc;
}

// Insert a leading JSX comment ({/* ... */}) before a JSX node.
// jscodeshift represents JSX comments as JSXExpressionContainer wrapping a
// JSXEmptyExpression with attached comments.
function makeJSXComment(j, text) {
  const empty = j.jsxEmptyExpression();
  empty.comments = [j.commentBlock(' ' + text + ' ', false, true)];
  return j.jsxExpressionContainer(empty);
}

// Insert a /* HEROUI-MIGRATE: ... */ comment as a leading comment on a
// statement node (top-level use case: imports, hook calls, etc.).
function attachLeadingComment(node, text) {
  node.comments = node.comments || [];
  node.comments.push({
    type: 'CommentBlock',
    value: ' HEROUI-MIGRATE: ' + text + ' ',
    leading: true,
    trailing: false,
  });
}

// Best-effort: insert a JSX comment as the previous sibling of a JSX element.
// Works for elements that live inside a parent JSXElement or JSXFragment.
function insertJSXCommentBefore(j, path, text) {
  const parent = path.parent && path.parent.node;
  if (!parent) return false;
  if (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment') {
    // Inline JSX as a child of an expression — just attach a leading
    // comment to the openingElement instead.
    const node = path.node;
    if (node.openingElement) {
      node.openingElement.comments = node.openingElement.comments || [];
      node.openingElement.comments.push({
        type: 'CommentBlock',
        value: ' HEROUI-MIGRATE: ' + text + ' ',
        leading: true,
        trailing: false,
      });
    }
    return true;
  }
  const idx = parent.children.indexOf(path.node);
  if (idx < 0) return false;
  const comment = makeJSXComment(j, 'HEROUI-MIGRATE: ' + text);
  parent.children.splice(idx, 0, comment);
  return true;
}

// Track an emitted warning. The transform context object holds the report;
// CLI consumes it via the `report` callback.
function recordWarning(ctx, file, line, ruleId, message) {
  ctx.warnings = ctx.warnings || [];
  ctx.warnings.push({ file, line: line || null, ruleId, message });
}

module.exports = {
  jsxNameOf,
  buildJSXMember,
  makeJSXComment,
  attachLeadingComment,
  insertJSXCommentBefore,
  recordWarning,
};
