'use strict';

// HeroUI v2 -> v3 mapping tables.
// Sources: https://heroui.com/docs/react/migration and per-component pages
// (e.g. /migration/dropdown, /migration/modal, /migration/card, ...).
// Every entry below is mechanical; semantic restructures live in structural.js.

// ---------------------------------------------------------------------------
// Import sources
// ---------------------------------------------------------------------------

// Any import from these source-prefixes is treated as v2 HeroUI/NextUI.
// Module specifier rewrites: source -> v3 source (always @heroui/react except styles).
const IMPORT_SOURCE_REWRITES = [
  // NextUI legacy
  { test: /^@nextui-org\/react$/, to: '@heroui/react' },
  { test: /^@nextui-org\/theme$/, to: '@heroui/styles' },
  { test: /^@nextui-org\/system$/, to: '@heroui/react' },
  { test: /^@nextui-org\/use-/, to: '@heroui/react' },
  { test: /^@nextui-org\//, to: '@heroui/react' }, // catch-all for per-component packages
  // HeroUI v2 -> v3
  { test: /^@heroui\/theme$/, to: '@heroui/styles' },
  { test: /^@heroui\/system$/, to: '@heroui/react' },
  { test: /^@heroui\/use-/, to: '@heroui/react' },
  // Per-component packages collapse into @heroui/react in v3
  // (anything @heroui/<x> except @heroui/react, @heroui/styles, @heroui/cli, @heroui/codemod)
  {
    test: /^@heroui\/(?!react$|styles$|cli$|codemod$|tailwind-variants$|use-aria-)/,
    to: '@heroui/react',
  },
];

// Detect if a source looks like a v2 HeroUI/NextUI import (used to gate transforms)
function isV2HeroUISource(src) {
  if (typeof src !== 'string') return false;
  return /^@nextui-org\//.test(src) || /^@heroui\//.test(src);
}

// User-configurable list of v3-aliased sources to LEAVE ALONE.
// Defaults: @heroui-v3/react, @heroui-v3/styles (matches the official
// incremental-migration pnpm alias pattern in HeroUI's docs).
const DEFAULT_V3_ALIASES = ['@heroui-v3/react', '@heroui-v3/styles'];

// ---------------------------------------------------------------------------
// Top-level component renames (canonical name v2 -> canonical name v3)
// Source: https://heroui.com/docs/react/migration (component reference table)
// ---------------------------------------------------------------------------

const COMPONENT_RENAMES = {
  Autocomplete: 'ComboBox',
  AutocompleteSection: 'ListBox.Section',
  AutocompleteItem: 'ListBox.Item',
  CircularProgress: 'ProgressCircle',
  DateInput: 'DateField',
  Divider: 'Separator',
  Listbox: 'ListBox',
  ListboxSection: 'ListBox.Section',
  ListboxItem: 'ListBox.Item',
  NumberInput: 'NumberField',
  Progress: 'ProgressBar',
  Select: 'Select', // unchanged top-level, but its items move to ListBox
  SelectItem: 'ListBox.Item',
  SelectSection: 'ListBox.Section',
  TimeInput: 'TimeField',
  Tab: 'Tabs.Tab', // top-level <Tab/> usage is rare; structural transform handles the common <Tabs><Tab></Tabs>
  ToastProvider: 'Toast.Provider',
};

// In v2, @heroui/react re-exported icons from @heroui/shared-icons. In v3
// these re-exports were dropped. We detect any imported name ending in "Icon"
// and rewrite it to a separate import from @heroui/shared-icons. The
// shared-icons package is still published (last 2.x).
//
// Heuristic: an Identifier ending in "Icon" that isn't in our component
// renames table. False positives are rare (HeroUI components don't end in
// "Icon"), and a wrong rewrite produces an obvious "no such export" error
// at build time rather than silent breakage.
function looksLikeIconName(name) {
  if (typeof name !== 'string') return false;
  if (!/Icon$/.test(name)) return false;
  // Don't treat a component named *Icon if v3 still has it under @heroui/react.
  return true;
}
const ICON_TARGET_PACKAGE = '@heroui/shared-icons';

// Components whose JSX should be UNWRAPPED in v3: <X>{children}</X> -> children.
// HeroUI v3 deleted the top-level provider entirely; users mount components
// without any provider wrapping. NextUIProvider (v1) had already been renamed
// to HeroUIProvider in v2, so we handle both.
const UNWRAP_COMPONENTS = {
  HeroUIProvider: 'HeroUIProvider was removed in v3. Provider deleted; children kept in place. See https://heroui.com/docs/react/migration',
  NextUIProvider: 'NextUIProvider was removed in v3 (deleted in v2 as a rename to HeroUIProvider, then deleted again in v3). Provider deleted; children kept in place.',
};

// Flat sub-components -> dot-notation form. Renaming is purely textual on
// JSXElement openingElement.name; we leave imports + bindings to imports.js.
// (Many of these were never exported individually; jscodeshift just rewrites
//  the JSX tag to a JSXMemberExpression and we ensure the parent identifier
//  is imported from @heroui/react.)
const SUBCOMPONENT_TO_DOT = {
  // Accordion
  AccordionItem: 'Accordion.Item',
  // Card
  CardHeader: 'Card.Header',
  CardBody: 'Card.Content',
  CardFooter: 'Card.Footer',
  CardTitle: 'Card.Title',
  CardDescription: 'Card.Description',
  // Drawer
  DrawerContent: 'Drawer.Content',
  DrawerHeader: 'Drawer.Header',
  DrawerBody: 'Drawer.Body',
  DrawerFooter: 'Drawer.Footer',
  // Dropdown
  DropdownTrigger: 'Dropdown.Trigger',
  DropdownMenu: 'Dropdown.Menu',
  DropdownItem: 'Dropdown.Item',
  DropdownSection: 'Dropdown.Section',
  // Modal
  ModalContent: 'Modal.Content',
  ModalHeader: 'Modal.Header',
  ModalBody: 'Modal.Body',
  ModalFooter: 'Modal.Footer',
  // Navbar (removed, but rewrite for forward-compat warning)
  NavbarContent: 'Navbar.Content',
  NavbarBrand: 'Navbar.Brand',
  NavbarItem: 'Navbar.Item',
  NavbarMenu: 'Navbar.Menu',
  NavbarMenuItem: 'Navbar.MenuItem',
  NavbarMenuToggle: 'Navbar.MenuToggle',
  // Popover
  PopoverTrigger: 'Popover.Trigger',
  PopoverContent: 'Popover.Content',
  // Table
  TableHeader: 'Table.Header',
  TableColumn: 'Table.Column',
  TableBody: 'Table.Body',
  TableRow: 'Table.Row',
  TableCell: 'Table.Cell',
  // Tooltip
  TooltipTrigger: 'Tooltip.Trigger',
  TooltipContent: 'Tooltip.Content',
};

// Named exports v2 had but v3 doesn't (utility functions / type re-exports
// from @react-stately/data, etc.). The codemod removes their imports and
// leaves a HEROUI-MIGRATE comment at every call site.
const REMOVED_NAMED_EXPORTS = {
  getKeyValue: 'Removed in v3. Replace `getKeyValue(row, key)` with `(row as any)[key as string]` (or define your own typed accessor).',
  // Common v2 helpers that v3 dropped (best-effort list — not all may have
  // been used in your code; the codemod only flags what it actually finds):
  getLocalTimeZone: 'Re-exported from @internationalized/date in v2; import it from there directly in v3.',
  parseDate: 'Re-exported from @internationalized/date; import directly in v3.',
  parseTime: 'Re-exported from @internationalized/date; import directly in v3.',
  parseDateTime: 'Re-exported from @internationalized/date; import directly in v3.',
  parseAbsoluteToLocal: 'Re-exported from @internationalized/date; import directly in v3.',
  Time: 'Re-exported from @internationalized/date; import directly in v3.',
  CalendarDate: 'Re-exported from @internationalized/date; import directly in v3.',
  CalendarDateTime: 'Re-exported from @internationalized/date; import directly in v3.',
  ZonedDateTime: 'Re-exported from @internationalized/date; import directly in v3.',
  now: 'Re-exported from @internationalized/date; import directly in v3.',
  today: 'Re-exported from @internationalized/date; import directly in v3.',
  SharedSelection: 'Removed in v3. The Selection type comes from react-aria-components; import from @react-types/shared or inline the equivalent ("all" | Set<Key>).',
};

// Components that have NO v3 equivalent. We rewrite imports off them and
// leave a HEROUI-MIGRATE comment beside every JSX usage.
// Source: https://heroui.com/docs/react/migration (Removed)
const REMOVED_COMPONENTS = {
  Code: 'Use a plain <code> or <pre><code>; no v3 equivalent.',
  Image: 'Use a plain <img> or your framework Image (next/image); v3 has no <Image>.',
  Navbar: 'Removed in v3. Build navigation manually with semantic <nav> + flex/grid.',
  NavbarBrand: 'Part of removed Navbar. Build manually.',
  NavbarContent: 'Part of removed Navbar. Build manually.',
  NavbarItem: 'Part of removed Navbar. Build manually.',
  NavbarMenu: 'Part of removed Navbar. Build manually.',
  NavbarMenuItem: 'Part of removed Navbar. Build manually.',
  NavbarMenuToggle: 'Part of removed Navbar. Build manually.',
  Ripple: 'Removed in v3 (Button no longer has ripple). Delete the import + usage.',
  Snippet: 'Removed in v3. Replace with a styled <pre> + copy button.',
  Spacer: 'Removed in v3. Use a div with Tailwind spacing utility (e.g. h-4 / w-4).',
  User: 'Removed in v3. Compose with <Avatar> + flex layout.',
  AvatarGroup: 'Removed in v3. Build manually with a flex container of <Avatar>s.',
};

// ---------------------------------------------------------------------------
// Universal prop transforms
// ---------------------------------------------------------------------------

// Form components where onValueChange -> onChange.
// (We only rewrite on imports we know are HeroUI; binding-aware.)
const ON_VALUE_CHANGE_COMPONENTS = new Set([
  'Autocomplete', 'ComboBox',
  'Checkbox', 'CheckboxGroup',
  'DatePicker', 'DateRangePicker', 'DateInput', 'DateField',
  'Input', 'TextField',
  'NumberInput', 'NumberField',
  'Radio', 'RadioGroup',
  'Select',
  'Slider',
  'Switch',
  'Textarea', 'TextArea',
  'TimeInput', 'TimeField',
  'InputOtp', 'InputOTP',
]);

// Color attribute value rewrites: color="primary" -> color="accent", etc.
// Applied wherever the JSXOpeningElement is a known HeroUI component AND
// the attribute name is `color`.
// `secondary` is removed in most components — we annotate rather than guess.
const COLOR_VALUE_REWRITES = {
  primary: 'accent',
};
const COLOR_VALUES_REMOVED = new Set(['secondary']);

// Per-component overrides for color value rewrites. Consulted BEFORE the
// universal table above so component-specific quirks win.
//   Spinner: v2 `default` -> v3 `current` (inherits text color)
//   Alert:   v2 `secondary` -> v3 `default` (Alert keeps secondary semantics)
const COLOR_VALUE_REWRITES_PER_COMPONENT = {
  Spinner: { default: 'current', primary: 'accent' },
  Alert: { primary: 'accent', secondary: 'default' },
};

// Per-component overrides for removed color values. Consulted BEFORE the
// universal `COLOR_VALUES_REMOVED` set.
//   Chip/Badge: secondary has no v3 equivalent; user picks default or Tailwind.
//   Spinner:    secondary removed (no v3 spinner-secondary).
const COLOR_VALUES_REMOVED_PER_COMPONENT = {
  Spinner: new Set(['secondary']),
  Chip: new Set(['secondary']),
  Badge: new Set(['secondary']),
};

// Per-component variant value rewrites. Applied after `color`->`variant`
// rename so v2 token names get translated to v3 tokens.
//   Toast: v2 error/info -> v3 danger/accent
const VARIANT_VALUE_REWRITES_PER_COMPONENT = {
  Toast: { error: 'danger', info: 'accent' },
};

// Components that took a `color` prop in v2 (and so are candidates for color rewrites)
const COLOR_PROP_COMPONENTS = new Set([
  'Alert',
  'Autocomplete', 'ComboBox',
  'Avatar', 'AvatarGroup',
  'Badge',
  'Button', 'ButtonGroup',
  'Calendar', 'RangeCalendar',
  'Checkbox', 'CheckboxGroup',
  'Chip',
  'CircularProgress', 'ProgressCircle',
  'Code',
  'DateInput', 'DateField',
  'DatePicker', 'DateRangePicker',
  'Input', 'TextField',
  'InputOtp', 'InputOTP',
  'Link',
  'Listbox', 'ListBox',
  'NumberInput', 'NumberField',
  'Pagination',
  'Progress', 'ProgressBar',
  'Radio', 'RadioGroup',
  'Select',
  'Slider',
  'Snippet',
  'Spinner',
  'Switch',
  'Tabs',
  'Textarea', 'TextArea',
  'TimeInput', 'TimeField',
  'Toast', 'ToastProvider',
  'Tooltip',
]);

// Components where the v2 `color` prop has no v3 equivalent at all and
// must be dropped (not rewritten). v3 reroutes the concept through `variant`.
const COLOR_PROP_FULLY_REMOVED = new Set(['Button', 'ButtonGroup']);

// Per-component v2 `variant` values that no longer exist in v3.
// Drop the prop and emit a HEROUI-MIGRATE comment with v3 hints.
const VARIANT_VALUES_REMOVED_PER_COMPONENT = {
  Button: new Set(['light', 'flat', 'bordered', 'solid', 'shadow', 'faded']),
  Select: new Set(['bordered', 'flat', 'faded', 'underlined']),
  Input: new Set(['bordered', 'flat', 'faded', 'underlined']),
  TextField: new Set(['bordered', 'flat', 'faded', 'underlined']),
  Textarea: new Set(['bordered', 'flat', 'faded', 'underlined']),
  Chip: new Set(['shadow', 'dot']),
};

// Style props removed across the board — we drop them and emit a FIXME so the
// user can convert to Tailwind classes.
const REMOVED_STYLE_PROPS_PER_COMPONENT = {
  // Components where each of these props existed and is now Tailwind-only.
  // Keys are component canonical v2 names; values are removed prop names.
  Button: ['radius', 'spinner', 'spinnerPlacement', 'disableRipple', 'disableAnimation', 'startContent', 'endContent'],
  ButtonGroup: ['radius', 'disableAnimation', 'disableRipple', 'isIconOnly'],
  Card: ['shadow', 'radius', 'fullWidth', 'isHoverable', 'isPressable', 'isBlurred', 'isFooterBlurred', 'isDisabled', 'disableAnimation', 'disableRipple', 'allowTextSelectionOnPress'],
  Chip: ['radius', 'avatar', 'startContent', 'endContent', 'isDisabled'],
  Input: ['radius', 'size', 'labelPlacement', 'isClearable'],
  TextField: ['radius', 'size', 'labelPlacement', 'isClearable'],
  Textarea: ['radius', 'size', 'labelPlacement', 'isClearable'],
  Modal: ['radius', 'shadow', 'motionProps'],
  Drawer: ['size', 'radius', 'hideCloseButton', 'closeButton', 'motionProps', 'disableAnimation'],
  Tooltip: ['size', 'radius', 'shadow', 'motionProps', 'containerPadding', 'shouldFlip'],
  Popover: ['size', 'color', 'radius', 'shadow', 'backdrop', 'motionProps'],
  Avatar: ['isBordered', 'radius', 'isDisabled', 'isFocusable', 'getInitials'],
  Badge: ['shape', 'showOutline', 'disableAnimation', 'isInvisible', 'isDot'],
  Slider: ['size', 'radius'],
  Skeleton: ['isLoaded'],
  Pagination: ['variant', 'radius', 'siblings', 'boundaries', 'dotsJump', 'loop', 'showControls'],
  Tabs: ['size', 'radius', 'disableCursorAnimation', 'hideSeparator'],
  Link: ['underline'],
  Table: ['shadow', 'radius', 'isStriped', 'isCompact', 'isHeaderSticky', 'hideHeader', 'removeWrapper'],
  Spinner: ['variant', 'labelColor'],
  Accordion: ['isCompact', 'hideIndicator', 'disableAnimation', 'motionProps', 'showDivider', 'dividerProps', 'keepContentMounted'],
  Listbox: ['variant'],
  ListBox: ['variant'],
};

// Nearly-universal removed props — applied when the element is in
// COLOR_PROP_COMPONENTS or otherwise looks like a HeroUI form component.
const REMOVED_PROPS_UNIVERSAL = new Set([
  'classNames', // slot map; needs human review
]);

// Additional props removed from EVERY HeroUI v3 component (introduced across
// betas 3-7). Applied in the same loop as REMOVED_PROPS_UNIVERSAL but only
// to nodes we recognize as HeroUI components (color/structural/per-component
// removed-style maps).
const REMOVED_PROPS_UNIVERSAL_EXTRA = new Set([
  'asChild', // removed in beta.3
  'isInSurface', // removed in beta.4 from form components
  'motionProps', // v3 uses native CSS transitions
  'disableAnimation',
  'disableRipple',
]);

// Renamed props per component. Always applied conditionally on binding.
const PROP_RENAMES_PER_COMPONENT = {
  Button: { isLoading: 'isPending' },
  Accordion: {
    selectedKeys: 'expandedKeys',
    defaultSelectedKeys: 'defaultExpandedKeys',
    onSelectionChange: 'onExpandedChange',
  },
  Calendar: { visibleMonths: 'visibleDuration' /* note: type changed to {months: n}; flagged */ },
  RangeCalendar: { visibleMonths: 'visibleDuration' },
  Tabs: { isVertical: 'orientation' /* boolean -> 'horizontal'|'vertical'; flagged */ },
  Toast: { color: 'variant' },
  Alert: { color: 'status' },
};

// Collection-item components: v2 used `key=` for both React reconciliation
// AND collection identity. v3 splits: keep `key`, ADD `id` (and `textValue`).
// We add `id={...}` mirroring the existing `key={...}` and emit a FIXME
// asking the user to confirm `textValue` if children aren't a string literal.
const COLLECTION_ITEM_COMPONENTS = new Set([
  'AutocompleteItem', 'ComboBoxItem',
  'DropdownItem',
  'ListboxItem', 'ListBoxItem',
  'SelectItem',
  'AccordionItem',
  'TableRow', 'TableColumn',
  'Tab',
]);

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

// Hook renames + removals. Source: /docs/react/migration/hooks
const HOOK_RENAMES = {
  useDisclosure: 'useOverlayState',
};

// These hooks are removed entirely. We leave the import as-is but emit a
// HEROUI-MIGRATE comment at the call site.
const REMOVED_HOOKS = {
  useSwitch: 'Replaced by compound <Switch.Control><Switch.Thumb/></Switch.Control>.',
  useInput: 'Replaced by compound <TextField><Input/></TextField>.',
  useCheckbox: 'Replaced by compound <Checkbox.Control><Checkbox.Indicator/></Checkbox.Control>.',
  useRadio: 'Replaced by compound <Radio.Control><Radio.Indicator/></Radio.Control>.',
  useDraggable: 'Removed in v3 with no replacement.',
  useClipboard: 'Removed in v3 with no replacement; use navigator.clipboard directly.',
  usePagination: 'Removed in v3 with no replacement; build manually with <Pagination.*> compound.',
  useToast: 'Removed in v3; use the module-scoped toast() function from @heroui/react.',
};

// ---------------------------------------------------------------------------
// CSS / className value rewrites (for className strings inside JSX attributes)
// Source: /docs/react/migration/styling
// ---------------------------------------------------------------------------

const CLASSNAME_TOKEN_REWRITES = [
  // text sizing
  { from: /\btext-tiny\b/g, to: 'text-xs' },
  { from: /\btext-small\b/g, to: 'text-sm' },
  { from: /\btext-medium\b/g, to: 'text-base' },
  { from: /\btext-large\b/g, to: 'text-lg' },
  // radius
  { from: /\brounded-small\b/g, to: 'rounded-sm' },
  { from: /\brounded-medium\b/g, to: 'rounded-md' },
  { from: /\brounded-large\b/g, to: 'rounded-lg' },
  // borders
  { from: /\bborder-small\b/g, to: 'border' },
  { from: /\bborder-medium\b/g, to: 'border-2' },
  { from: /\bborder-large\b/g, to: 'border-[3px]' },
  // transitions removed
  { from: /\btransition-background\b/g, to: 'transition-colors' },
  { from: /\btransition-colors-opacity\b/g, to: 'transition-colors' },
  // shadow scale (NOT covered by the color-prefix loop below — these are
  // size aliases, not color tokens).
  { from: /\bshadow-small\b/g, to: 'shadow-sm' },
  { from: /\bshadow-medium\b/g, to: 'shadow-md' },
  { from: /\bshadow-large\b/g, to: 'shadow-lg' },
  // removed utilities replaced with arbitrary-value equivalents
  { from: /\bleading-inherit\b/g, to: 'leading-[inherit]' },
  { from: /\btap-highlight-transparent\b/g, to: '[-webkit-tap-highlight-color:transparent]' },
];

// Programmatically extend with color-prefix token rewrites. v3 renamed:
//   primary -> accent
//   divider -> separator
//   content1/2/3 -> surface/surface-secondary/surface-tertiary
//
// Trade-off note: every numeric primary-* tier (50..900) collapses to
// `<prefix>-accent-soft`. v3's accent palette is much smaller (accent /
// accent-soft / accent-hover) so we pick the safest single target. A
// follow-up sweep can manually retune hover-tier classes (600/700) to
// `accent-hover`. We don't try to guess automatically.
const COLOR_PREFIXES = [
  'bg', 'text', 'border', 'ring', 'divide', 'outline', 'fill', 'stroke',
  'from', 'via', 'to', 'accent', 'caret', 'decoration', 'placeholder', 'shadow',
];
const NUMERIC_TIERS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];

