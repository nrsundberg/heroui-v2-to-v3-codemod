import { Button, useSwitch, useInput, useCheckbox, useToast, usePagination } from '@heroui/react';

export function Demo() {
  const sw = useSwitch();
  const inp = useInput();
  const cb = useCheckbox();
  const toast = useToast();
  const pg = usePagination();
  return <Button onPress={() => toast.show('hi')}>x</Button>;
}
