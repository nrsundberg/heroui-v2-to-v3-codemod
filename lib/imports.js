'use strict';

const {
  IMPORT_SOURCE_REWRITES,
  isV2HeroUISource,
  REMOVED_COMPONENTS,
  REMOVED_NAMED_EXPORTS,
  COMPONENT_RENAMES,
  SUBCOMPONENT_TO_DOT,
  HOOK_RENAMES,
  FUNCTION_RENAMES,
  looksLikeIconName,
  ICON_TARGET_PACKAGE,
} = require('./mappings');
const { attachLeadingComment, recordWarning } = require('./utils');

// Two-pass design:
//   scanImports()      — rewrites import SOURCES only, builds bindings.
//   finalizeImports()  — runs LAST, after all JSX/hook/prop transforms.
//                       Rewrites import SPECIFIERS to their v3 names,
//                       drops removed/orphaned specifiers, dedupes,
//                       consolidates multiple @heroui/react imports.

function scanImports(j, root, ctx, opts) {
  const v3Sources = new Set(opts.v3Aliases || []);
  const bindings = new Map();
  const removedImportLocals = new Set();

  root.find(j.ImportDeclaration).forEach((path) => {
    const src = path.node.source.value;
    if (typeof src !== 'string') return;

    if (v3Sources.has(src)) {
      collectBindings(path.node, src, bindings, /*isV3*/ true);
      return;
    }

    if (!isV2HeroUISource(src)) return;

    // Rewrite source path only — leave specifiers alone for now.
    let newSrc = src;
    for (const rule of IMPORT_SOURCE_REWRITES) {
      if (rule.test.test(src)) {
        newSrc = rule.to;
        break;
      }
    }
    if (newSrc !== src) {
      ctx.dirty = true;
      path.node.source.value = newSrc;
    }

    collectBindings(path.node, newSrc, bindings, /*isV3*/ false);

    // Pre-flag removed components + removed named exports at the import.
    if (path.node.specifiers) {
      for (const spec of path.node.specifiers) {
        if (spec.type !== 'ImportSpecifier') continue;
        const importedName = spec.imported && spec.imported.name;
        const localName = spec.local && spec.local.name;
        if (!importedName) continue;
        if (REMOVED_COMPONENTS[importedName]) {
          if (localName) removedImportLocals.add(localName);
          recordWarning(
            ctx,
            ctx.filePath,
            spec.loc && spec.loc.start && spec.loc.start.line,
            'removed-component-import',
            `'${importedName}' is removed in HeroUI v3. ${REMOVED_COMPONENTS[importedName]}`
          );
          attachLeadingComment(
            path.node,
            `'${importedName}' is removed in HeroUI v3. ${REMOVED_COMPONENTS[importedName]}`
          );
        }
        if (REMOVED_NAMED_EXPORTS[importedName]) {
          // Drop the specifier from finalizeImports' output and flag every
          // call site of the local binding.
          if (localName) {
            removedImportLocals.add(localName);
          }
          recordWarning(
            ctx,
            ctx.filePath,
            spec.loc && spec.loc.start && spec.loc.start.line,
            'removed-named-export',
            `'${importedName}' is removed from @heroui/react in v3. ${REMOVED_NAMED_EXPORTS[importedName]}`
          );
          attachLeadingComment(
            path.node,
            `'${importedName}' is removed from @heroui/react in v3. ${REMOVED_NAMED_EXPORTS[importedName]}`
          );
        }
        if (FUNCTION_RENAMES[importedName]) {
          // Specifier rename happens in finalizeImports; call-site rename
          // happens in calls.js. Here we just flag the API delta.
          recordWarning(
            ctx,
            ctx.filePath,
            spec.loc && spec.loc.start && spec.loc.start.line,
            'function-renamed',
            FUNCTION_RENAMES[importedName].message
          );
          attachLeadingComment(path.node, FUNCTION_RENAMES[importedName].message);
        }
      }
    }
  });

  // After source rewrites, split icon imports out of @heroui/react into a
  // sibling import from @heroui/shared-icons (v3 dropped the icon re-exports).
  splitIconImports(j, root, ctx);

  return { bindings, removedImportLocals, v3Sources };
}