for (const p of COLOR_PREFIXES) {
  // Numeric tiers MUST come before the bare `-primary` rule, otherwise
  // `\b<prefix>-primary\b` matches inside `<prefix>-primary-500` (because
  // the `-` between `primary` and `500` is a word boundary) and rewrites
  // it to `<prefix>-accent-500` before the tier rule can fire.
  for (const t of NUMERIC_TIERS) {
    CLASSNAME_TOKEN_REWRITES.push({
      from: new RegExp(`\\b${p}-primary-${t}\\b`, 'g'),
      to: `${p}-accent-soft`,
    });
  }
  // primary -> accent (literal, no tier)
  CLASSNAME_TOKEN_REWRITES.push({
    from: new RegExp(`\\b${p}-primary\\b(?!-)`, 'g'),
    to: `${p}-accent`,
  });
  // divider -> separator
  CLASSNAME_TOKEN_REWRITES.push({
    from: new RegExp(`\\b${p}-divider\\b`, 'g'),
    to: `${p}-separator`,
  });
  // content{1,2,3} -> surface[/-secondary/-tertiary]
  CLASSNAME_TOKEN_REWRITES.push({
    from: new RegExp(`\\b${p}-content1\\b`, 'g'),
    to: `${p}-surface`,
  });
  CLASSNAME_TOKEN_REWRITES.push({
    from: new RegExp(`\\b${p}-content2\\b`, 'g'),
    to: `${p}-surface-secondary`,
  });
  CLASSNAME_TOKEN_REWRITES.push({
    from: new RegExp(`\\b${p}-content3\\b`, 'g'),
    to: `${p}-surface-tertiary`,
  });
}

