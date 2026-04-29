'use strict';

const {
  ON_VALUE_CHANGE_COMPONENTS,
  COLOR_VALUE_REWRITES,
  COLOR_VALUES_REMOVED,
  COLOR_VALUE_REWRITES_PER_COMPONENT,
  COLOR_VALUES_REMOVED_PER_COMPONENT,
  VARIANT_VALUE_REWRITES_PER_COMPONENT,
  COLOR_PROP_COMPONENTS,
  COLOR_PROP_FULLY_REMOVED,
  VARIANT_VALUES_REMOVED_PER_COMPONENT,
  REMOVED_STYLE_PROPS_PER_COMPONENT,
  REMOVED_PROPS_UNIVERSAL,
  REMOVED_PROPS_UNIVERSAL_EXTRA,
  PROP_RENAMES_PER_COMPONENT,
  COLLECTION_ITEM_COMPONENTS,
  CLASSNAME_TOKEN_REWRITES,
  CLASSNAME_TOKEN_FLAGGED,
  SUBCOMPONENT_TO_DOT,
  COMPONENT_RENAMES,
  STRUCTURAL_FLAG_COMPONENTS,
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

      // 1b. Universal-extra removed props (asChild, motionProps, disableAnimation,
      //     disableRipple, isInSurface) — only applied when the element is
      //     recognized as a HeroUI component to avoid false positives on
      //     unrelated user JSX with similarly-named props.
      if (
        REMOVED_PROPS_UNIVERSAL_EXTRA.has(propName) &&
        isHeroUIComponent(canonical)
      ) {
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

      // 4. color prop fully removed (Button/ButtonGroup) — drop the attribute.
      //    v3 routes the concept through `variant` instead.
      if (propName === 'color' && COLOR_PROP_FULLY_REMOVED.has(canonical)) {
        recordWarning(
          ctx,
          ctx.filePath,
          attr.loc && attr.loc.start && attr.loc.start.line,
          'removed-prop',
          `<${canonical}>: prop 'color' is removed in v3 — use variant ("primary" | "secondary" | "danger" | "danger-soft" | "ghost" | "outline" | "tertiary") instead.`
        );
        insertJSXCommentBefore(
          j,
          { node: nodeOfOpening(path), parent: parentOfOpening(path) },
          `<${canonical}>: removed prop 'color'. Map to variant in v3.`
        );
        mutated = true;
        continue;
      }

      // 4. color value rewrites (only on color-prop components and only when
      //    the value is a string literal — dynamic values get a FIXME).
      //    Per-component overrides win over the universal table.
      if (propName === 'color' && COLOR_PROP_COMPONENTS.has(canonical)) {
        const value = attr.value;
        const perCompRewrites = COLOR_VALUE_REWRITES_PER_COMPONENT[canonical];
        const perCompRemoved = COLOR_VALUES_REMOVED_PER_COMPONENT[canonical];
        // If this component renames color->X (e.g. Alert color->status,
        //  Toast color->variant), rename the attribute here too so users
        //  don't end up with a stale `color` prop after the value rewrite.
        const colorRename =
          PROP_RENAMES_PER_COMPONENT[canonical] &&
          PROP_RENAMES_PER_COMPONENT[canonical].color;
        if (colorRename) {
          attr.name = j.jsxIdentifier(colorRename);
          mutated = true;
        }
        if (value && value.type === 'StringLiteral') {
          // If this is a color->variant rename AND the component has variant
          // value rewrites (e.g. Toast: error->danger, info->accent), apply
          // them BEFORE the standard color value rewrites.
          const variantRewrites =
            colorRename === 'variant'
              ? VARIANT_VALUE_REWRITES_PER_COMPONENT[canonical]
              : null;
          if (variantRewrites && variantRewrites[value.value]) {
            const newVal = variantRewrites[value.value];
            const oldVal = value.value;
            attr.value = j.stringLiteral(newVal);
            recordWarning(
              ctx,
              ctx.filePath,
              attr.loc && attr.loc.start && attr.loc.start.line,
              'variant-value-remapped',
              `<${canonical}>: 'color="${oldVal}"' renamed to 'variant="${newVal}"' in v3.`
            );
            mutated = true;
            newAttrs.push(attr);
            continue;
          }
          // Per-component removed first (e.g. Chip/Badge secondary).
          if (perCompRemoved && perCompRemoved.has(value.value)) {
            recordWarning(
              ctx,
              ctx.filePath,
              value.loc && value.loc.start && value.loc.start.line,
              'removed-color-value',
              `<${canonical} color="${value.value}">: color value is removed in v3 — use 'default' or convert to Tailwind classes.`
            );
            insertJSXCommentBefore(
              j,
              { node: nodeOfOpening(path), parent: parentOfOpening(path) },
              `<${canonical}>: color="${value.value}" is removed in v3.`
            );
          } else if (perCompRewrites && perCompRewrites[value.value]) {
            attr.value = j.stringLiteral(perCompRewrites[value.value]);
            mutated = true;
          } else if (COLOR_VALUE_REWRITES[value.value]) {
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

      // 4b. variant value removal (per-component v2 tokens that don't exist in v3)
      if (propName === 'variant' && VARIANT_VALUES_REMOVED_PER_COMPONENT[canonical]) {
        const removedSet = VARIANT_VALUES_REMOVED_PER_COMPONENT[canonical];
        if (
          attr.value &&
          attr.value.type === 'StringLiteral' &&
          removedSet.has(attr.value.value)
        ) {
          recordWarning(
            ctx,
            ctx.filePath,
            attr.loc && attr.loc.start && attr.loc.start.line,
            'removed-variant-value',
            `<${canonical} variant="${attr.value.value}">: variant value is removed in v3.`
          );
          insertJSXCommentBefore(
            j,
            { node: nodeOfOpening(path), parent: parentOfOpening(path) },
            `<${canonical}>: variant="${attr.value.value}" is removed in v3.`
          );
          mutated = true;
          continue;
        }
      }

      // 5. Per-component prop renames
      const propRenames = PROP_RENAMES_PER_COMPONENT[canonical];
      if (propRenames && propRenames[propName]) {
        const newName = propRenames[propName];
        attr.name = j.jsxIdentifier(newName);
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
        // After a rename to `variant`, per-component variant value rewrites
        // (e.g. Toast: error -> danger, info -> accent). For propName==='color'
        // the color branch above handles this; this catches any future renames
        // from other prop names.
        if (
          propName !== 'color' &&
          newName === 'variant' &&
          VARIANT_VALUE_REWRITES_PER_COMPONENT[canonical] &&
          attr.value &&
          attr.value.type === 'StringLiteral'
        ) {
          const variantRewrites = VARIANT_VALUE_REWRITES_PER_COMPONENT[canonical];
          const oldVal = attr.value.value;
          if (variantRewrites[oldVal]) {
            const newVal = variantRewrites[oldVal];
            attr.value = j.stringLiteral(newVal);
            recordWarning(
              ctx,
              ctx.filePath,
              attr.loc && attr.loc.start && attr.loc.start.line,
              'variant-value-remapped',
              `<${canonical}>: '${propName}="${oldVal}"' renamed to 'variant="${newVal}"' in v3.`
            );
          }
        }
        newAttrs.push(attr);
        continue;
      }

      // 6. className token rewrites are handled in a separate pass below
      //    that runs across every JSX element (HeroUI or not) so that
      //    Tailwind utilities on plain <div> nodes get rewritten too.
      //    See the `j.JSXAttribute` traversal further down.

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

  // Global className token pass. Tailwind class strings appear on every
  // JSX element (HeroUI components, plain <div>, host elements in
  // helpers, etc.), so we walk every className attribute regardless of
  // whether the owning element is a v2 HeroUI binding.
  root.find(j.JSXAttribute).forEach((path) => {
    const attr = path.node;
    if (!attr || !attr.name || attr.name.type !== 'JSXIdentifier') return;
    if (attr.name.name !== 'className') return;
    if (!attr.value) return;
    const line = (attr.loc && attr.loc.start && attr.loc.start.line) || null;
    if (rewriteClassNameAttrValue(attr.value, ctx, line)) {
      ctx.dirty = true;
    }
  });
}

// True iff the canonical name is one we recognize as a HeroUI v2/v3 component.
// Used to gate REMOVED_PROPS_UNIVERSAL_EXTRA so we don't strip e.g. `asChild`
// from a user's own component that happens to look similar.
function isHeroUIComponent(canonical) {
  if (!canonical) return false;
  return (
    COLOR_PROP_COMPONENTS.has(canonical) ||
    Object.prototype.hasOwnProperty.call(STRUCTURAL_FLAG_COMPONENTS, canonical) ||
    Object.prototype.hasOwnProperty.call(REMOVED_STYLE_PROPS_PER_COMPONENT, canonical)
  );
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

// ---------------------------------------------------------------------------
// className token rewriting
// ---------------------------------------------------------------------------

// Apply CLASSNAME_TOKEN_REWRITES to a class-string. Returns the rewritten
// string. Idempotent: every regex is anchored on word boundaries so
// re-running on the output is a no-op.
function rewriteClassString(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  for (const rule of CLASSNAME_TOKEN_REWRITES) {
    if (rule.from.test(out)) {
      out = out.replace(rule.from, rule.to);
    }
  }
  return out;
}

// Scan a class-string against CLASSNAME_TOKEN_FLAGGED and emit one warning
// per unique flagged token at `line`. Does NOT modify the string.
function flagClassString(s, ctx, line) {
  if (typeof s !== 'string' || !s) return;
  const seen = new Set();
  for (const rule of CLASSNAME_TOKEN_FLAGGED) {
    // Build a non-global copy for enumeration without mutating the rule's
    // lastIndex.
    const re = new RegExp(rule.from.source, rule.from.flags);
    let m;
    while ((m = re.exec(s)) !== null) {
      const tok = m[0];
      const key = tok + '|' + rule.message;
      if (!seen.has(key)) {
        seen.add(key);
        recordWarning(ctx, ctx.filePath, line, 'removed-className-token', rule.message);
      }
      if (!re.global) break;
    }
  }
}

// Apply rewrite + flag in one pass to a class-string. Returns
// { value, changed }.
function transformClassString(s, ctx, line) {
  flagClassString(s, ctx, line);
  const next = rewriteClassString(s);
  return { value: next, changed: next !== s };
}

// Walk a className= attribute value. Mutates string literals / template
// literals / nested expression nodes in place. Returns true if any
// underlying string was rewritten.
function rewriteClassNameAttrValue(value, ctx, line) {
  if (!value) return false;
  if (value.type === 'StringLiteral') {
    const r = transformClassString(value.value, ctx, line);
    if (r.changed) {
      value.value = r.value;
      // Keep raw in sync if present so the printer doesn't re-emit the old text.
      if (value.extra && typeof value.extra.raw === 'string') {
        const quote = value.extra.raw[0] === "'" ? "'" : '"';
        value.extra.raw = quote + r.value + quote;
        value.extra.rawValue = r.value;
      }
    }
    return r.changed;
  }
  if (value.type === 'JSXExpressionContainer') {
    return rewriteClassNameExpression(value.expression, ctx, line);
  }
  return false;
}

// Names of class-name combinator helpers we recurse into.
const CLASSNAME_HELPERS = new Set(['cn', 'clsx', 'cx', 'tw', 'cva', 'classNames']);

// Recursively walk an expression node, rewriting class strings in place.
// Returns true if any rewrite happened.
function rewriteClassNameExpression(node, ctx, line) {
  if (!node) return false;
  let changed = false;

  switch (node.type) {
    case 'StringLiteral': {
      const r = transformClassString(node.value, ctx, line);
      if (r.changed) {
        node.value = r.value;
        if (node.extra && typeof node.extra.raw === 'string') {
          const quote = node.extra.raw[0] === "'" ? "'" : '"';
          node.extra.raw = quote + r.value + quote;
          node.extra.rawValue = r.value;
        }
        changed = true;
      }
      return changed;
    }
    case 'TemplateLiteral': {
      for (const q of node.quasis || []) {
        if (!q.value) continue;
        const cookedIn = typeof q.value.cooked === 'string' ? q.value.cooked : '';
        const rawIn = typeof q.value.raw === 'string' ? q.value.raw : '';
        const cookedR = transformClassString(cookedIn, ctx, line);
        const rawR = transformClassString(rawIn, ctx, line);
        if (cookedR.changed) {
          q.value.cooked = cookedR.value;
          changed = true;
        }
        if (rawR.changed) {
          q.value.raw = rawR.value;
          changed = true;
        }
      }
      for (const e of node.expressions || []) {
        if (rewriteClassNameExpression(e, ctx, line)) changed = true;
      }
      return changed;
    }
    case 'CallExpression': {
      const callee = node.callee;
      let calleeName = null;
      if (callee && callee.type === 'Identifier') calleeName = callee.name;
      // Only recurse into known class-name helpers — touching unknown
      // calls would risk rewriting unrelated strings.
      if (calleeName && CLASSNAME_HELPERS.has(calleeName)) {
        for (const arg of node.arguments || []) {
          if (rewriteClassNameExpression(arg, ctx, line)) changed = true;
        }
      }
      return changed;
    }
    case 'LogicalExpression': {
      // `cond && 'cls'` — the right operand is the class string.
      if (rewriteClassNameExpression(node.right, ctx, line)) changed = true;
      return changed;
    }
    case 'ConditionalExpression': {
      if (rewriteClassNameExpression(node.consequent, ctx, line)) changed = true;
      if (rewriteClassNameExpression(node.alternate, ctx, line)) changed = true;
      return changed;
    }
    case 'ArrayExpression': {
      for (const el of node.elements || []) {
        if (el && rewriteClassNameExpression(el, ctx, line)) changed = true;
      }
      return changed;
    }
    case 'ObjectExpression': {
      // clsx-style: keys are class strings, values are booleans.
      for (const prop of node.properties || []) {
        if (!prop) continue;
        if (prop.type === 'ObjectProperty' || prop.type === 'Property') {
          const key = prop.key;
          if (key && (key.type === 'StringLiteral' || key.type === 'Literal')) {
            const keyVal = typeof key.value === 'string' ? key.value : null;
            if (keyVal !== null) {
              const r = transformClassString(keyVal, ctx, line);
              if (r.changed) {
                key.value = r.value;
                if (key.extra && typeof key.extra.raw === 'string') {
                  const quote = key.extra.raw[0] === "'" ? "'" : '"';
                  key.extra.raw = quote + r.value + quote;
                  key.extra.rawValue = r.value;
                }
                changed = true;
              }
            }
          }
        }
      }
      return changed;
    }
    default:
      return false;
  }
}

module.exports = { rewriteJSXAttributes };
