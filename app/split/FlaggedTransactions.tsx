import type { TransactionDetail } from "ynab"
import { Table, TableCell, TableRow, Transaction } from "~/components";

export interface FlaggedTransaction extends TransactionDetail {
  selected: boolean;
  assignFullyToSettleUpCategory: boolean;
  alreadySplitInYnab: boolean;
}

export interface FlaggedTransactionsProps {
  transactions: FlaggedTransaction[],
  onTransactionSelectionChange: (
    transactionId: string,
    valueName: string,
    newValue: boolean) => void
}

export function FlaggedTransactions(
  {
    transactions,
    onTransactionSelectionChange
  }: FlaggedTransactionsProps
) {

  function onCheckboxOptionChange(
    transactionId: string,
    optionName: string,
    newValue: boolean
  ) {
    onTransactionSelectionChange(
      transactionId,
      optionName,
      newValue
    );
  }
  return (
    <Table>
      <thead>
        <TableRow className="bg-gray-800">
          <TableCell isHeader textAlign="center">Selected</TableCell>
          <TableCell isHeader textAlign="center">Split?</TableCell>
          <TableCell isHeader>Date</TableCell>
          <TableCell isHeader>Payee</TableCell>
          <TableCell isHeader>Category</TableCell>
          <TableCell isHeader>Memo</TableCell>
          <TableCell isHeader textAlign="end">Outflow</TableCell>
          <TableCell isHeader textAlign="end">Inflow</TableCell>
        </TableRow>
      </thead>
      <tbody>
        {transactions.map((transaction: FlaggedTransaction, index: number) =>
          <Transaction
            key={transaction.id}
            transaction={transaction}
            className={index % 2 != 0 ? "bg-gray-900" : ""}
            checkboxOptions={[
              { name: "selected", checked: transaction.selected, disabled: false },
              {
                name: "assignFullyToSettleUpCategory",
                checked: transaction.alreadySplitInYnab || transaction.assignFullyToSettleUpCategory,
                disabled: transaction.alreadySplitInYnab
              },
            ]}
            onCheckboxOptionChange={onCheckboxOptionChange} />
        )}
      </tbody>
    </Table>
  )
}