// Class-name tokens that we don't auto-rewrite. The scanner reports each
// occurrence as a `removed-className-token` warning so the user can fix
// them manually.
const CLASSNAME_TOKEN_FLAGGED = [];

// content4 has no v3 equivalent; the user must pick a surface tier or a
// raw color manually.
for (const p of COLOR_PREFIXES) {
  CLASSNAME_TOKEN_FLAGGED.push({
    from: new RegExp(`\\b${p}-content4\\b`, 'g'),
    message: `${p}-content4 has no v3 equivalent — pick a surface tier or raw color manually.`,
  });
  // secondary palette is removed in v3.
  // The bare-`secondary` rule uses a negative lookahead to avoid
  // double-flagging tier classes like `text-secondary-500`.
  CLASSNAME_TOKEN_FLAGGED.push({
    from: new RegExp(`\\b${p}-secondary\\b(?!-)`, 'g'),
    message: `${p}-secondary: the secondary palette is removed in v3 — replace with an explicit color.`,
  });
  for (const t of NUMERIC_TIERS) {
    CLASSNAME_TOKEN_FLAGGED.push({
      from: new RegExp(`\\b${p}-secondary-${t}\\b`, 'g'),
      message: `${p}-secondary-${t}: the secondary palette is removed in v3 — replace with an explicit color.`,
    });
  }
}

