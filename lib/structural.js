'use strict';

// Structural auto-restructures for HeroUI v2 -> v3.
//
// These transforms run AFTER lib/components.js has done the rename pass, so
// by the time we see the JSX, the user's original imported names have been
// rewritten to canonical v3 names (Tooltip, Badge, Avatar, Modal, Drawer,
// Tabs, Input — the latter four kept their names; <Tab> became <Tabs.Tab>).
//
// Each transform pattern-matches the v3 JSX shape it expects to find. On a
// match we rewrite + emit an `auto-restructure` warning. On bail we insert a
// HEROUI-MIGRATE comment with the manual recipe from STRUCTURAL_FALLBACK_COMPONENTS.

const { STRUCTURAL_FALLBACK_COMPONENTS } = require('./mappings');
const {
  jsxNameOf,
  buildJSXMember,
  insertJSXCommentBefore,
  recordWarning,
} = require('./utils');

function applyStructuralRewrites(j, root, ctx, importInfo) {
  if (!importInfo || !importInfo.bindings) return;
  if (!importInfo.requiredV3Specifiers) {
    importInfo.requiredV3Specifiers = new Set();
  }
  transformTooltip(j, root, ctx, importInfo);
  transformBadge(j, root, ctx, importInfo);
  transformAvatar(j, root, ctx, importInfo);
  transformModal(j, root, ctx, importInfo);
  transformDrawer(j, root, ctx, importInfo);
  transformTabs(j, root, ctx, importInfo);
  transformInputToTextField(j, root, ctx, importInfo);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Resolve the local-binding root name from a JSX name node. For <Foo/> -> "Foo";
// for <NS.Foo/> -> "NS"; for <NS.Foo.Bar/> still "NS".
function jsxLocalRoot(nameNode) {
  if (!nameNode) return null;
  if (nameNode.type === 'JSXIdentifier') return nameNode.name;
  if (nameNode.type === 'JSXMemberExpression') {
    let obj = nameNode.object;
    while (obj.type === 'JSXMemberExpression') obj = obj.object;
    if (obj.type === 'JSXIdentifier') return obj.name;
  }
  return null;
}

// Iterate JSXElements where the canonical (post-rename, top-level) name
// matches `wantedName`. Calls `cb(path)` for each. Skips v3-aliased imports
// and namespace imports under different canonical names.
function findElementsByCanonical(j, root, importInfo, wantedName, cb) {
  const { bindings } = importInfo;
  root.find(j.JSXElement).forEach((path) => {
    const opening = path.node.openingElement;
    const nameNode = opening && opening.name;
    if (!nameNode) return;
    const dotted = jsxNameOf(nameNode);
    if (!dotted) return;
    // Top-level name (first segment of the dotted path) must equal wantedName.
    const top = dotted.split('.')[0];
    if (top !== wantedName) return;

    // Resolve the binding to confirm this is a HeroUI-imported component
    // (skip identifiers that just happen to share the name).
    const localRoot = jsxLocalRoot(nameNode);
    if (!localRoot) return;
    const binding = bindings.get(localRoot);
    if (!binding) return;
    if (binding.isV3) return; // user already on v3 alias

    cb(path);
  });
}

// Filter children: drop pure-whitespace JSXText nodes and JSXEmptyExpression
// containers (e.g. left-over comments).
function nonWhitespaceChildren(children) {
  if (!children) return [];
  return children.filter((c) => {
    if (!c) return false;
    if (c.type === 'JSXText') {
      // Pure whitespace? skip.
      return c.value && /\S/.test(c.value);
    }
    return true;
  });
}

// Find an attribute by name; returns the JSXAttribute node or undefined.
function findAttr(attrs, name) {
  if (!attrs) return undefined;
  for (const a of attrs) {
    if (a.type !== 'JSXAttribute') continue;
    if (a.name && a.name.type === 'JSXIdentifier' && a.name.name === name) {
      return a;
    }
  }
  return undefined;
}

// Remove attributes by name; returns a NEW array.
function withoutAttrs(attrs, names) {
  if (!attrs) return [];
  const set = new Set(names);
  return attrs.filter((a) => {
    if (a.type !== 'JSXAttribute') return true;
    return !(a.name && a.name.type === 'JSXIdentifier' && set.has(a.name.name));
  });
}

// Convert a JSXAttribute value into a JSXExpressionContainer-suitable node.
// For string literals -> StringLiteral wrapped in JSXExpressionContainer.
// For JSXExpressionContainer -> the inner expression.
// For JSXElement / JSXFragment -> the element itself.
function attrValueToChild(j, value) {
  if (!value) return j.jsxExpressionContainer(j.jsxEmptyExpression());
  if (value.type === 'StringLiteral' || value.type === 'Literal') {
    return j.jsxText(typeof value.value === 'string' ? value.value : String(value.value));
  }
  if (value.type === 'JSXExpressionContainer') {
    // If the expression is just a literal, surface the literal as JSXText.
    const expr = value.expression;
    if (expr && (expr.type === 'StringLiteral' || expr.type === 'Literal')) {
      if (typeof expr.value === 'string') return j.jsxText(expr.value);
    }
    return value; // keep the container as-is
  }
  if (value.type === 'JSXElement' || value.type === 'JSXFragment') {
    return value;
  }
  return j.jsxExpressionContainer(value);
}

// Build a JSXElement helper.
function buildElement(j, name, attributes, children, selfClosing) {
  const opening = j.jsxOpeningElement(
    buildJSXMember(j, name),
    attributes || [],
    !!selfClosing
  );
  if (selfClosing) {
    return j.jsxElement(opening, null, []);
  }
  const closing = j.jsxClosingElement(buildJSXMember(j, name));
  return j.jsxElement(opening, closing, children || []);
}

// Get the literal string from a JSXAttribute value if it's a simple string.
// Returns null if not a plain literal.
function literalString(value) {
  if (!value) return null;
  if (value.type === 'StringLiteral' || value.type === 'Literal') {
    return typeof value.value === 'string' ? value.value : null;
  }
  if (value.type === 'JSXExpressionContainer') {
    const e = value.expression;
    if (e && (e.type === 'StringLiteral' || e.type === 'Literal')) {
      return typeof e.value === 'string' ? e.value : null;
    }
  }
  return null;
}

// Detect a function-as-child (the `<Modal>{(close) => ...}</Modal>` pattern).
function hasFunctionAsChild(children) {
  if (!children) return false;
  for (const c of children) {
    if (!c) continue;
    if (c.type !== 'JSXExpressionContainer') continue;
    const e = c.expression;
    if (!e) continue;
    if (e.type === 'ArrowFunctionExpression' || e.type === 'FunctionExpression') {
      return true;
    }
  }
  return false;
}

// Bail-flag: insert a HEROUI-MIGRATE comment (and warning) referencing the
// fallback recipe.
function flagForManual(j, ctx, path, canonical) {
  const msg = STRUCTURAL_FALLBACK_COMPONENTS[canonical];
  if (!msg) return;
  insertJSXCommentBefore(j, path, msg);
  const opening = path.node.openingElement;
  recordWarning(
    ctx,
    ctx.filePath,
    opening && opening.loc && opening.loc.start && opening.loc.start.line,
    'structural-flag',
    `<${canonical}>: ${msg}`
  );
  ctx.dirty = true;
}

function emitAutoRestructure(ctx, path, canonical, message) {
  const opening = path.node.openingElement;
  recordWarning(
    ctx,
    ctx.filePath,
    opening && opening.loc && opening.loc.start && opening.loc.start.line,
    'auto-restructure',
    `<${canonical}>: ${message}`
  );
  ctx.dirty = true;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
//
// <Tooltip content={X} {...rest}>{trigger}</Tooltip>
//   ->
// <Tooltip {...rest}>
//   <Tooltip.Trigger>{trigger}</Tooltip.Trigger>
//   <Tooltip.Content>{X}</Tooltip.Content>
// </Tooltip>

function transformTooltip(j, root, ctx, importInfo) {
  findElementsByCanonical(j, root, importInfo, 'Tooltip', (path) => {
    const node = path.node;
    const opening = node.openingElement;
    // Skip dot-notation children (already partially transformed): only handle
    // the top-level <Tooltip>.
    if (opening.name.type !== 'JSXIdentifier') return;

    const attrs = opening.attributes || [];
    const contentAttr = findAttr(attrs, 'content');
    const kids = nonWhitespaceChildren(node.children);

    // Already restructured? (children are <Tooltip.Trigger> + <Tooltip.Content>)
    if (kids.length && kids.every((c) => {
      if (c.type !== 'JSXElement') return false;
      const dotted = jsxNameOf(c.openingElement.name);
      return dotted === 'Tooltip.Trigger' || dotted === 'Tooltip.Content';
    })) {
      return; // idempotent: already in v3 shape
    }

    if (!contentAttr) {
      flagForManual(j, ctx, path, 'Tooltip');
      return;
    }
    if (kids.length !== 1 || kids[0].type !== 'JSXElement') {
      flagForManual(j, ctx, path, 'Tooltip');
      return;
    }
    if (hasFunctionAsChild(node.children)) {
      flagForManual(j, ctx, path, 'Tooltip');
      return;
    }

    const trigger = kids[0];
    const contentValue = contentAttr.value;
    const newAttrs = withoutAttrs(attrs, ['content']);

    const triggerEl = buildElement(j, 'Tooltip.Trigger', [], [trigger], false);
    const contentChild = attrValueToChild(j, contentValue);
    const contentEl = buildElement(j, 'Tooltip.Content', [], [contentChild], false);

    opening.attributes = newAttrs;
    node.children = [
      j.jsxText('\n'),
      triggerEl,
      j.jsxText('\n'),
      contentEl,
      j.jsxText('\n'),
    ];
    if (node.closingElement) {
      // closingElement.name stays 'Tooltip' (already correct).
    }
    emitAutoRestructure(ctx, path, 'Tooltip', 'restructured into <Tooltip.Trigger> + <Tooltip.Content>.');
  });
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
//
// <Badge content={X} {...rest}>{children}</Badge>
//   ->
// <Badge.Anchor>{children}<Badge {...rest}>{X}</Badge></Badge.Anchor>

function transformBadge(j, root, ctx, importInfo) {
  findElementsByCanonical(j, root, importInfo, 'Badge', (path) => {
    const node = path.node;
    const opening = node.openingElement;
    if (opening.name.type !== 'JSXIdentifier') return; // skip Badge.Anchor etc.

    // Skip a Badge that's already inside a Badge.Anchor (idempotent guard).
    const parent = path.parent && path.parent.node;
    if (parent && parent.type === 'JSXElement') {
      const parentName = jsxNameOf(parent.openingElement && parent.openingElement.name);
      if (parentName === 'Badge.Anchor') return;
    }

    const attrs = opening.attributes || [];
    const contentAttr = findAttr(attrs, 'content');
    if (!contentAttr) {
      flagForManual(j, ctx, path, 'Badge');
      return;
    }

    const kids = nonWhitespaceChildren(node.children);
    if (kids.length !== 1 || kids[0].type !== 'JSXElement') {
      flagForManual(j, ctx, path, 'Badge');
      return;
    }
    if (hasFunctionAsChild(node.children)) {
      flagForManual(j, ctx, path, 'Badge');
      return;
    }

    const child = kids[0];
    const contentValue = contentAttr.value;
    const newAttrs = withoutAttrs(attrs, ['content']);
    const contentChild = attrValueToChild(j, contentValue);

    const innerBadge = buildElement(j, 'Badge', newAttrs, [contentChild], false);
    const anchor = buildElement(
      j,
      'Badge.Anchor',
      [],
      [j.jsxText('\n'), child, j.jsxText('\n'), innerBadge, j.jsxText('\n')],
      false
    );

    // Replace the original <Badge> in parent's children with the anchor.
    if (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) {
      const idx = parent.children.indexOf(node);
      if (idx >= 0) {
        parent.children.splice(idx, 1, anchor);
      }
    } else {
      path.replace(anchor);
    }
    emitAutoRestructure(ctx, path, 'Badge', 'wrapped in <Badge.Anchor> with content moved to inner <Badge>.');
  });
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
//
// <Avatar src="..." name="..." {...rest}/>  (self-closing or empty)
//   ->
// <Avatar {...rest}>
//   <Avatar.Image src="..." />
//   <Avatar.Fallback>{name}</Avatar.Fallback>
// </Avatar>

function transformAvatar(j, root, ctx, importInfo) {
  findElementsByCanonical(j, root, importInfo, 'Avatar', (path) => {
    const node = path.node;
    const opening = node.openingElement;
    if (opening.name.type !== 'JSXIdentifier') return; // skip <Avatar.Image/> etc.

    const attrs = opening.attributes || [];
    const srcAttr = findAttr(attrs, 'src');
    const nameAttr = findAttr(attrs, 'name');
    const fallbackAttr = findAttr(attrs, 'fallback');
    const hasSrc = !!srcAttr;
    const hasFallbackish = !!(nameAttr || fallbackAttr);

    if (!hasSrc && !hasFallbackish) return; // nothing to restructure

    // Bail if Avatar already has element children.
    const kids = nonWhitespaceChildren(node.children);
    if (kids.length > 0) {
      // If existing children look like Avatar.Image / Avatar.Fallback, treat
      // as already restructured and skip.
      const allAvatarParts = kids.every((c) => {
        if (c.type !== 'JSXElement') return false;
        const dotted = jsxNameOf(c.openingElement.name);
        return dotted === 'Avatar.Image' || dotted === 'Avatar.Fallback';
      });
      if (allAvatarParts) return;
      flagForManual(j, ctx, path, 'Avatar');
      return;
    }

    const dropNames = ['src'];
    if (nameAttr) dropNames.push('name');
    if (fallbackAttr) dropNames.push('fallback');
    const newAttrs = withoutAttrs(attrs, dropNames);

    const newChildren = [];
    if (srcAttr) {
      const imageAttrs = [j.jsxAttribute(j.jsxIdentifier('src'), srcAttr.value)];
      const imageEl = buildElement(j, 'Avatar.Image', imageAttrs, [], true);
      newChildren.push(j.jsxText('\n'));
      newChildren.push(imageEl);
    }
    const fbAttr = fallbackAttr || nameAttr;
    if (fbAttr) {
      const fbChild = attrValueToChild(j, fbAttr.value);
      const fbEl = buildElement(j, 'Avatar.Fallback', [], [fbChild], false);
      newChildren.push(j.jsxText('\n'));
      newChildren.push(fbEl);
    }
    newChildren.push(j.jsxText('\n'));

    opening.attributes = newAttrs;
    opening.selfClosing = false;
    node.closingElement = j.jsxClosingElement(buildJSXMember(j, 'Avatar'));
    node.children = newChildren;
    emitAutoRestructure(ctx, path, 'Avatar', 'expanded into <Avatar.Image/> + <Avatar.Fallback>.');
  });
}

// ---------------------------------------------------------------------------
// Modal / Drawer (shared logic)
// ---------------------------------------------------------------------------

const MODAL_BACKDROP_ATTRS = new Set([
  'isOpen',
  'onOpenChange',
  'defaultOpen',
  'isDismissable',
  'isKeyboardDismissDisabled',
]);
const MODAL_CONTAINER_ATTRS = new Set(['placement', 'size']);

function partitionModalAttrs(j, attrs) {
  const backdropAttrs = [];
  const containerAttrs = [];
  const dialogAttrs = [];
  let hadCloseButton = false;
  let hadHideCloseButton = false;
  for (const a of attrs || []) {
    if (a.type !== 'JSXAttribute') {
      // Spread attributes — put on the outermost (Backdrop) so state controls
      // still apply.
      backdropAttrs.push(a);
      continue;
    }
    const name = a.name && a.name.name;
    if (!name) continue;
    if (name === 'closeButton') {
      hadCloseButton = true;
      continue;
    }
    if (name === 'hideCloseButton') {
      hadHideCloseButton = true;
      continue;
    }
    if (name === 'backdrop') {
      // Rename to variant on the Backdrop.
      const renamed = j.jsxAttribute(j.jsxIdentifier('variant'), a.value);
      backdropAttrs.push(renamed);
      continue;
    }
    if (MODAL_BACKDROP_ATTRS.has(name)) {
      backdropAttrs.push(a);
      continue;
    }
    if (name === 'scrollBehavior') {
      const renamed = j.jsxAttribute(j.jsxIdentifier('scroll'), a.value);
      containerAttrs.push(renamed);
      continue;
    }
    if (MODAL_CONTAINER_ATTRS.has(name)) {
      containerAttrs.push(a);
      continue;
    }
    // Dialog: aria-*, role, anything left over
    dialogAttrs.push(a);
  }
  return { backdropAttrs, containerAttrs, dialogAttrs, hadCloseButton, hadHideCloseButton };
}

function transformModalLike(j, root, ctx, importInfo, canonicalRoot, opts) {
  findElementsByCanonical(j, root, importInfo, canonicalRoot, (path) => {
    const node = path.node;
    const opening = node.openingElement;
    if (opening.name.type !== 'JSXIdentifier') return; // skip <Modal.Body/> etc.

    // Idempotency: if the only non-whitespace child is a <X.Backdrop> node,
    // skip — already restructured.
    const kids = nonWhitespaceChildren(node.children);
    if (
      kids.length === 1 &&
      kids[0].type === 'JSXElement' &&
      jsxNameOf(kids[0].openingElement.name) === `${canonicalRoot}.Backdrop`
    ) {
      return;
    }

    if (hasFunctionAsChild(node.children)) {
      flagForManual(j, ctx, path, canonicalRoot);
      return;
    }

    const { backdropAttrs, containerAttrs, dialogAttrs, hadCloseButton, hadHideCloseButton } =
      partitionModalAttrs(j, opening.attributes || []);

    // Drawer: emit default-placement-changed warning if no placement attr.
    if (canonicalRoot === 'Drawer') {
      const hadPlacement = (opening.attributes || []).some(
        (a) =>
          a.type === 'JSXAttribute' &&
          a.name &&
          a.name.name === 'placement'
      );
      if (!hadPlacement) {
        recordWarning(
          ctx,
          ctx.filePath,
          opening.loc && opening.loc.start && opening.loc.start.line,
          'default-placement-changed',
          "<Drawer>: v2 default placement was 'right'; v3 default is 'bottom'. Add placement=\"right\" to preserve behavior."
        );
      }
    }

    const dialogChildren = [j.jsxText('\n')];
    if (hadCloseButton && !hadHideCloseButton) {
      dialogChildren.push(buildElement(j, `${canonicalRoot}.CloseTrigger`, [], [], true));
      dialogChildren.push(j.jsxText('\n'));
    }
    // Pass through original children (whitespace-trimmed at outer edges to keep
    // formatting clean).
    for (const c of node.children || []) {
      dialogChildren.push(c);
    }
    dialogChildren.push(j.jsxText('\n'));

    const dialogEl = buildElement(
      j,
      `${canonicalRoot}.Dialog`,
      dialogAttrs,
      dialogChildren,
      false
    );
    const containerEl = buildElement(
      j,
      `${canonicalRoot}.Container`,
      containerAttrs,
      [j.jsxText('\n'), dialogEl, j.jsxText('\n')],
      false
    );
    const backdropEl = buildElement(
      j,
      `${canonicalRoot}.Backdrop`,
      backdropAttrs,
      [j.jsxText('\n'), containerEl, j.jsxText('\n')],
      false
    );

    // Replace the entire <Modal>...</Modal> with <Modal.Backdrop>.
    // We keep an outer wrapping so the user can search/replace easily; but
    // since Modal.Backdrop already conveys all the state, we just replace
    // the original element with the Backdrop tree.
    const parent = path.parent && path.parent.node;
    if (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) {
      const idx = parent.children.indexOf(node);
      if (idx >= 0) parent.children.splice(idx, 1, backdropEl);
    } else {
      path.replace(backdropEl);
    }

    emitAutoRestructure(
      ctx,
      path,
      canonicalRoot,
      `restructured into <${canonicalRoot}.Backdrop><${canonicalRoot}.Container><${canonicalRoot}.Dialog>.`
    );
  });
}

function transformModal(j, root, ctx, importInfo) {
  transformModalLike(j, root, ctx, importInfo, 'Modal', {});
}
function transformDrawer(j, root, ctx, importInfo) {
  transformModalLike(j, root, ctx, importInfo, 'Drawer', {});
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
//
// <Tabs>
//   <Tabs.Tab id="K" title="X">{body}</Tabs.Tab>     (already renamed from <Tab>)
// </Tabs>
//   ->
// <Tabs>
//   <Tabs.Tab id="K">X</Tabs.Tab>
//   <Tabs.Panel id="K">{body}</Tabs.Panel>
// </Tabs>

function transformTabs(j, root, ctx, importInfo) {
  findElementsByCanonical(j, root, importInfo, 'Tabs', (path) => {
    const node = path.node;
    const opening = node.openingElement;
    if (opening.name.type !== 'JSXIdentifier') return; // skip <Tabs.Tab/> etc.

    // Walk the immediate children to find <Tabs.Tab> entries.
    const childTabs = [];
    let listChildIdx = -1;
    for (let i = 0; i < (node.children || []).length; i++) {
      const c = node.children[i];
      if (!c || c.type !== 'JSXElement') continue;
      const dotted = jsxNameOf(c.openingElement.name);
      if (dotted === 'Tabs.Tab') {
        childTabs.push({ idx: i, node: c });
      } else if (dotted === 'Tabs.List' && listChildIdx < 0) {
        listChildIdx = i;
      } else if (dotted === 'Tabs.Panel') {
        // Already partially restructured — skip the whole Tabs.
        return;
      }
    }

    if (childTabs.length === 0) return;

    // Bail if any Tab has dynamic title (we want a literal-ish value to
    // confidently match panel<->tab by id), OR missing title, OR missing
    // body content.
    let bailed = false;
    const transforms = [];
    for (const { node: tab } of childTabs) {
      const tabOpening = tab.openingElement;
      const titleAttr = findAttr(tabOpening.attributes, 'title');
      const idAttr = findAttr(tabOpening.attributes, 'id');
      if (!titleAttr) {
        bailed = true;
        break;
      }
      const body = nonWhitespaceChildren(tab.children);
      if (body.length === 0) {
        bailed = true;
        break;
      }
      if (!idAttr || !idAttr.value) {
        bailed = true;
        break;
      }
      transforms.push({ tab, titleAttr, idAttr, body: tab.children });
    }

    if (bailed) {
      flagForManual(j, ctx, path, 'Tabs');
      return;
    }

    // Apply rewrites:
    //  - rewrite <Tabs.Tab> children to {titleValue}
    //  - drop title attr
    //  - append a <Tabs.Panel id={K}>{body}</Tabs.Panel> sibling for each tab
    const newPanels = [];
    for (const { tab, titleAttr, idAttr, body } of transforms) {
      const titleChild = attrValueToChild(j, titleAttr.value);
      tab.openingElement.attributes = withoutAttrs(
        tab.openingElement.attributes,
        ['title']
      );
      tab.children = [titleChild];

      const panelAttrs = [j.jsxAttribute(j.jsxIdentifier('id'), idAttr.value)];
      const panelEl = buildElement(j, 'Tabs.Panel', panelAttrs, body, false);
      newPanels.push(panelEl);
    }

    // Insert panels into Tabs children. If <Tabs.List> exists, place AFTER it;
    // otherwise append at end.
    let insertAt;
    if (listChildIdx >= 0) {
      insertAt = listChildIdx + 1;
    } else {
      insertAt = (node.children || []).length;
    }
    const panelsWithSpacing = [];
    for (const p of newPanels) {
      panelsWithSpacing.push(j.jsxText('\n'));
      panelsWithSpacing.push(p);
    }
    panelsWithSpacing.push(j.jsxText('\n'));
    node.children.splice(insertAt, 0, ...panelsWithSpacing);

    emitAutoRestructure(
      ctx,
      path,
      'Tabs',
      'split each <Tabs.Tab> body into a sibling <Tabs.Panel id="...">.'
    );
  });
}

// ---------------------------------------------------------------------------
// Input -> TextField wrapper
// ---------------------------------------------------------------------------
//
// <Input label="X" description="Y" errorMessage="Z" {...rest}/>
//   ->
// <TextField>
//   <Label>X</Label>
//   <Input {...rest}/>
//   <Description>Y</Description>
//   <FieldError>Z</FieldError>
// </TextField>
//
// If startContent / endContent are present, wrap <Input/> in <InputGroup>
// with .Prefix / .Suffix children.

function transformInputToTextField(j, root, ctx, importInfo) {
  findElementsByCanonical(j, root, importInfo, 'Input', (path) => {
    const node = path.node;
    const opening = node.openingElement;
    if (opening.name.type !== 'JSXIdentifier') return; // skip <Input.Group/> etc.

    // Skip if already inside a <TextField>.
    const parent = path.parent && path.parent.node;
    if (parent && parent.type === 'JSXElement') {
      const parentDotted = jsxNameOf(
        parent.openingElement && parent.openingElement.name
      );
      if (
        parentDotted === 'TextField' ||
        parentDotted === 'InputGroup' ||
        parentDotted === 'InputGroup.Prefix' ||
        parentDotted === 'InputGroup.Suffix'
      ) {
        return;
      }
    }

    const attrs = opening.attributes || [];
    const labelAttr = findAttr(attrs, 'label');
    const descriptionAttr = findAttr(attrs, 'description');
    const errorAttr = findAttr(attrs, 'errorMessage');
    const startAttr = findAttr(attrs, 'startContent');
    const endAttr = findAttr(attrs, 'endContent');

    const hasField = !!(labelAttr || descriptionAttr || errorAttr);
    const hasGroup = !!(startAttr || endAttr);

    if (!hasField && !hasGroup) return;

    // Bail if any of label/description/errorMessage is dynamic
    // (anything other than a string literal or a string-literal expression).
    if (labelAttr && literalString(labelAttr.value) === null) {
      flagForManual(j, ctx, path, 'Input');
      return;
    }
    if (descriptionAttr && literalString(descriptionAttr.value) === null) {
      flagForManual(j, ctx, path, 'Input');
      return;
    }
    if (errorAttr && literalString(errorAttr.value) === null) {
      flagForManual(j, ctx, path, 'Input');
      return;
    }

    // Bail if startContent/endContent value is something other than
    // string, identifier, or a JSXElement (we keep the whitelist tight).
    function isOkAffix(v) {
      if (!v) return false;
      if (v.type === 'StringLiteral' || v.type === 'Literal') return true;
      if (v.type === 'JSXExpressionContainer') {
        const e = v.expression;
        if (!e) return false;
        if (e.type === 'StringLiteral' || e.type === 'Literal') return true;
        if (e.type === 'Identifier') return true;
        if (e.type === 'JSXElement' || e.type === 'JSXFragment') return true;
        return false;
      }
      return false;
    }
    if (startAttr && !isOkAffix(startAttr.value)) {
      flagForManual(j, ctx, path, 'Input');
      return;
    }
    if (endAttr && !isOkAffix(endAttr.value)) {
      flagForManual(j, ctx, path, 'Input');
      return;
    }

    // Strip processed attrs from the inner <Input/>.
    const dropAttrs = [];
    if (labelAttr) dropAttrs.push('label');
    if (descriptionAttr) dropAttrs.push('description');
    if (errorAttr) dropAttrs.push('errorMessage');
    if (startAttr) dropAttrs.push('startContent');
    if (endAttr) dropAttrs.push('endContent');
    const newInputAttrs = withoutAttrs(attrs, dropAttrs);

    const innerInput = buildElement(j, 'Input', newInputAttrs, [], true);

    // Build the (possibly InputGroup-wrapped) input.
    let inputSlot = innerInput;
    if (hasGroup) {
      const groupChildren = [j.jsxText('\n')];
      if (startAttr) {
        const v = attrValueToChild(j, startAttr.value);
        groupChildren.push(buildElement(j, 'InputGroup.Prefix', [], [v], false));
        groupChildren.push(j.jsxText('\n'));
      }
      groupChildren.push(innerInput);
      groupChildren.push(j.jsxText('\n'));
      if (endAttr) {
        const v = attrValueToChild(j, endAttr.value);
        groupChildren.push(buildElement(j, 'InputGroup.Suffix', [], [v], false));
        groupChildren.push(j.jsxText('\n'));
      }
      inputSlot = buildElement(j, 'InputGroup', [], groupChildren, false);
      importInfo.requiredV3Specifiers.add('InputGroup');
    }

    // Build the TextField wrapper if any of label/description/error is present;
    // otherwise the InputGroup-wrapped input replaces the original Input.
    let replacement;
    if (hasField) {
      const fieldChildren = [j.jsxText('\n')];
      if (labelAttr) {
        fieldChildren.push(
          buildElement(j, 'Label', [], [attrValueToChild(j, labelAttr.value)], false)
        );
        fieldChildren.push(j.jsxText('\n'));
        importInfo.requiredV3Specifiers.add('Label');
      }
      fieldChildren.push(inputSlot);
      fieldChildren.push(j.jsxText('\n'));
      if (descriptionAttr) {
        fieldChildren.push(
          buildElement(
            j,
            'Description',
            [],
            [attrValueToChild(j, descriptionAttr.value)],
            false
          )
        );
        fieldChildren.push(j.jsxText('\n'));
        importInfo.requiredV3Specifiers.add('Description');
      }
      if (errorAttr) {
        fieldChildren.push(
          buildElement(
            j,
            'FieldError',
            [],
            [attrValueToChild(j, errorAttr.value)],
            false
          )
        );
        fieldChildren.push(j.jsxText('\n'));
        importInfo.requiredV3Specifiers.add('FieldError');
      }
      replacement = buildElement(j, 'TextField', [], fieldChildren, false);
      importInfo.requiredV3Specifiers.add('TextField');
    } else {
      replacement = inputSlot;
    }

    if (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) {
      const idx = parent.children.indexOf(node);
      if (idx >= 0) parent.children.splice(idx, 1, replacement);
    } else {
      path.replace(replacement);
    }

    emitAutoRestructure(
      ctx,
      path,
      'Input',
      hasField
        ? 'wrapped in <TextField> with Label/Description/FieldError siblings.'
        : 'wrapped in <InputGroup> with Prefix/Suffix siblings.'
    );
  });
}

module.exports = {
  applyStructuralRewrites,
};
