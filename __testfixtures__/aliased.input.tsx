import { Autocomplete as AC, AutocompleteItem as ACI, Divider as Sep } from '@heroui/react';
import * as HUI from '@heroui/react';

export function Demo() {
  return (
    <>
      <Sep />
      <AC label="Pick" color="primary" onValueChange={(v) => v}>
        <ACI key="x">X</ACI>
      </AC>
      <HUI.Card>
        <HUI.CardHeader>Title</HUI.CardHeader>
        <HUI.CardBody>Body</HUI.CardBody>
      </HUI.Card>
    </>
  );
}
