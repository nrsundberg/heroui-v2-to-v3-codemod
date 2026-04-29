import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSection, Button } from '@heroui/react';

export function Menu() {
  return (
    <Dropdown>
      <DropdownTrigger>
        <Button>Open</Button>
      </DropdownTrigger>
      <DropdownMenu aria-label="actions">
        <DropdownSection title="Files">
          <DropdownItem key="copy">Copy</DropdownItem>
          <DropdownItem key="paste">Paste</DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
}
