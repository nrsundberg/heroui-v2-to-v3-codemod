import { Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter, Button, useDisclosure } from '@heroui/react';

export function HappyExplicit() {
  const { isOpen, onOpenChange } = useDisclosure();
  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange} placement="right">
      <DrawerContent>
        <DrawerHeader>Title</DrawerHeader>
        <DrawerBody>Body</DrawerBody>
        <DrawerFooter>
          <Button>OK</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export function HappyNoPlacement() {
  const { isOpen, onOpenChange } = useDisclosure();
  // Should emit a default-placement-changed warning.
  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerBody>Default placement was 'right' in v2.</DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

export function Bail() {
  const { isOpen } = useDisclosure();
  return (
    <Drawer isOpen={isOpen}>
      <DrawerContent>
        {(onClose) => (
          <DrawerBody>render-callback - bail</DrawerBody>
        )}
      </DrawerContent>
    </Drawer>
  );
}
