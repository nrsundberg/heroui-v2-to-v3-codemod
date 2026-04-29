import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react';

export const Demo = () => (
  <Table removeWrapper isCompact isHeaderSticky aria-label="demo">
    <TableHeader>
      <TableColumn key="name">Name</TableColumn>
    </TableHeader>
    <TableBody>
      <TableRow key="1">
        <TableCell>Alice</TableCell>
      </TableRow>
    </TableBody>
  </Table>
);
