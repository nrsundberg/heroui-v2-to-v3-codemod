import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, getKeyValue } from '@heroui/react';

export const Demo = () => (
  <Table>
    <TableHeader columns={[]}>
      {(col) => <TableColumn key={col.key}>{col.label}</TableColumn>}
    </TableHeader>
    <TableBody items={[]}>
      {(item) => (
        <TableRow key={item.id}>
          {(columnKey) => <TableCell>{getKeyValue(item, columnKey)}</TableCell>}
        </TableRow>
      )}
    </TableBody>
  </Table>
);
