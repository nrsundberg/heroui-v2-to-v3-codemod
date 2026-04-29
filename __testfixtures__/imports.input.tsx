import { Autocomplete, AutocompleteItem } from '@heroui/react';
import { Divider } from '@heroui/react';
import { Button } from '@heroui/button';
import { Card, CardHeader, CardBody, CardFooter } from '@heroui/react';
import { Listbox, ListboxItem, ListboxSection } from '@heroui/react';
import { Progress, CircularProgress } from '@heroui/react';
import { useDisclosure } from '@heroui/react';
import { NextUIProvider } from '@nextui-org/react';
import { Spacer } from '@heroui/react';
import { heroui } from '@heroui/theme';

export function Demo() {
  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure();
  return (
    <NextUIProvider>
      <Card>
        <CardHeader>Title</CardHeader>
        <CardBody>
          <Divider />
          <Autocomplete
            label="Pick one"
            color="primary"
            onValueChange={(v) => console.log(v)}
            classNames={{ trigger: 'h-12' }}
          >
            <AutocompleteItem key="a">A</AutocompleteItem>
            <AutocompleteItem key="b">B</AutocompleteItem>
          </Autocomplete>
          <Listbox>
            <ListboxSection title="Group">
              <ListboxItem key="one">One</ListboxItem>
            </ListboxSection>
          </Listbox>
          <Progress color="primary" value={50} />
          <CircularProgress color="secondary" />
          <Spacer y={4} />
          <Button isLoading color="primary">
            Save
          </Button>
        </CardBody>
        <CardFooter>Footer</CardFooter>
      </Card>
    </NextUIProvider>
  );
}
