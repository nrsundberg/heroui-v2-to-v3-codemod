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
  NextUIProvider: 'HeroUIProvider', // intermediate v1->v2 rename, kept for safety
  NumberInput: 'NumberField',
  Progress: 'ProgressBar',
  Select: 'Select', // unchanged top-level, but its items move to ListBox
  SelectItem: 'ListBox.Item',
  SelectSection: 'ListBox.Section',
  TimeInput: 'TimeField',
  Tab: 'Tabs.Tab', // top-level <Tab/> usage is rare; structural transform handles the common <Tabs><Tab></Tabs>
  ToastProvider: 'Toast.Provider',
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
  CardBody: 'Card.Body',
  CardContent: 'Card.Content',
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
  Tabs: ['size', 'radius', 'disableCursorAnimation'],
  Table: ['shadow', 'radius', 'isStriped', 'isCompact', 'isHeaderSticky', 'hideHeader'],
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
];

// ---------------------------------------------------------------------------
// Components whose JSX shape requires structural rewriting we do NOT do
// automatically. We emit a HEROUI-MIGRATE comment instead.
// ---------------------------------------------------------------------------

const STRUCTURAL_FLAG_COMPONENTS = {
  Modal: 'Wrap children in <Modal.Backdrop><Modal.Container><Modal.Dialog>...; replace closeButton/hideCloseButton with <Modal.CloseTrigger/>. See https://heroui.com/docs/react/migration/modal',
  Drawer: 'Wrap children in <Drawer.Backdrop><Drawer.Container><Drawer.Dialog>... See https://heroui.com/docs/react/migration/drawer',
  Tabs: 'Split children: each <Tab title="X" key="K">{body}</Tab> becomes a <Tabs.Tab id="K">X</Tabs.Tab> in <Tabs.List> AND a separate <Tabs.Panel id="K">{body}</Tabs.Panel>. See https://heroui.com/docs/react/migration/tabs',
  Table: 'New required wrappers <Table.ScrollContainer><Table.Content>; selection/sort props move to <Table.Content>; <Checkbox slot="selection"/> must be placed manually. See https://heroui.com/docs/react/migration/table',
  Tooltip: 'Restructure children: <Tooltip content={X}>{trigger}</Tooltip> becomes <Tooltip><Tooltip.Trigger>{trigger}</Tooltip.Trigger><Tooltip.Content>{X}</Tooltip.Content></Tooltip>. See https://heroui.com/docs/react/migration/tooltip',
  Badge: 'Restructure: <Badge content={X}>{children}</Badge> becomes <Badge.Anchor>{children}<Badge>{X}</Badge></Badge.Anchor>. See https://heroui.com/docs/react/migration/badge',
  Skeleton: 'Pattern changed: <Skeleton><X/></Skeleton> while loading. v3 renders Skeleton conditionally instead of wrapping children. See https://heroui.com/docs/react/migration/skeleton',
  Alert: 'title/description/icon are now child components <Alert.Title>/<Alert.Description>/<Alert.Indicator>. color prop becomes status. See https://heroui.com/docs/react/migration/alert',
  Chip: 'startContent/endContent/avatar props removed; place as children. onClose removed; use <CloseButton/> manually. See https://heroui.com/docs/react/migration/chip',
  Avatar: 'src/name props removed; use <Avatar.Image/> + <Avatar.Fallback/>. See https://heroui.com/docs/react/migration/avatar',
  Input: 'label/description/errorMessage props removed; use <TextField><Label/><Input/><Description/><FieldError/></TextField>. startContent/endContent move to <InputGroup.Prefix/Suffix>. See https://heroui.com/docs/react/migration/input',
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

module.exports = {
  IMPORT_SOURCE_REWRITES,
  isV2HeroUISource,
  DEFAULT_V3_ALIASES,
  COMPONENT_RENAMES,
  SUBCOMPONENT_TO_DOT,
  REMOVED_COMPONENTS,
  ON_VALUE_CHANGE_COMPONENTS,
  COLOR_VALUE_REWRITES,
  COLOR_VALUES_REMOVED,
  COLOR_PROP_COMPONENTS,
  REMOVED_STYLE_PROPS_PER_COMPONENT,
  REMOVED_PROPS_UNIVERSAL,
  PROP_RENAMES_PER_COMPONENT,
  COLLECTION_ITEM_COMPONENTS,
  HOOK_RENAMES,
  REMOVED_HOOKS,
  CLASSNAME_TOKEN_REWRITES,
  STRUCTURAL_FLAG_COMPONENTS,
};
