'use strict';

const {
  ON_VALUE_CHANGE_COMPONENTS,
  COLOR_VALUE_REWRITES,
  COLOR_VALUES_REMOVED,
  COLOR_PROP_COMPONENTS,
  REMOVED_STYLE_PROPS_PER_COMPONENT,
  REMOVED_PROPS_UNIVERSAL,
  PROP_RENAMES_PER_COMPONENT,
  COLLECTION_ITEM_COMPONENTS,
  CLASSNAME_TOKEN_REWRITES,
  SUBCOMPONENT_TO_DOT,
  COMPONENT_RENAMES,
} = require('./mappings');
const { jsxNameOf, recordWarning, insertJSXCommentBefore } = require('./utils');

// All prop-level transforms operate on JSXOpeningElements whose owner is a
// known v2 binding. We resolve canonical-name like components.js does.
function rewriteJSXAttributes(j, root, ctx, importInfo) {
  const { bindings } = importInfo;

  root.find(j.JSXOpeningElement).forEach((path) => {
    const opening = path.node;
    const nameNode = opening.name;
    if (!nameNode) return;

    const localRoot = jsxLocalRoot(nameNode);
    if (!localRoot) return;
    const binding = bindings.get(localRoot);
    if (!binding || binding.isV3) return;

    // Compute the canonical v2 name (best-effort): if the JSX is a plain
    // identifier, use the binding's v2Canonical; if a member expression on a
    // namespace import, the right-most segment.
    let canonical;
    if (nameNode.type === 'JSXIdentifier') {
      canonical = binding.v2Canonical;
    } else {
      // Member expression. For dot-notation user-authored JSX (e.g. <Card.Body>
      // when they imported {Card}), don't rewrite props — assume they're
      // already migrating manually.
      const dotted = jsxNameOf(nameNode);
      canonical = dotted ? dotted.split('.').pop() : null;
    }
    if (!canonical || canonical === '*default*' || canonical === '*namespace*') return;

    const attrs = opening.attributes || [];
    const newAttrs = [];
    let mutated = false;

    for (const attr of attrs) {
      if (attr.type !== 'JSXAttribute') {
        newAttrs.push(attr);
        continue;
      }
      const propName = attr.name && attr.name.type === 'JSXIdentifier' ? attr.name.name : null;
      if (!propName) {
        newAttrs.push(attr);
        continue;
      }

      // 1. Universal removed props (`classNames` etc.) — drop with FIXME
      if (REMOVED_PROPS_UNIVERSAL.has(propName)) {
        recordWarning(
          ctx,
          ctx.filePath,
          attr.loc && attr.loc.start && attr.loc.start.line,
          'removed-prop',
          `<${canonical}>: prop '${propName}' is removed in v3 — convert to className/Tailwind on each part.`
        );
        insertJSXCommentBefore(
          j,
          { node: nodeOfOpening(path), parent: parentOfOpening(path) },
          `<${canonical}>: removed prop '${propName}'. Convert to per-part className.`
        );
        mutated = true;
        continue;
      }

      // 2. Per-component removed style props
      const removed = REMOVED_STYLE_PROPS_PER_COMPONENT[canonical];
      if (removed && removed.includes(propName)) {
        recordWarning(
          ctx,
          ctx.filePath,
          attr.loc && attr.loc.start && attr.loc.start.line,
          'removed-prop',
          `<${canonical}>: prop '${propName}' is removed in v3.`
        );
        insertJSXCommentBefore(
          j,
          { node: nodeOfOpening(path), parent: parentOfOpening(path) },
          `<${canonical}>: removed prop '${propName}'.`
        );
        mutated = true;
        continue;
      }

      // 3. onValueChange -> onChange (form components only)
      if (
        propName === 'onValueChange' &&
        ON_VALUE_CHANGE_COMPONENTS.has(canonical)
      ) {
        attr.name = j.jsxIdentifier('onChange');
        mutated = true;
        newAttrs.push(attr);
        continue;
      }

      // 4. color value rewrites (only on color-prop components and only when
      //    the value is a string literal — dynamic values get a FIXME).
      if (propName === 'color' && COLOR_PROP_COMPONENTS.has(canonical)) {
        const value = attr.value;
        if (value && value.type === 'StringLiteral') {
          if (COLOR_VALUE_REWRITES[value.value]) {
            attr.value = j.stringLiteral(COLOR_VALUE_REWRITES[value.value]);
            mutated = true;
          } else if (COLOR_VALUES_REMOVED.has(value.value)) {
            recordWarning(
              ctx,
              ctx.filePath,
              value.loc && value.loc.start && value.loc.start.line,
              'removed-color-value',
              `<${canonical} color="${value.value}">: color value is removed in v3 — choose a v3 color (default/accent/success/warning/danger) or use Tailwind.`
            );
            insertJSXCommentBefore(
              j,
              { node: nodeOfOpening(path), parent: parentOfOpening(path) },
              `<${canonical}>: color="${value.value}" is removed in v3.`
            );
          }
        } else if (value && value.type === 'JSXExpressionContainer') {
          recordWarning(
            ctx,
            ctx.filePath,
            value.loc && value.loc.start && value.loc.start.line,
            'dynamic-color',
            `<${canonical}>: dynamic color expression — verify token mapping (primary->accent, secondary removed).`
          );
        }
        newAttrs.push(attr);
        continue;
      }

      // 5. Per-component prop renames
      const propRenames = PROP_RENAMES_PER_COMPONENT[canonical];
      if (propRenames && propRenames[propName]) {
        attr.name = j.jsxIdentifier(propRenames[propName]);
        mutated = true;
        // If the rename has a known type-shape change, flag it.
        if (
          (canonical === 'Calendar' || canonical === 'RangeCalendar') &&
          propName === 'visibleMonths'
        ) {
          recordWarning(
            ctx,
            ctx.filePath,
            attr.loc && attr.loc.start && attr.loc.start.line,
            'prop-shape-changed',
            `<${canonical}>: visibleMonths -> visibleDuration; value type changed from number to {months: n}. Wrap manually.`
          );
        }
        if (canonical === 'Tabs' && propName === 'isVertical') {
          recordWarning(
            ctx,
            ctx.filePath,
            attr.loc && attr.loc.start && attr.loc.start.line,
            'prop-shape-changed',
            `<Tabs>: isVertical -> orientation; value type changed from boolean to "horizontal"|"vertical".`
          );
        }
        newAttrs.push(attr);
        continue;
      }

      // 6. className string rewrites (text-tiny -> text-xs etc.)
      if (
        propName === 'className' &&
        attr.value &&
        attr.value.type === 'StringLiteral'
      ) {
        let s = attr.value.value;
        let changed = false;
        for (const rule of CLASSNAME_TOKEN_REWRITES) {
          if (rule.from.test(s)) {
            s = s.replace(rule.from, rule.to);
            changed = true;
          }
        }
        if (changed) {
          attr.value = j.stringLiteral(s);
          mutated = true;
        }
        newAttrs.push(attr);
        continue;
      }

      newAttrs.push(attr);
    }

    if (mutated) {
      opening.attributes = newAttrs;
      ctx.dirty = true;
    }
  });

  // Collection items: copy `key={X}` to `id={X}` (v3 needs id, v2 used key
  // for both reconciliation and identity). We keep `key` because React still
  // uses it for reconciliation; v3 needs `id` separately.
  // Source: per-component migration pages (Dropdown/Select/Listbox/Accordion/Tabs/Table).
  root.find(j.JSXOpeningElement).forEach((path) => {
    const opening = path.node;
    const nameNode = opening.name;
    if (!nameNode) return;

    const localRoot = jsxLocalRoot(nameNode);
    if (!localRoot) return;
    const binding = bindings.get(localRoot);
    if (!binding || binding.isV3) return;

    let canonical;
    if (nameNode.type === 'JSXIdentifier') {
      canonical = binding.v2Canonical;
    } else {
      const dotted = jsxNameOf(nameNode);
      canonical = dotted ? dotted.split('.').pop() : null;
    }
    if (!COLLECTION_ITEM_COMPONENTS.has(canonical)) return;

    const attrs = opening.attributes || [];
    const hasId = attrs.some(
      (a) => a.type === 'JSXAttribute' && a.name && a.name.name === 'id'
    );
    if (hasId) return;

    const keyAttr = attrs.find(
      (a) => a.type === 'JSXAttribute' && a.name && a.name.name === 'key'
    );
    if (!keyAttr || !keyAttr.value) return;

    // Clone the key value as the new id attribute.
    const idAttr = j.jsxAttribute(j.jsxIdentifier('id'), keyAttr.value);
    opening.attributes = [...attrs, idAttr];
    ctx.dirty = true;

    // textValue advisory: if children aren't a single string literal, warn.
    // We check the parent JSXElement.
    // Note: this is best-effort — the path here is the OpeningElement, not the
    // Element itself.
    recordWarning(
      ctx,
      ctx.filePath,
      opening.loc && opening.loc.start && opening.loc.start.line,
      'collection-item-textvalue',
      `<${canonical}>: copied key={...} to id={...}. v3 also needs textValue={"..."} when children aren't a plain string. See https://heroui.com/docs/react/migration`
    );
  });
}

function jsxLocalRoot(nameNode) {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name;
  if (nameNode.type === 'JSXMemberExpression') {
    let obj = nameNode.object;
    while (obj.type === 'JSXMemberExpression') obj = obj.object;
    if (obj.type === 'JSXIdentifier') return obj.name;
  }
  return null;
}

// Given a Path to a JSXOpeningElement, return the parent JSXElement node.
function nodeOfOpening(path) {
  return path.parent && path.parent.node;
}
function parentOfOpening(path) {
  return path.parent && path.parent.parent;
}

module.exports = { rewriteJSXAttributes };
