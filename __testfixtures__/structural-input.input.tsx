import { Input } from '@heroui/react';

export function Happy() {
  return (
    <>
      <Input label="Email" description="Your email" errorMessage="Invalid" placeholder="me@x" />
      <Input label="Search" startContent="@" endContent="x" />
      <Input label="Both" description="d" errorMessage="e" startContent="$" endContent=".com" />
    </>
  );
}

export function Bail() {
  const dynamicLabel = 'L';
  return <Input label={dynamicLabel} description="d" errorMessage="e" />;
}

export function NoOp() {
  // No label/description/errorMessage/startContent/endContent — leave alone.
  return <Input placeholder="just a plain input" />;
}
