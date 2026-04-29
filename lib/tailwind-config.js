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

// Detect a globals.css and tell the user how to add the v3 imports. We
// don't auto-edit CSS because import-order matters and we don't want to
// produce a broken file silently.
function inspectGlobalCss(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const hasTailwind = /@import\s+["']tailwindcss["']/.test(content);
  const hasStyles = /@import\s+["']@heroui\/styles["']/.test(content);
  if (hasTailwind && hasStyles) return { ok: true, warnings: [] };
  const lines = [];
  if (!hasTailwind) lines.push('@import "tailwindcss";');
  if (!hasStyles) lines.push('@import "@heroui/styles";');
  return {
    ok: false,
    warnings: [
      `${filePath}: HeroUI v3 requires the following CSS imports at the top of your global stylesheet, in this order:\n  ` +
        lines.join('\n  '),
    ],
  };
}

module.exports = { patchTailwindConfig, inspectGlobalCss };