// scrollbar-hide / scrollbar-default were ambient utilities in v2; v3 ships
// no equivalent. The user must add a Tailwind plugin (e.g.
// tailwind-scrollbar-hide) and reapply the class.
CLASSNAME_TOKEN_FLAGGED.push({
  from: /\bscrollbar-hide\b/g,
  message: 'scrollbar-hide is no longer bundled in v3 — install a Tailwind plugin (e.g. tailwind-scrollbar-hide) or write a custom utility.',
});
CLASSNAME_TOKEN_FLAGGED.push({
  from: /\bscrollbar-default\b/g,
  message: 'scrollbar-default is no longer bundled in v3 — install a Tailwind plugin or write a custom utility.',
});

// ---------------------------------------------------------------------------
// Components whose JSX shape requires structural rewriting we do NOT do
// automatically. We emit a HEROUI-MIGRATE comment instead.
// ---------------------------------------------------------------------------

const STRUCTURAL_FLAG_COMPONENTS = {
  Table: 'New required wrappers <Table.ScrollContainer><Table.Content>; selection/sort props move to <Table.Content>; <Checkbox slot="selection"/> must be placed manually. See https://heroui.com/docs/react/migration/table',
  Skeleton: 'Pattern changed: <Skeleton><X/></Skeleton> while loading. v3 renders Skeleton conditionally instead of wrapping children. See https://heroui.com/docs/react/migration/skeleton',
  Alert: 'title/description/icon are now child components <Alert.Title>/<Alert.Description>/<Alert.Indicator>. color prop becomes status. See https://heroui.com/docs/react/migration/alert',
  Chip: 'startContent/endContent/avatar props removed; place as children. onClose removed; use <CloseButton/> manually. See https://heroui.com/docs/react/migration/chip',
  TextField: 'label/description/errorMessage props removed; lift to <Label/>, <Description/>, <FieldError/> children. See https://heroui.com/docs/react/migration/input',
  Select: 'selectedKeys/onSelectionChange become value/onChange; SelectItem moves to ListBox.Item; new wrappers Select.Trigger/Value/Indicator/Popover. See https://heroui.com/docs/react/migration/select',
  Autocomplete: 'Renamed to ComboBox; AutocompleteItem -> ListBox.Item; label/description -> child <Label>/<Description>. See https://heroui.com/docs/react/migration/autocomplete',
  ComboBox: 'See https://heroui.com/docs/react/migration/autocomplete',
  Card: 'isPressable/isHoverable/isBlurred removed; wrap in <button>/<Link> manually for press behavior. See https://heroui.com/docs/react/migration/card',
  Pagination: 'Becomes fully compositional: <Pagination.Previous/><Pagination.Item/><Pagination.Next/>. total/page/siblings props removed. See https://heroui.com/docs/react/migration/pagination',
  Calendar: 'visibleMonths -> visibleDuration={{months: n}}; topContent/bottomContent become children. See https://heroui.com/docs/react/migration/calendar',
  RangeCalendar: 'See https://heroui.com/docs/react/migration/range-calendar',
  DatePicker: 'Composition-based; selectorIcon/calendarProps/popoverProps eliminated. See https://heroui.com/docs/react/migration/date-picker',
  DateRangePicker: 'See https://heroui.com/docs/react/migration/date-range-picker',
  Toast: 'ToastProvider -> Toast.Provider; useToast removed; use module-scoped toast(). variants renamed (error -> danger). See https://heroui.com/docs/react/migration/toast',
  Form: 'Largely unchanged; new onInvalid handler available.',
};

