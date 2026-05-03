import { type HtmlHTMLAttributes } from "react";
import { type SubTransaction, type TransactionDetail, utils } from "ynab";
import { TableCell, TableRow } from "./Table";
import { useNumberFormat } from "~/context/numberFormatContext";

export interface SplitTransactionProps extends HtmlHTMLAttributes<HTMLTableRowElement> {
  value: TransactionDetail
}

export function SplitTransaction(props: SplitTransactionProps) {
  const numberFormat = useNumberFormat();

  const { value } = props;

  if (value.subtransactions.length < 2) {
    return null;
  }

  function fmt(value: number): string {
    return numberFormat.format(
      utils.convertMilliUnitsToCurrencyAmount(value)
    )
  }

  function outflow(amount: number): string {
    return amount < 0 ? fmt(-amount) : "";
  }

  function inflow(amount: number): string {
    return amount > 0 ? fmt(amount) : "";
  }

  return (
    <>
      <TableRow {...props}>
        <TableCell className="text-nowrap">{value.date}</TableCell>
        <TableCell>{value.payee_name}</TableCell>
        <TableCell>Split (Multiple Categories)...</TableCell>
        <TableCell>{value.memo}</TableCell>
        <TableCell textAlign="end">{outflow(value.amount)}</TableCell>
        <TableCell textAlign="end">{inflow(value.amount)}</TableCell>
      </TableRow>
      {value.subtransactions.map((subtransaction: SubTransaction) =>
        <TableRow {...props}>
          <TableCell></TableCell>
          <TableCell>{subtransaction.payee_name}</TableCell>
          <TableCell>{subtransaction.category_name}</TableCell>
          <TableCell>{subtransaction.memo}</TableCell>
          <TableCell textAlign="end">{outflow(subtransaction.amount)}</TableCell>
          <TableCell textAlign="end">{inflow(subtransaction.amount)}</TableCell>
        </TableRow>
      )}
    </>
  )
}
