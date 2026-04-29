import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, useDisclosure } from '@heroui/react';

export function MyModal() {
  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure();
  return (
    <>
      <Button onPress={onOpen}>Open</Button>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg" radius="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Confirm</ModalHeader>
              <ModalBody>Are you sure?</ModalBody>
              <ModalFooter>
                <Button color="primary" onPress={onClose}>
                  OK
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
