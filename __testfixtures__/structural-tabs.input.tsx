import { Tabs, Tab } from '@heroui/react';

export function Happy() {
  return (
    <Tabs aria-label="sections">
      <Tab key="a" title="A">A body</Tab>
      <Tab key="b" title="B">B body</Tab>
    </Tabs>
  );
}

export function Bail() {
  const dynamicTitle = 'X';
  return (
    <Tabs aria-label="sections">
      <Tab key="a" title={dynamicTitle}>A body</Tab>
      <Tab key="b" title="B">B body</Tab>
    </Tabs>
  );
}