function splitIconImports(j, root, ctx) {
  root.find(j.ImportDeclaration).forEach((path) => {
    const src = path.node.source.value;
    if (src !== '@heroui/react') return;
    const specs = path.node.specifiers || [];
    if (!specs.length) return;

    const iconSpecs = [];
    const keepSpecs = [];
    for (const spec of specs) {
      if (spec.type === 'ImportSpecifier') {
        const importedName = spec.imported && spec.imported.name;
        if (looksLikeIconName(importedName)) {
          iconSpecs.push(spec);
          continue;
        }
      }
      keepSpecs.push(spec);
    }
    if (iconSpecs.length === 0) return;

    path.node.specifiers = keepSpecs;
    const iconImport = j.importDeclaration(iconSpecs, j.literal(ICON_TARGET_PACKAGE));
    j(path).insertAfter(iconImport);
    ctx.dirty = true;
    for (const s of iconSpecs) {
      const importedName = s.imported && s.imported.name;
      recordWarning(
        ctx,
        ctx.filePath,
        s.loc && s.loc.start && s.loc.start.line,
        'icon-import-split',
        `'${importedName}' moved from @heroui/react to ${ICON_TARGET_PACKAGE} (v3 dropped icon re-exports). Or replace with lucide-react.`
      );
    }
  });
}

function finalizeImports(j, root, ctx, importInfo) {
  // Phase 3: normalize specifiers on @heroui/react and @heroui/styles imports.
  const importsToConsolidate = ['@heroui/react', '@heroui/styles'];
  const unusedLocals = new Set([
    ...((importInfo && importInfo.unusedLocals) || []),
    ...((importInfo && importInfo.removedImportLocals) || []),
  ]);

  root.find(j.ImportDeclaration).forEach((path) => {
    const src = path.node.source.value;
    if (typeof src !== 'string') return;
    if (!importsToConsolidate.includes(src)) return;

    const newSpecs = [];
    const seenLocals = new Set();

    for (const spec of path.node.specifiers || []) {
      if (spec.type !== 'ImportSpecifier') {
        const localName = spec.local && spec.local.name;
        if (!localName || seenLocals.has(localName)) continue;
        if (unusedLocals.has(localName)) continue;
        seenLocals.add(localName);
        newSpecs.push(spec);
        continue;
      }

      const importedName = spec.imported && spec.imported.name;
      const localName = spec.local && spec.local.name;
      if (!importedName) continue;
      if (localName && unusedLocals.has(localName)) continue; // unwrap dropped this

      // Resolve the v3 imported name + local name.
      let v3Imported = importedName;
      let v3Local = localName || importedName;

      if (HOOK_RENAMES[importedName]) {
        // Hook alias preservation: if the user aliased
        // (`import { useDisclosure as useDisc }`), hooks.js leaves the call
        // site alone — so we can keep the alias and let the new import resolve
        // to the renamed hook (`useOverlayState as useDisc`). The user still
        // calls useDisc() and the warning tells them about the API delta.
        v3Imported = HOOK_RENAMES[importedName];
        if (localName === importedName) v3Local = v3Imported;
      } else if (FUNCTION_RENAMES[importedName]) {
        // Same alias-preserving logic as HOOK_RENAMES. Call-site rewriting
        // happens in calls.js and only fires when the local name matches the
        // v2 imported name (no alias). When aliased, the import is rewritten
        // to `toast as foo` and call sites stay as `foo()`.
        v3Imported = FUNCTION_RENAMES[importedName].to;
        if (localName === importedName) v3Local = v3Imported;
      } else if (SUBCOMPONENT_TO_DOT[importedName]) {
        // Sub-component: replace with the root namespace import.
        // (e.g. CardHeader -> Card; usage was rewritten to <Card.Header/>.)
        const rootName = SUBCOMPONENT_TO_DOT[importedName].split('.')[0];
        v3Imported = rootName;
        v3Local = rootName; // alias intentionally dropped for namespace cleanliness
      } else if (COMPONENT_RENAMES[importedName]) {
        // Top-level rename. components.js always rewrites JSX to the v3 canonical
        // name (drops user aliases), so the import must also use canonical to
        // avoid an unresolved reference.
        const v3 = COMPONENT_RENAMES[importedName];
        const rootName = v3.split('.')[0];
        v3Imported = rootName;
        v3Local = rootName;
      }

      // Skip if we'd duplicate an existing local.
      if (seenLocals.has(v3Local)) continue;
      seenLocals.add(v3Local);

      // Always pass a `local` identifier so consolidate's local-name dedup
      // can see it. The recast printer prints `{ Foo }` rather than
      // `{ Foo as Foo }` when imported.name === local.name.
      const newSpec = j.importSpecifier(
        j.identifier(v3Imported),
        j.identifier(v3Local)
      );
      if (spec.importKind) newSpec.importKind = spec.importKind;
      newSpecs.push(newSpec);
    }

    if (newSpecs.length === 0 && (path.node.specifiers || []).length > 0) {
      // All specifiers dropped (e.g. only had `heroui` from @heroui/styles
      // which is no longer needed at runtime). Remove the whole import.
      j(path).remove();
      ctx.dirty = true;
      return;
    }

    if (
      JSON.stringify(newSpecs.map(specShape)) !==
      JSON.stringify((path.node.specifiers || []).map(specShape))
    ) {
      path.node.specifiers = newSpecs;
      ctx.dirty = true;
    }
  });

  consolidateImports(j, root, ctx);

  // After specifier rewrites + consolidation, fold in any extra v3 specifiers
  // that structural.js requires (e.g. TextField/Label/Description/FieldError/
  // InputGroup when an <Input label=.../> got expanded into <TextField>...).
  if (importInfo && importInfo.requiredV3Specifiers && importInfo.requiredV3Specifiers.size) {
    ensureSpecifiers(j, root, '@heroui/react', importInfo.requiredV3Specifiers);
    ctx.dirty = true;
  }
}

