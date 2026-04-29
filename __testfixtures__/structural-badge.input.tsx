import { Badge, Avatar } from '@heroui/react';

export function Demo() {
  return (
    <>
      {/* Happy path: content + single child. */}
      <Badge content="5" color="primary">
        <Avatar src="/me.png" />
      </Badge>

      {/* Happy path: content as JSX. */}
      <Badge content={<span>!</span>}>
        <Avatar />
      </Badge>

      {/* Bail: missing content. */}
      <Badge color="primary">
        <Avatar />
      </Badge>

      {/* Bail: multiple children. */}
      <Badge content="3">
        <Avatar />
        <span>extra</span>
      </Badge>
    </>
  );
}
