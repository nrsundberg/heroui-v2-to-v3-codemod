import { HeroUIProvider, Button } from '@heroui/react';
import { Outlet } from 'react-router';

export default function Root() {
  return (
    <html lang="en">
      <body>
        <HeroUIProvider>
          <Outlet />
          <Button>Hi</Button>
        </HeroUIProvider>
      </body>
    </html>
  );
}
