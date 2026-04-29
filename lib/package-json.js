'use strict';

// Patch package.json:
//   - Bump @heroui/react to ^3.0.0 (or a user-specified target)
//   - Add @heroui/styles at the same major
//   - Remove @heroui/theme, @heroui/system, and per-component @heroui/<x>
//     packages (consolidated into @heroui/react in v3)
//   - Remove @nextui-org/* packages
//   - Optionally drop framer-motion if no source file references it
//
// Returns { changed, summary[] }.

const fs = require('fs');
const path = require('path');
const fastGlob = require('fast-glob');
const { DEFAULT_IGNORE_GLOBS } = require('./ignore');

const HEROUI_KEEP = new Set(['@heroui/react', '@heroui/styles', '@heroui/cli', '@heroui/codemod']);

function patchPackageJson(repoRoot, opts) {
  const target = opts.targetVersion || '^3.0.3';
  const dropFramerMotion = opts.dropFramerMotion !== false; // default: yes if unused
  const summary = [];

  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { changed: false, summary: ['No package.json found at ' + repoRoot] };
  }
  const original = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(original);

  let changed = false;

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[field];
    if (!deps) continue;

    // Bump / add @heroui/react and @heroui/styles
    if (deps['@heroui/react']) {
      if (deps['@heroui/react'] !== target) {
        summary.push(`${field}: @heroui/react ${deps['@heroui/react']} -> ${target}`);
        deps['@heroui/react'] = target;
        changed = true;
      }
      if (!deps['@heroui/styles']) {
        deps['@heroui/styles'] = target;
        summary.push(`${field}: added @heroui/styles ${target}`);
        changed = true;
      }
    }

    // Drop deprecated / consolidated HeroUI packages
    for (const name of Object.keys(deps)) {
      if (name.startsWith('@nextui-org/')) {
        delete deps[name];
        summary.push(`${field}: removed ${name} (NextUI legacy)`);
        changed = true;
        continue;
      }
      if (name.startsWith('@heroui/') && !HEROUI_KEEP.has(name)) {
        delete deps[name];
        summary.push(`${field}: removed ${name} (consolidated into @heroui/react in v3)`);
        changed = true;
        continue;
      }
    }
  }

  // framer-motion: drop only if no source file references it
  if (dropFramerMotion) {
    const stillReferenced = sourceReferencesPackage(repoRoot, 'framer-motion');
    if (!stillReferenced) {
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        if (pkg[field] && pkg[field]['framer-motion']) {
          delete pkg[field]['framer-motion'];
          summary.push(`${field}: removed framer-motion (no source references found; v3 doesn't need it)`);
          changed = true;
        }
      }
    } else {
      summary.push(`framer-motion kept: still imported by source files`);
    }
  }

  // @heroui/shared-icons: if any source file imports from it (the icon-split
  // transform inserts these imports), make sure it's in deps.
  const usesIcons = sourceReferencesPackage(repoRoot, '@heroui/shared-icons');
  if (usesIcons) {
    const deps = pkg.dependencies = pkg.dependencies || {};
    if (!deps['@heroui/shared-icons']) {
      deps['@heroui/shared-icons'] = '^2.1.10';
      summary.push(`dependencies: added @heroui/shared-icons ^2.1.10 (v3 doesn't re-export icons; install separately)`);
      changed = true;
    }
  }

  if (changed) {
    // Detect existing indent (default 2 spaces) and trailing newline.
    const indentMatch = original.match(/^[\{\[][\r\n]+([ \t]+)/);
    const indent = indentMatch ? indentMatch[1] : '  ';
    const trailingNl = original.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + trailingNl, 'utf8');
  }

  return { changed, summary };
}

function sourceReferencesPackage(repoRoot, pkgName) {
  const candidates = fastGlob.sync(
    ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    {
      cwd: repoRoot,
      ignore: DEFAULT_IGNORE_GLOBS,
      onlyFiles: true,
      absolute: true,
    }
  );
  const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importRe = new RegExp(`from\\s+['"]${escaped}['"]`);
  const requireRe = new RegExp(`require\\(['"]${escaped}['"]\\)`);
  for (const file of candidates) {
    try {
      const c = fs.readFileSync(file, 'utf8');
      if (importRe.test(c) || requireRe.test(c)) return true;
    } catch (_) { /* ignore */ }
  }
  return false;
}

module.exports = { patchPackageJson };