// Ensure each name in `names` is imported from `source`. Finds the existing
// ImportDeclaration (the first one matching `source`) and appends new
// ImportSpecifier nodes for any names not already present. If no matching
// ImportDeclaration exists, creates one at the top of the file.
function ensureSpecifiers(j, root, source, names) {
  const targetPaths = root
    .find(j.ImportDeclaration)
    .filter((p) => p.node.source && p.node.source.value === source);

  let target;
  if (targetPaths.size() === 0) {
    // Create a new import declaration at the top of the file.
    const decl = j.importDeclaration(
      Array.from(names).map((n) =>
        j.importSpecifier(j.identifier(n), j.identifier(n))
      ),
      j.literal(source)
    );
    root.get().node.program.body.unshift(decl);
    return;
  }
  target = targetPaths.at(0).get();

  const existing = new Set();
  for (const spec of target.node.specifiers || []) {
    if (spec.type !== 'ImportSpecifier') continue;
    const local = spec.local && spec.local.name;
    const imp = spec.imported && spec.imported.name;
    if (local) existing.add(local);
    if (imp) existing.add(imp);
  }

  for (const name of names) {
    if (existing.has(name)) continue;
    const spec = j.importSpecifier(j.identifier(name), j.identifier(name));
    target.node.specifiers.push(spec);
    existing.add(name);
  }
}

function specShape(s) {
  if (!s) return null;
  return [
    s.type,
    s.imported && s.imported.name,
    s.local && s.local.name,
    s.importKind || null,
  ];
}

function collectBindings(importDecl, src, bindings, isV3) {
  if (!importDecl.specifiers) return;
  for (const spec of importDecl.specifiers) {
    if (spec.type === 'ImportSpecifier') {
      const local = spec.local && spec.local.name;
      const imported = spec.imported && spec.imported.name;
      if (local) {
        // If the same local was already collected, prefer the existing binding.
        if (!bindings.has(local)) {
          bindings.set(local, {
            v2Canonical: imported || local,
            importKind: spec.importKind === 'type' ? 'type' : 'value',
            isV3: !!isV3,
            source: src,
          });
        }
      }
    } else if (spec.type === 'ImportDefaultSpecifier') {
      const local = spec.local && spec.local.name;
      if (local && !bindings.has(local)) {
        bindings.set(local, {
          v2Canonical: '*default*',
          importKind: 'default',
          isV3: !!isV3,
          source: src,
        });
      }
    } else if (spec.type === 'ImportNamespaceSpecifier') {
      const local = spec.local && spec.local.name;
      if (local && !bindings.has(local)) {
        bindings.set(local, {
          v2Canonical: '*namespace*',
          importKind: 'namespace',
          isV3: !!isV3,
          source: src,
        });
      }
    }
  }
}

function consolidateImports(j, root, ctx) {
  const bySource = new Map();
  root.find(j.ImportDeclaration).forEach((path) => {
    const src = path.node.source.value;
    if (typeof src !== 'string') return;
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(path);
  });

  for (const [src, paths] of bySource) {
    if (paths.length < 2) continue;
    if (src !== '@heroui/react' && src !== '@heroui/styles') continue;

    // Find the first NAMED-import declaration to use as the merge target.
    // Default and namespace imports must stay on their own ImportDeclarations
    // (you can't combine `* as HUI` with `{ X, Y }` in a single statement).
    const namedPaths = paths.filter((p) => {
      const specs = p.node.specifiers || [];
      if (!specs.length) return true; // empty side-effect import — fold into named
      return specs.every((s) => s.type === 'ImportSpecifier');
    });
    if (namedPaths.length < 2) continue;

    const seen = new Map();
    for (const path of namedPaths) {
      for (const spec of path.node.specifiers || []) {
        if (spec.type !== 'ImportSpecifier') continue;
        const localName = spec.local && spec.local.name;
        if (localName && !seen.has(localName)) seen.set(localName, spec);
      }
    }

    const keep = namedPaths[0];
    keep.node.specifiers = Array.from(seen.values());
    for (const path of namedPaths) {
      if (path !== keep) j(path).remove();
    }
    ctx.dirty = true;
  }
}

module.exports = { scanImports, finalizeImports };
