import {
  Button,
  VisuallyHidden,
  mergeProps,
  useFocusRing,
  CalendarDate,
  type Selection,
} from '@heroui/react';

export function Demo({ items }: { items: { id: string; label: string }[] }) {
  const { focusProps, isFocusVisible } = useFocusRing();
  const date = new CalendarDate(2026, 1, 1);
  const selected: Selection = new Set();

  return (
    <Button {...mergeProps(focusProps, { 'data-focus': isFocusVisible })}>
      <VisuallyHidden>Open menu for {date.toString()}</VisuallyHidden>
    </Button>
  );
}
