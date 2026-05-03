import { type HtmlHTMLAttributes } from "react";
import { type TransactionDetail, utils } from "ynab";
import { TableCell, TableRow } from "./Table";
import { useNumberFormat } from "~/context/numberFormatContext";

export interface TransactionProps extends HtmlHTMLAttributes<HTMLTableRowElement> {
  value: TransactionDetail
}

export function Transaction(props: TransactionProps) {
  const numberFormat = useNumberFormat();

  const { value } = props;

  function fmt(value: number): string {
    return numberFormat.format(
      utils.convertMilliUnitsToCurrencyAmount(value)
    )
  }

  if (value.subtransactions.length > 1) {
    return null;
  }

  return (
    <TableRow {...props}>
      {props.children}
      <TableCell className="text-nowrap">{value.date}</TableCell>
      <TableCell>{value.payee_name}</TableCell>
      <TableCell>{value.category_name}</TableCell>
      <TableCell>{value.memo}</TableCell>
      <TableCell textAlign="end">{value.amount < 0 ? fmt(-value.amount) : ""}</TableCell>
      <TableCell textAlign="end">{value.amount > 0 ? fmt(value.amount) : ""}</TableCell>
    </TableRow>
  )
}
