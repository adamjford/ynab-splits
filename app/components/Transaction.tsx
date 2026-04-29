import { useMemo } from "react";
import { type TransactionDetail, utils } from "ynab";
import { TableCell, TableRow } from "./Table";

export interface TransactionProps {
  value: TransactionDetail
}

export function Transaction({ value }: TransactionProps) {
  const numberFormat = useMemo(
    () => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }),
    []
  );

  function fmt(value: number): string {
    return numberFormat.format(
      utils.convertMilliUnitsToCurrencyAmount(value)
    )
  }

  return (
    <TableRow key={value.id}>
      <TableCell>{value.date}</TableCell>
      <TableCell>{value.payee_name}</TableCell>
      <TableCell>{value.category_name}</TableCell>
      <TableCell>{value.memo}</TableCell>
      <TableCell>{value.amount < 0 ? fmt(-value.amount) : ""}</TableCell>
      <TableCell>{value.amount > 0 ? fmt(value.amount) : ""}</TableCell>
    </TableRow>
  )
}
