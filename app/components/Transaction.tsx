import { type HtmlHTMLAttributes } from "react";
import { type SubTransaction, type TransactionDetail, utils } from "ynab";
import { TableCell, TableRow } from "./Table";
import { useNumberFormat } from "~/context/numberFormatContext";

export interface TransactionProps extends HtmlHTMLAttributes<HTMLTableRowElement> {
  transaction: TransactionDetail,
  checkboxOptions?: { name: string, checked: boolean, disabled: boolean }[],
  onCheckboxOptionChange?: (
    transactionId: string,
    optionName: string,
    newValue: boolean) => void
}

export function Transaction({ transaction, checkboxOptions, onCheckboxOptionChange, ...props }: TransactionProps) {
  const numberFormat = useNumberFormat();

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

  function Subtransactions({ transaction, ...props }: TransactionProps) {
    return transaction.subtransactions.map((subtransaction: SubTransaction, index: number) => {
      const amount = subtransaction.amount;
      const outflowLocal = outflow(amount);
      const inflowLocal = inflow(amount);

      return (
        <TableRow key={`subtransaction-${index}`} {...props}>
          {checkboxOptions && checkboxOptions.map((_, index) => <TableCell key={index}></TableCell>)}
          <TableCell></TableCell>
          <TableCell>{subtransaction.payee_name}</TableCell>
          <TableCell>{subtransaction.category_name}</TableCell>
          <TableCell>{subtransaction.memo}</TableCell>
          <TableCell textAlign="end">{outflowLocal}</TableCell>
          <TableCell textAlign="end">{inflowLocal}</TableCell>
        </TableRow>);
    });
  }

  return (
    <>
      <TableRow {...props}>
        {checkboxOptions && checkboxOptions.map((option, index) =>
          <TableCell key={index} textAlign="center">
            <input
              type="checkbox"
              name={`transaction-${transaction.id}-${option.name}`}
              checked={option.checked}
              disabled={option.disabled}
              onChange={
                (e) =>
                  onCheckboxOptionChange &&
                  onCheckboxOptionChange(
                    transaction.id,
                    option.name,
                    e.target.checked)} />
          </TableCell>
        )}
        <TableCell className="text-nowrap">{transaction.date}</TableCell>
        <TableCell>{transaction.payee_name}</TableCell>
        <TableCell>{transaction.category_name}</TableCell>
        <TableCell>{transaction.memo}</TableCell>
        <TableCell textAlign="end">{outflow(transaction.amount)}</TableCell>
        <TableCell textAlign="end">{inflow(transaction.amount)}</TableCell>
      </TableRow>
      <Subtransactions transaction={transaction} {...props} />
    </>
  )
}
