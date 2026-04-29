#!/usr/bin/env node
'use strict';

// CLI entry: drives jscodeshift programmatically against a target directory,
// patches tailwind.config.{js,ts}, inspects globals.css, emits a JSON report.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { DEFAULT_IGNORE_GLOBS } = require('../lib/ignore');

function help() {
  console.log(
`heroui-v2-to-v3 — codemod that migrates a UI directory from HeroUI v2 to v3.

Usage:
  npx heroui-v2-to-v3 [options] <path> [<path>...]

Options:
  --dry                 Don't write changes; print a diff per file.
  --extensions <list>   File extensions to transform (default: tsx,ts,jsx,js)
  --v3-aliases <list>   Comma-separated v3-aliased import sources to LEAVE ALONE
                        (default: @heroui-v3/react,@heroui-v3/styles)
  --report <path>       Write JSON warnings to this path (default: ./heroui-migrate-report.json)
  --no-report           Don't write a JSON report.
  --no-tailwind         Don't patch tailwind.config.{js,ts}.
  --no-css-check        Don't inspect globals.css / app.css.
  --no-package          Don't patch package.json.
  --target-version <v>  HeroUI v3 version specifier (default: ^3.0.3)
  --keep-framer-motion  Don't drop framer-motion even if unreferenced.
  --jscodeshift <bin>   Path to jscodeshift binary (default: bundled).
  -h, --help            Show this help.

Examples:
  npx heroui-v2-to-v3 ./src/ui
  npx heroui-v2-to-v3 --dry ./src/components/ui
  npx heroui-v2-to-v3 --v3-aliases @heroui-next/react ./src

What it does:
  - Rewrites imports: @nextui-org/* and @heroui/<sub> -> @heroui/react;
    @heroui/theme -> @heroui/styles.
  - Renames components: Listbox->ListBox, Divider->Separator,
    DateInput->DateField, Autocomplete->ComboBox, Progress->ProgressBar,
    CircularProgress->ProgressCircle, NumberInput->NumberField, etc.
  - Expands sub-components to dot-notation: <CardHeader/> -> <Card.Header/>,
    <DropdownItem/> -> <Dropdown.Item/>, <ModalContent/> -> <Modal.Content/>,
    <PopoverTrigger/> -> <Popover.Trigger/>, <TableHeader/> -> <Table.Header/>,
    etc.
  - Renames props: onValueChange -> onChange (form components),
    isLoading -> isPending (Button), color="primary" -> color="accent",
    plus per-component renames documented at heroui.com/docs/react/migration.
  - Adds id={...} to collection items (Dropdown.Item, ListBox.Item, ...) by
    copying their existing key={...}.
  - Renames hooks: useDisclosure -> useOverlayState (and flags the API delta).
  - Drops removed style props (radius, shadow, classNames, ...) and leaves a
    HEROUI-MIGRATE comment at the call site.
  - Tags removed components (Code/Image/Navbar/Ripple/Snippet/Spacer/User/AvatarGroup)
    with HEROUI-MIGRATE comments instead of breaking them.
  - Patches tailwind.config.{js,ts}: removes the heroui()/nextui() plugin.
  - Reports globals.css if it's missing the required v3 @imports.

What it does NOT do (left as HEROUI-MIGRATE comments):
  - Modal/Drawer wrapper restructuring (new Backdrop/Container/Dialog stack).
  - Tabs splitting (Tab body -> separate Tabs.Panel).
  - Tooltip/Badge content-prop -> children restructure.
  - Skeleton wrap pattern -> conditional render.
  - <Input label="..."> -> <TextField><Label/>...</TextField> restructure.
  - classNames slot maps -> per-part className.
  - useDisclosure consumer rewrites (cross-component contract change).

Grep for 'HEROUI-MIGRATE' after running to find sites needing manual review.
A summary report is written to ./heroui-migrate-report.json.
`
  );
}

function parseArgs(argv) {
  const args = { paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (a === '--dry') { args.dry = true; continue; }
    if (a === '--no-tailwind') { args.noTailwind = true; continue; }
    if (a === '--no-css-check') { args.noCssCheck = true; continue; }
    if (a === '--no-package') { args.noPackage = true; continue; }
    if (a === '--keep-framer-motion') { args.keepFramerMotion = true; continue; }
    if (a === '--target-version') { args.targetVersion = argv[++i]; continue; }
    if (a === '--no-report') { args.noReport = true; continue; }
    if (a === '--extensions') { args.extensions = argv[++i]; continue; }
    if (a === '--v3-aliases') { args.v3Aliases = argv[++i]; continue; }
    if (a === '--report') { args.report = argv[++i]; continue; }
    if (a === '--jscodeshift') { args.jscodeshift = argv[++i]; continue; }
    if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    }
    args.paths.push(a);
  }
  return args;
}

