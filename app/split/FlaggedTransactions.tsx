import type { TransactionDetail } from "ynab"
import { Table, TableCell, TableRow, Transaction } from "~/components";

export interface FlaggedTransaction extends TransactionDetail {
  selected: boolean,
  toSplit: boolean
}

export interface FlaggedTransactionsProps {
  transactions: FlaggedTransaction[],
  onTransactionSelectionChange: (
    transactionId: string,
    valueName: "selected" | "toSplit",
    newValue: boolean) => void
}

export function FlaggedTransactions(
  {
    transactions,
    onTransactionSelectionChange
  }: FlaggedTransactionsProps
) {
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
            value={transaction}
            className={index % 2 != 0 ? "bg-gray-900" : ""}>
            <TableCell textAlign="center">
              <input
                type="checkbox"
                name={`transaction-${transaction.id}-selected`}
                checked={transaction.selected}
                onChange={
                  (e) => onTransactionSelectionChange(
                    transaction.id,
                    "selected",
                    e.target.checked)}
              />
            </TableCell>
            <TableCell textAlign="center">
              {transaction.selected && !transaction.transfer_account_id &&
                <input
                  type="checkbox"
                  name={`transaction-${transaction.id}-toSplit`}
                  checked={transaction.toSplit}
                  onChange={
                    (e) => onTransactionSelectionChange(
                      transaction.id,
                      "toSplit",
                      e.target.checked)}
                />}
            </TableCell>
          </Transaction>
        )}
      </tbody>
    </Table>
  )
}
