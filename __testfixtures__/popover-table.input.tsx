import { Popover, PopoverTrigger, PopoverContent, Button } from '@heroui/react';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react';

export function Demo() {
  return (
    <>
      <Popover placement="bottom" showArrow>
        <PopoverTrigger>
          <Button>Open</Button>
        </PopoverTrigger>
        <PopoverContent>
          <div>Some content</div>
        </PopoverContent>
      </Popover>
      <Table aria-label="users" selectionMode="single" classNames={{ wrapper: 'rounded' }}>
        <TableHeader>
          <TableColumn key="name">Name</TableColumn>
          <TableColumn key="role">Role</TableColumn>
        </TableHeader>
        <TableBody>
          <TableRow key="1">
            <TableCell>Ada</TableCell>
            <TableCell>Engineer</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </>
  );
}