// CSS-only token rewrites: variable names + apply-directive class names.
// Boundary note: \b doesn't fire between two non-word chars, so a literal
// `\b--primary\b` never matches. We use lookarounds against [\w-] to mean
// "not preceded/followed by another identifier char or hyphen", which keeps
// `--primary` distinct from `--primary-foreground` and `--primary-something`.
const CSS_VAR_REWRITES = [
  { from: /(?<![\w-])--primary(?![\w-])/g, to: '--accent', ruleId: 'css-var-rewrite' },
  { from: /(?<![\w-])--primary-foreground(?![\w-])/g, to: '--accent-foreground', ruleId: 'css-var-rewrite' },
  { from: /(?<![\w-])--divider(?![\w-])/g, to: '--separator', ruleId: 'css-var-rewrite' },
  { from: /(?<![\w-])--panel(?![\w-])/g, to: '--surface', ruleId: 'css-var-rewrite' },
  { from: /(?<![\w-])--surface-1(?![\w-])/g, to: '--surface-secondary', ruleId: 'css-var-rewrite' },
  { from: /(?<![\w-])--surface-2(?![\w-])/g, to: '--surface-tertiary', ruleId: 'css-var-rewrite' },
  { from: /(?<![\w-])--skeleton-default-animation-type(?![\w-])/g, to: '--skeleton-animation', ruleId: 'css-var-rewrite' },
];
const CSS_VAR_FLAGGED = [
  { from: /(?<![\w-])--surface-3(?![\w-])/g, message: '--surface-3 collapsed in v3 via color-mix.', ruleId: 'css-var-flagged' },
  { from: /(?<![\w-])--secondary[a-z0-9-]*(?![\w-])/g, message: 'secondary token removed in v3; pick default/accent/etc.', ruleId: 'css-var-flagged' },
];

