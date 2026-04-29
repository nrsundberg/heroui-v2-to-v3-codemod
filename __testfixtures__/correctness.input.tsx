import { Card, CardHeader, CardBody, CardFooter, Spinner, Alert, Chip, Badge, Toast, Button, Tabs, Link } from '@heroui/react';

export function Correctness() {
  return (
    <>
      <Card>
        <CardHeader>title</CardHeader>
        <CardBody>body</CardBody>
        <CardFooter>foot</CardFooter>
      </Card>

      <Spinner color="default" />
      <Spinner color="secondary" />
      <Spinner color="primary" />

      <Alert color="primary" title="t" />
      <Alert color="secondary" title="t" />

      <Chip color="secondary">x</Chip>
      <Badge color="secondary">x</Badge>

      <Toast color="error">e</Toast>
      <Toast color="info">i</Toast>
      <Toast color="primary">p</Toast>

      <Button disableAnimation disableRipple motionProps={{}} asChild={true}>x</Button>

      <Tabs hideSeparator>x</Tabs>
      <Link underline="hover">x</Link>
    </>
  );
}
