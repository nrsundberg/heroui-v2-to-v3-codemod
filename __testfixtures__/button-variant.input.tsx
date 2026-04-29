import { Button, Select, ListBox } from '@heroui/react';

export const Demo = () => (
  <div>
    <Button color="warning" onPress={() => {}}>Warn</Button>
    <Button color="danger" variant="flat">Danger Flat</Button>
    <Button color="secondary" variant="light">Secondary Light</Button>
    <Button>OK</Button>
    <Select variant="bordered" placeholder="Pick">
      <ListBox.Item key="x" id="x">X</ListBox.Item>
    </Select>
  </div>
);
