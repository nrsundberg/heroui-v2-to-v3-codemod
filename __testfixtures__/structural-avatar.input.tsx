import { Avatar } from '@heroui/react';

export function Demo() {
  return (
    <>
      {/* Happy path: src + name. */}
      <Avatar src="/me.png" name="Ada" size="lg" />

      {/* Happy path: src only. */}
      <Avatar src="/just-src.png" />

      {/* Happy path: name only. */}
      <Avatar name="Just Name" />

      {/* Bail: already has children. */}
      <Avatar src="/me.png">
        <span>custom</span>
      </Avatar>

      {/* No-op: no src/name/fallback. */}
      <Avatar size="lg" />
    </>
  );
}
