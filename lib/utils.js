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

// Collect every comment-like list on a node. Different parsers/printers
// (recast vs babel vs estree-style) attach comments as `comments`,
// `leadingComments`, or `innerComments`. Idempotency requires we look at
// all of them when checking for an existing tag.
function allComments(node) {
  if (!node) return [];
  return []
    .concat(node.comments || [])
    .concat(node.leadingComments || [])
    .concat(node.innerComments || []);
}

// Insert a /* HEROUI-MIGRATE: ... */ comment as a leading comment on a
// statement node (top-level use case: imports, hook calls, etc.). Skipped
// if a comment with the same text is already attached, so re-runs of the
// codemod don't accumulate duplicates.
function attachLeadingComment(node, text) {
  const fullText = 'HEROUI-MIGRATE: ' + text;
  if (allComments(node).some((c) => c && c.value && c.value.includes(fullText))) {
    return;
  }
  node.comments = node.comments || [];
  node.comments.push({
    type: 'CommentBlock',
    value: ' ' + fullText + ' ',
    leading: true,
    trailing: false,
  });
}

// Check whether a JSX child node is a {/* HEROUI-MIGRATE: ... */} comment
// containing the given text. Used to dedupe on re-runs.
function jsxChildHasComment(child, fullText) {
  if (!child) return false;
  if (child.type !== 'JSXExpressionContainer') return false;
  const expr = child.expression;
  if (!expr || expr.type !== 'JSXEmptyExpression') return false;
  return allComments(expr).some((c) => c && c.value && c.value.includes(fullText));
}

// Best-effort: insert a JSX comment as the previous sibling of a JSX element.
// Works for elements that live inside a parent JSXElement or JSXFragment.
// Idempotent: if any preceding-sibling comment already contains the same
// text, no new comment is added. Walks BACK through every preceding comment
// (not just the immediate one) so a stack of HEROUI-MIGRATE comments doesn't
// accumulate duplicates across re-runs.
function insertJSXCommentBefore(j, path, text) {
  const parent = path.parent && path.parent.node;
  if (!parent) return false;
  const fullText = 'HEROUI-MIGRATE: ' + text;
  if (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment') {
    // Inline JSX as a child of an expression — just attach a leading
    // comment to the openingElement instead.
    const node = path.node;
    if (node.openingElement) {
      const opening = node.openingElement;
      if (allComments(opening).some((c) => c && c.value && c.value.includes(fullText))) {
        return false;
      }
      opening.comments = opening.comments || [];
      opening.comments.push({
        type: 'CommentBlock',
        value: ' ' + fullText + ' ',
        leading: true,
        trailing: false,
      });
    }
    return true;
  }
  const idx = parent.children.indexOf(path.node);
  if (idx < 0) return false;
  // Walk every preceding sibling. Skip whitespace JSXText. If we hit a JSX
  // comment node, check whether it's our text (return early if so) and
  // continue to the next one — a stack of HEROUI-MIGRATE comments is normal
  // (one rule per emit), so we have to scan all of them. Stop only when we
  // hit a non-comment, non-whitespace node.
  for (let i = idx - 1; i >= 0; i--) {
    const sib = parent.children[i];
    if (!sib) continue;
    if (sib.type === 'JSXText' && /^\s*$/.test(sib.value || '')) continue;
    if (
      sib.type === 'JSXExpressionContainer' &&
      sib.expression &&
      sib.expression.type === 'JSXEmptyExpression'
    ) {
      if (jsxChildHasComment(sib, fullText)) return false;
      continue;
    }
    break;
  }
  const comment = makeJSXComment(j, fullText);
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