// Components that have an automated structural rewrite in lib/structural.js
// AND a fallback recipe for cases too complex to auto-rewrite. The structural
// transforms consult this table when they bail, so users still get the manual
// recipe at the JSX site.
const STRUCTURAL_FALLBACK_COMPONENTS = {
  Modal: 'Wrap children in <Modal.Backdrop><Modal.Container><Modal.Dialog>...; isOpen/onOpenChange/isDismissable/isKeyboardDismissDisabled/backdrop (renamed variant) move to <Modal.Backdrop>; placement/size/scrollBehavior (renamed scroll) move to <Modal.Container>; replace closeButton/hideCloseButton with <Modal.CloseTrigger/>. See https://heroui.com/docs/react/migration/modal',
  Drawer: 'Wrap children in <Drawer.Backdrop><Drawer.Container><Drawer.Dialog>...; isOpen/onOpenChange/isDismissable/isKeyboardDismissDisabled/backdrop (renamed variant) move to <Drawer.Backdrop>; placement/size/scrollBehavior (renamed scroll) move to <Drawer.Container>. See https://heroui.com/docs/react/migration/drawer',
  Tabs: 'Split children: each <Tab title="X" key="K">{body}</Tab> becomes a <Tabs.Tab id="K">X</Tabs.Tab> in <Tabs.List> AND a separate <Tabs.Panel id="K">{body}</Tabs.Panel>. See https://heroui.com/docs/react/migration/tabs',
  Tooltip: 'Restructure children: <Tooltip content={X}>{trigger}</Tooltip> becomes <Tooltip><Tooltip.Trigger>{trigger}</Tooltip.Trigger><Tooltip.Content>{X}</Tooltip.Content></Tooltip>. See https://heroui.com/docs/react/migration/tooltip',
  Badge: 'Restructure: <Badge content={X}>{children}</Badge> becomes <Badge.Anchor>{children}<Badge>{X}</Badge></Badge.Anchor>. See https://heroui.com/docs/react/migration/badge',
  Avatar: 'src/name props removed; use <Avatar.Image/> + <Avatar.Fallback/>. See https://heroui.com/docs/react/migration/avatar',
  Input: 'label/description/errorMessage props removed; use <TextField><Label/><Input/><Description/><FieldError/></TextField>. startContent/endContent move to <InputGroup.Prefix/Suffix>. See https://heroui.com/docs/react/migration/input',
};

module.exports = {
  IMPORT_SOURCE_REWRITES,
  isV2HeroUISource,
  DEFAULT_V3_ALIASES,
  COMPONENT_RENAMES,
  SUBCOMPONENT_TO_DOT,
  UNWRAP_COMPONENTS,
  looksLikeIconName,
  ICON_TARGET_PACKAGE,
  REMOVED_NAMED_EXPORTS,
  REMOVED_COMPONENTS,
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
  HOOK_RENAMES,
  REMOVED_HOOKS,
  CLASSNAME_TOKEN_REWRITES,
  CLASSNAME_TOKEN_FLAGGED,
  STRUCTURAL_FLAG_COMPONENTS,
  STRUCTURAL_FALLBACK_COMPONENTS,
  CSS_VAR_REWRITES,
  CSS_VAR_FLAGGED,
};
