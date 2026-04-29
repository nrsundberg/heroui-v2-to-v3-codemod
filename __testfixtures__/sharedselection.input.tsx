import { Button, Select, ListBox, type SharedSelection } from '@heroui/react';

export const Demo = () => {
  const onChange = (keys: SharedSelection) => {
    console.log(keys);
  };
  return (
    <Select onSelectionChange={onChange}>
      <ListBox.Item key="a" id="a">A</ListBox.Item>
      <ListBox.Item key="b" id="b">B</ListBox.Item>
    </Select>
  );
};
