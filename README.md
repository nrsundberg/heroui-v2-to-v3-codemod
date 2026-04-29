# heroui-v2-to-v3-codemod

Deterministic [jscodeshift](https://github.com/facebook/jscodeshift) codemod that migrates a React/Next.js UI directory from **HeroUI v2 → HeroUI v3**. No LLM at runtime; the entire mapping is encoded in `lib/mappings.js`.

## Why this exists

HeroUI's official v2→v3 strategy uses an MCP server + an LLM agent. The official `@heroui/codemod` only handles NextUI→HeroUI v2 (the previous rename). There is no upstream deterministic codemod for v2→v3. This is that codemod.

## Install / Run

You don't need to install anything globally — `npx` will pull this package's deps:

```bash
# Run from your repo root, point at your UI directory
npx heroui-v2-to-v3 ./src/ui

# Dry-run (print diff, write nothing)
npx heroui-v2-to-v3 --dry ./src/ui

# Multiple paths
npx heroui-v2-to-v3 ./src/ui ./src/components

# Custom v3 alias (if you're doing incremental migration with pnpm aliases)
npx heroui-v2-to-v3 --v3-aliases @heroui-next/react ./src
```

If you can't `npx` from the package, clone or download the repo and run the local CLI:

```bash
git clone <this repo> heroui-v2-to-v3-codemod
cd heroui-v2-to-v3-codemod
npm install
node bin/cli.js /path/to/your/repo/src/ui
```

You can also run the transform directly with jscodeshift:

```bash
npx jscodeshift -t ./transform.js \
  --extensions tsx,ts,jsx,js \
  --ignore-pattern '**/*.d.ts' \
  /path/to/your/repo/src/ui
```

## What it does (mechanical, automatic)

| Area | Transform |
|---|---|
| **Imports** | `@nextui-org/*` and `@heroui/<sub>` → `@heroui/react`; `@heroui/theme` → `@heroui/styles`; consolidates duplicate `@heroui/react` imports. |
| **Component renames** | `Listbox`→`ListBox`, `Divider`→`Separator`, `DateInput`→`DateField`, `TimeInput`→`TimeField`, `NumberInput`→`NumberField`, `Autocomplete`→`ComboBox`, `Progress`→`ProgressBar`, `CircularProgress`→`ProgressCircle`, `NextUIProvider`→`HeroUIProvider`, etc. |
| **Sub-components** | Flat → dot-notation: `<CardHeader>`→`<Card.Header>`, `<DropdownItem>`→`<Dropdown.Item>`, `<ModalContent>`→`<Modal.Content>`, `<PopoverTrigger>`→`<Popover.Trigger>`, `<TableHeader>`→`<Table.Header>`, `<DrawerBody>`→`<Drawer.Body>`, `<AccordionItem>`→`<Accordion.Item>`. Also the cross-component restructures: `<AutocompleteItem>` and `<SelectItem>` → `<ListBox.Item>`. |
| **Prop renames** | `onValueChange`→`onChange` on form components; `isLoading`→`isPending` on Button; `selectedKeys`/`defaultSelectedKeys`/`onSelectionChange` → `expandedKeys`/`defaultExpandedKeys`/`onExpandedChange` on Accordion; Toast `color`→`variant`; Alert `color`→`status`; Calendar `visibleMonths`→`visibleDuration`. |
| **Color values** | `color="primary"` → `color="accent"`; `color="secondary"` → flagged (removed in v3). |
| **Collection items** | Adds `id={X}` mirroring existing `key={X}` on `Dropdown.Item`, `ListBox.Item`, `SelectItem`, `AccordionItem`, `TableRow`, `TableColumn`, `Tab`. |
| **Hooks** | `useDisclosure` → `useOverlayState`. (Call site is renamed; the API delta is flagged with a `HEROUI-MIGRATE` comment because v3 returns a state object instead of `{isOpen, onOpen, ...}`.) |
| **Removed components** | `Code`, `Image`, `Navbar`, `Ripple`, `Snippet`, `Spacer`, `User`, `AvatarGroup` are flagged with `HEROUI-MIGRATE` comments and replacement guidance — left in place rather than silently broken. |
| **Removed style props** | `radius`, `shadow`, `motionProps`, `disableAnimation`, `disableRipple`, `classNames`, `isCompact`, `isStriped`, `fullWidth`, `isPressable`, etc. are dropped per-component with a `HEROUI-MIGRATE` comment so you can convert to per-part Tailwind classes. |
| **className strings** | Tailwind token renames inside `className=`: `text-tiny`→`text-xs`, `text-small`→`text-sm`, `rounded-medium`→`rounded-md`, `border-small`→`border`, etc. |
| **`tailwind.config.{js,ts}`** | Removes `heroui()`/`nextui()` plugin and the `@heroui/theme` `node_modules` content path. |
| **`globals.css`** | Inspected, not auto-edited. Reports if the `@import "tailwindcss"` and `@import "@heroui/styles"` lines are missing (order-sensitive). |

## What it does NOT do (left as `HEROUI-MIGRATE` comments)

These patterns are too risky to auto-restructure. The codemod tags every site with a `HEROUI-MIGRATE:` comment and writes a JSON report listing the file:line of every one. Grep `HEROUI-MIGRATE` after running.

- **Modal / Drawer wrappers**: v3 introduces `Modal.Backdrop` / `Modal.Container` / `Modal.Dialog` / `Modal.CloseTrigger`. Your v2 `<Modal><ModalContent>...</ModalContent></Modal>` becomes a 4-deep stack. Restructure manually.
- **Tabs splitting**: v2 `<Tab key="x" title="X">{body}</Tab>` becomes a v3 `<Tabs.Tab id="x">X</Tabs.Tab>` AND a separate `<Tabs.Panel id="x">{body}</Tabs.Panel>`. Has to be hoisted manually.
- **Tooltip / Badge content-prop pattern**: `<Tooltip content={X}>{trigger}</Tooltip>` → `<Tooltip><Tooltip.Trigger>{trigger}</Tooltip.Trigger><Tooltip.Content>{X}</Tooltip.Content></Tooltip>`.
- **`<Input label="..." description="..." errorMessage="...">`** → `<TextField><Label/><Input/><Description/><FieldError/></TextField>`.
- **`classNames={{ trigger, popover, ... }}`** slot maps → per-part `className` on each compound child.
- **`useDisclosure` consumer code**: the rename happens, but consumers using `{ isOpen, onOpen, onClose }` need to switch to the `state.open()` / `state.close()` / `state.setOpen(boolean)` pattern. Cross-file rewrites are out of scope.
- **Skeleton wrap pattern**: v2 wraps children, v3 renders Skeleton conditionally instead.
- **`Card` `isPressable` / `isHoverable`**: these props are removed; you have to wrap the card in a `<button>` or `<Link>` for press behavior.
- **Tailwind v4 upgrade itself**: this codemod removes the v2 plugin but does not run the Tailwind v3→v4 migration. Run `npx @tailwindcss/upgrade` separately.
- **Global CSS imports**: order matters (`@import "tailwindcss"` MUST come before `@import "@heroui/styles"`), so we report rather than auto-edit.
- **Theme tokens** in `tailwind.config` (e.g. `primary` → `accent`): v3 uses CSS variables / OKLCH from `@heroui/styles` instead, so config-level theme overrides usually need to be reauthored.

## Output

After running you'll find:

- Source files in your target path are mutated (or printed diffs in `--dry`).
- `./heroui-migrate-report.json` lists every warning grouped by file, with line numbers and rule IDs:

  ```json
  {
    "summary": { "totalWarnings": 23, "totalFilesWithWarnings": 5 },
    "byRule": {
      "structural-flag": 6,
      "collection-item-textvalue": 9,
      "removed-prop": 3,
      "hook-api-changed": 2,
      "removed-component-import": 1,
      "removed-component-jsx": 1,
      "removed-color-value": 1
    },
    "files": { ... }
  }
  ```

- `HEROUI-MIGRATE:` comments at every site needing manual review. Grep:

  ```bash
  rg "HEROUI-MIGRATE" src/
  ```

## Recommended workflow

1. Commit your current state (`git add -A && git commit -m "pre heroui v3 migration"`).
2. Run `npx heroui-v2-to-v3 --dry ./src/ui` to preview the diff.
3. Run `npx heroui-v2-to-v3 ./src/ui` to apply.
4. Run your formatter: `npx prettier -w ./src/ui` (jscodeshift's output formatting is mediocre).
5. Update your `package.json`: `"@heroui/react": "^3"`, drop `@heroui/theme`, add `@heroui/styles`, drop `framer-motion` if it was only there for HeroUI.
6. Update `globals.css`: add `@import "tailwindcss"; @import "@heroui/styles";` at the top, in that order.
7. Make sure you're on Tailwind v4 (`npx @tailwindcss/upgrade`).
8. `tsc --noEmit` and fix the reported errors — most will be the `HEROUI-MIGRATE` sites.
9. Run the app, click through every screen.

## Architecture

```
transform.js              jscodeshift entry; orchestrates the 4 passes.
lib/
  mappings.js             ALL v2→v3 data tables (renames, removed, props).
  parse.js                Per-file parser selection (.tsx/.ts/.jsx/.js).
  imports.js              scanImports() + finalizeImports() — split passes.
  components.js           JSX element renames + dot-notation.
  props.js                onValueChange/color/key->id/removed-style-props.
  hooks.js                useDisclosure -> useOverlayState + FIXMEs.
  tailwind-config.js      Non-jscodeshift patcher for tailwind.config.*.
  utils.js                Shared helpers (JSX comment insertion, etc).
bin/cli.js                CLI: spawns jscodeshift, patches tailwind, writes report.
```

The transform runs four passes in order:

1. `scanImports` — rewrite import SOURCES (`@heroui/theme`→`@heroui/styles`, etc.) and build a bindings map keyed by the user's original local names.
2. `rewriteHookUsages` + `rewriteJSXAttributes` — operate on JSX still in v2 form, using the bindings map to look up canonical v2 names.
3. `rewriteJSXElements` — rename JSX elements to v3 (canonical, drops user aliases for top-level renames; preserves dot-notation for sub-components).
4. `finalizeImports` — rewrite import SPECIFIERS to v3 names, drop unused, dedupe, consolidate multiple `@heroui/react` imports into one.

This split avoids the trap of mutating bindings before JSX/prop transforms can see them.

## Limitations / known sharp edges

- jscodeshift's output formatting can be ugly (extra newlines, comment placement). Always run Prettier/Biome after.
- For namespace imports (`import * as HUI from '@heroui/react'`), JSX renames work for top-level (`<HUI.Card>`) and sub-component (`<HUI.CardHeader>` → `<HUI.Card.Header>`) cases. Hooks accessed via the namespace (`HUI.useDisclosure()`) are NOT rewritten.
- `React.createElement(SomeHeroUIComponent, ...)` is not transformed.
- `const Cmp = condition ? Foo : Bar; <Cmp/>` (component-as-variable) is not transformed.
- `forwardRef`-wrapped re-exports of HeroUI components in your own code are not analyzed.
- `<Foo {...spreadProps}>` cannot have its prop renames inferred — left alone.

## Contributing / extending

The mapping table is `lib/mappings.js`. To add a new component or fix a mapping:

1. Add to `COMPONENT_RENAMES` / `SUBCOMPONENT_TO_DOT` / `COLOR_PROP_COMPONENTS` / `REMOVED_STYLE_PROPS_PER_COMPONENT` / `STRUCTURAL_FLAG_COMPONENTS` as appropriate.
2. Add a fixture in `__testfixtures__/<name>.input.tsx`.
3. Run `npm test` and visually compare the output against your expectation.

## Sources

Every mapping is sourced from the official HeroUI v3 migration docs:

- https://heroui.com/docs/react/migration
- https://heroui.com/docs/react/migration/full-migration
- https://heroui.com/docs/react/migration/hooks
- https://heroui.com/docs/react/migration/styling
- Per-component pages: `/docs/react/migration/<accordion|alert|autocomplete|...|tooltip>`
- v3.0.0 release notes: https://heroui.com/docs/react/releases/v3-0-0
- Existing official codemod (NextUI→HeroUI v2 only, used as structural template): https://github.com/heroui-inc/heroui-cli/tree/main/packages/codemod

## License

MIT
