import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, useDisclosure } from '@heroui/react';

export function Happy() {
  const { isOpen, onOpenChange } = useDisclosure();
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg" placement="center" backdrop="blur" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>Title</ModalHeader>
        <ModalBody>Body</ModalBody>
        <ModalFooter>
          <Button>OK</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export function Bail() {
  const { isOpen, onOpenChange } = useDisclosure();
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>Title</ModalHeader>
            <ModalBody>Body</ModalBody>
            <ModalFooter>
              <Button onPress={onClose}>OK</Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export function WithCloseButton() {
  return (
    <Modal isOpen closeButton>
      <ModalContent>
        <ModalBody>Has explicit closeButton.</ModalBody>
      </ModalContent>
    </Modal>
  );
}
