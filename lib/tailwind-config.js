'use strict';

// Patch tailwind.config.{js,ts,mjs,cjs} files: remove the heroui()/nextui()
// plugin and the corresponding require/import. This is a regex-based pass
// rather than an AST one because Tailwind config files are extremely
// regular and we want to support both plain JS and the TS form without
// loading a TS parser here.
//
// Returns { changed: boolean, warnings: string[] }.

const fs = require('fs');

function patchTailwindConfig(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  let src = original;
  const warnings = [];

  // 1. Remove `const {heroui} = require('@heroui/react' | '@heroui/theme')`
  src = src.replace(
    /^\s*const\s*\{\s*(heroui|nextui)\s*\}\s*=\s*require\(['"](?:@heroui\/(?:react|theme)|@nextui-org\/(?:react|theme))['"]\);?\s*\r?\n/gm,
    ''
  );
  // 2. Remove `import {heroui} from '@heroui/react'` etc.
  src = src.replace(
    /^\s*import\s*\{\s*(heroui|nextui)\s*\}\s*from\s*['"](?:@heroui\/(?:react|theme)|@nextui-org\/(?:react|theme))['"];?\s*\r?\n/gm,
    ''
  );

  // 3. Remove the plugin entry. We handle a few common shapes:
  //    plugins: [heroui()]
  //    plugins: [heroui({...})]
  //    plugins: [..., heroui(), ...]
  // Strategy: find `(heroui|nextui)\([^)]*\),?` and remove it; clean up
  // dangling commas afterwards.
  if (/\b(heroui|nextui)\s*\(/.test(src)) {
    src = src.replace(/\b(heroui|nextui)\s*\(([^()]|\([^()]*\))*\)\s*,?/g, '');
    // collapse `,,` and `[,` and `,]` artifacts
    src = src.replace(/,\s*,/g, ',');
    src = src.replace(/\[\s*,/g, '[');
    src = src.replace(/,\s*\]/g, ']');
    src = src.replace(/\[\s*\]/g, '[]');
  }

  // 4. content paths: HeroUI v2 docs told users to add
  //    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}". v3 doesn't
  //    need it. Strip lines mentioning that path.
  src = src.replace(
    /^\s*['"]\.\/node_modules\/@(?:heroui|nextui-org)\/[^'"]+['"]\s*,?\s*\r?\n/gm,
    ''
  );

  if (src !== original) {
    fs.writeFileSync(filePath, src, 'utf8');
    warnings.push(
      `Patched ${filePath}: removed heroui()/nextui() plugin + content path. ` +
      `If you weren't on Tailwind v4, run \`npm install -D tailwindcss@latest @tailwindcss/postcss\` and follow https://tailwindcss.com/docs/upgrade-guide.`
    );
    return { changed: true, warnings };
  }
  return { changed: false, warnings };
}

// Inspect (and optionally edit) a globals.css. v3 requires
// `@import "@heroui/styles"` directly after `@import "tailwindcss"`.
//
// If `apply` is true, we mutate the file: insert the styles import on the
// line after the tailwindcss import. If we can't find the tailwindcss import,
// we don't auto-edit (the file probably has a non-standard layering we can't
// reason about) and warn instead.
function inspectGlobalCss(filePath, opts) {
  const apply = opts && opts.apply;
  const content = fs.readFileSync(filePath, 'utf8');
  const hasTailwind = /@import\s+["']tailwindcss["']/.test(content);
  const hasStyles = /@import\s+["']@heroui\/styles["']/.test(content);
  if (hasStyles) return { ok: true, warnings: [], changed: false };

  if (!hasTailwind) {
    return {
      ok: false,
      changed: false,
      warnings: [
        `${filePath}: missing both @import "tailwindcss" and @import "@heroui/styles". HeroUI v3 needs both at the top, in this order:\n  @import "tailwindcss";\n  @import "@heroui/styles";`,
      ],
    };
  }

  // Has tailwindcss but not styles — safe to insert directly after.
  if (apply) {
    const updated = content.replace(
      /(@import\s+["']tailwindcss["'];?)\s*\n/,
      '$1\n@import "@heroui/styles";\n'
    );
    if (updated !== content) {
      fs.writeFileSync(filePath, updated, 'utf8');
      return {
        ok: true,
        changed: true,
        warnings: [`${filePath}: inserted @import "@heroui/styles" after @import "tailwindcss".`],
      };
    }
  }

  return {
    ok: false,
    changed: false,
    warnings: [
      `${filePath}: missing @import "@heroui/styles". Add it on the line after @import "tailwindcss".`,
    ],
  };
}

module.exports = { patchTailwindConfig, inspectGlobalCss };
