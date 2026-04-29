import { Tooltip, Button } from '@heroui/react';

export function Demo() {
  return (
    <>
      {/* Happy path: content + single child element. */}
      <Tooltip content="Hello world" placement="top">
        <Button>Hover me</Button>
      </Tooltip>

      {/* Happy path: content as JSX. */}
      <Tooltip content={<span>Rich</span>}>
        <Button>Hover me 2</Button>
      </Tooltip>

      {/* Bail: function-as-child. */}
      <Tooltip content="x">
        {(state) => <Button>{state}</Button>}
      </Tooltip>

      {/* Bail: missing content. */}
      <Tooltip placement="top">
        <Button>No content</Button>
      </Tooltip>
    </>
  );
}