function findJscodeshiftBin(custom) {
  if (custom) return custom;
  // Prefer the version installed in this package.
  try {
    return require.resolve('jscodeshift/bin/jscodeshift.js');
  } catch (_) {
    // Fall back to PATH (lets the user `npm i -g jscodeshift` if needed).
    return 'jscodeshift';
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.paths.length) {
    help();
    process.exit(args.help ? 0 : 2);
  }

  const transform = path.resolve(__dirname, '..', 'transform.js');
  const extensions = args.extensions || 'tsx,ts,jsx,js';
  const reportPath = args.report || path.resolve(process.cwd(), 'heroui-migrate-report.json');

  // Validate paths
  const targets = args.paths.map((p) => path.resolve(process.cwd(), p));
  for (const t of targets) {
    if (!fs.existsSync(t)) {
      console.error(`Path does not exist: ${t}`);
      process.exit(1);
    }
  }

  // Build jscodeshift invocation
  const jsArgs = [
    '-t', transform,
    '--extensions', extensions,
    '--parser', 'tsx', // overridden per-file by the transform's `parser` export
    '--ignore-pattern', '**/*.d.ts',
  ];
  for (const glob of DEFAULT_IGNORE_GLOBS) {
    jsArgs.push('--ignore-pattern', glob);
  }
  if (args.dry) jsArgs.push('--dry', '--print');
  if (args.v3Aliases) jsArgs.push('--v3-aliases=' + args.v3Aliases);
  jsArgs.push(...targets);

  const bin = findJscodeshiftBin(args.jscodeshift);
  const isJsFile = bin.endsWith('.js');
  const cmd = isJsFile ? process.execPath : bin;
  const argv = isJsFile ? [bin, ...jsArgs] : jsArgs;

  console.log(`\n→ Running jscodeshift on ${targets.length} path(s)…\n`);
  const proc = spawnSync(cmd, argv, {
    cwd: process.cwd(),
    stdio: ['ignore', 'inherit', 'pipe'],
  });

  // Tail-collect warnings sentinel'd from the worker stderr.
  const stderr = proc.stderr ? proc.stderr.toString('utf8') : '';
  const warnings = [];
  for (const line of stderr.split(/\r?\n/)) {
    const m = line.match(/__HEROUI_MIGRATE__\s+(.*)$/);
    if (!m) {
      if (line.trim()) process.stderr.write(line + '\n');
      continue;
    }
    try {
      warnings.push(JSON.parse(m[1]));
    } catch (e) {
      process.stderr.write(line + '\n');
    }
  }

  // Step 2: tailwind config
  if (!args.noTailwind) {
    const candidates = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs', 'tailwind.config.cjs'];
    for (const name of candidates) {
      const p = path.resolve(process.cwd(), name);
      if (!fs.existsSync(p)) continue;
      try {
        const { patchTailwindConfig } = require('../lib/tailwind-config');
        const r = patchTailwindConfig(p);
        if (r.changed) {
          console.log(`✓ ${name}: removed heroui()/nextui() plugin.`);
        } else {
          console.log(`· ${name}: nothing to do.`);
        }
        for (const w of r.warnings) {
          warnings.push({
            file: p,
            line: null,
            ruleId: 'tailwind-config',
            message: w,
          });
        }
      } catch (e) {
        console.error(`! Failed to patch ${name}: ${e.message}`);
      }
    }
  }

  // Step 3: globals.css inspection — covers Next.js, Vite, Remix/React-Router,
  // CRA, Astro, plus any *.css with `@import "tailwindcss"`.
  if (!args.noCssCheck) {
    const fastGlob = require('fast-glob');
    const candidatesByConvention = [
      'src/app/globals.css',
      'app/globals.css',
      'app/app.css',
      'app/tailwind.css',
      'src/styles/globals.css',
      'styles/globals.css',
      'src/index.css',
      'src/main.css',
      'src/app.css',
      'src/styles.css',
    ];
    const found = new Set();
    for (const rel of candidatesByConvention) {
      const p = path.resolve(process.cwd(), rel);
      if (fs.existsSync(p)) found.add(p);
    }
    // Plus any CSS file that already imports tailwindcss — that's the
    // file v3 needs the styles import added to.
    try {
      const cssFiles = fastGlob.sync(['**/*.css'], {
        cwd: process.cwd(),
        ignore: DEFAULT_IGNORE_GLOBS,
        onlyFiles: true,
        absolute: true,
      });
      for (const f of cssFiles) {
        try {
          const c = fs.readFileSync(f, 'utf8');
          if (/@import\s+["']tailwindcss["']/.test(c)) found.add(f);
        } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }

    for (const p of found) {
      const rel = path.relative(process.cwd(), p);
      try {
        const { inspectGlobalCss } = require('../lib/tailwind-config');
        const r = inspectGlobalCss(p, { apply: !args.dry });
        if (r.changed) {
          console.log(`✓ ${rel}: inserted @import "@heroui/styles" after @import "tailwindcss".`);
        } else if (r.ok) {
          console.log(`· ${rel}: v3 @imports already present.`);
        } else {
          for (const w of r.warnings) {
            warnings.push({
              file: p,
              line: null,
              ruleId: 'globals-css',
              message: w,
            });
            console.log(`! ${rel}: ${w.split('\n')[0]}`);
          }
        }
      } catch (e) { /* swallow */ }
    }
  }

  // Step 3b: raw CSS / SCSS token rewriting (vars, @apply, @import).
  // Skipped under the same flag as the inspector (--no-css-check).
  if (!args.noCssCheck) {
    try {
      const fastGlob = require('fast-glob');
      const { rewriteCssFile } = require('../lib/css');
      const cssFiles = fastGlob.sync(['**/*.{css,scss}'], {
        cwd: process.cwd(),
        ignore: DEFAULT_IGNORE_GLOBS,
        onlyFiles: true,
        absolute: true,
      });
      for (const f of cssFiles) {
        const rel = path.relative(process.cwd(), f);
        try {
          const r = rewriteCssFile(f, { apply: !args.dry });
          for (const w of r.warnings) {
            warnings.push({
              file: f,
              line: w.line,
              ruleId: w.ruleId,
              message: w.message,
            });
          }
          if (r.changed) {
            const total = (r.counts.vars || 0) + (r.counts.classes || 0);
            console.log(
              `✓ ${rel}: rewrote ${total} tokens (${r.counts.vars} vars, ${r.counts.classes} classes).`
            );
          }
        } catch (e) {
          console.error(`! Failed to rewrite ${rel}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`! CSS rewriter failed to start: ${e.message}`);
    }
  }

  // Step 4: package.json patching
  if (!args.noPackage) {
    try {
      const { patchPackageJson } = require('../lib/package-json');
      const r = patchPackageJson(process.cwd(), {
        targetVersion: args.targetVersion,
        dropFramerMotion: !args.keepFramerMotion,
      });
      if (r.changed) {
        console.log(`✓ package.json: patched.`);
        for (const s of r.summary) console.log(`    ${s}`);
        console.log(`    Run \`npm install\` (or pnpm/yarn) to fetch the new versions.`);
      } else if (r.summary.length) {
        for (const s of r.summary) console.log(`· package.json: ${s}`);
      } else {
        console.log(`· package.json: nothing to do.`);
      }
      for (const s of r.summary) {
        warnings.push({
          file: path.join(process.cwd(), 'package.json'),
          line: null,
          ruleId: 'package-json',
          message: s,
        });
      }
    } catch (e) {
      console.error(`! Failed to patch package.json: ${e.message}`);
    }
  }

  // Step 5: JSON report
  if (!args.noReport) {
    const grouped = {};
    for (const w of warnings) {
      const key = w.file || '<unknown>';
      grouped[key] = grouped[key] || [];
      grouped[key].push({ line: w.line, ruleId: w.ruleId, message: w.message });
    }
    const totalWarnings = warnings.length;
    const totalFiles = Object.keys(grouped).length;
    const reportObj = {
      generatedAt: new Date().toISOString(),
      tool: 'heroui-v2-to-v3-codemod',
      version: require('../package.json').version,
      summary: {
        totalWarnings,
        totalFilesWithWarnings: totalFiles,
      },
      byRule: countBy(warnings, (w) => w.ruleId),
      files: grouped,
    };
    fs.writeFileSync(reportPath, JSON.stringify(reportObj, null, 2));
    console.log(`\n→ Report: ${path.relative(process.cwd(), reportPath)}`);
    console.log(`  ${totalWarnings} warning(s) across ${totalFiles} file(s).`);
    console.log(`  Grep for 'HEROUI-MIGRATE' in your tree to find every site.`);
  }

  process.exit(proc.status || 0);
}

function countBy(arr, keyFn) {
  const out = {};
  for (const x of arr) {
    const k = keyFn(x) || '<unknown>';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

main();
