import type { TransactionDetail } from "ynab"
import { Transaction } from "./Transaction";
import { Table, TableCell, TableRow } from "./Table";

export interface UnapprovedTransaction extends TransactionDetail {
  selected: boolean
}
export interface UnapprovedTransactionsProps {
  transactions: UnapprovedTransaction[],
  onTransactionSelectionChange: (unapprovedTransaction: UnapprovedTransaction, newSelectedValue: boolean) => void
}

export function UnapprovedTransactions(
  {
    transactions,
    onTransactionSelectionChange
  }: UnapprovedTransactionsProps
) {
  if (!transactions.length) {
    return <span>No unapproved transactions found.</span>;
  }

  return (
    <Table>
      <thead>
        <TableRow className="bg-gray-800">
          <TableCell isHeader textAlign="center">Selected</TableCell>
          <TableCell isHeader>Date</TableCell>
          <TableCell isHeader>Payee</TableCell>
          <TableCell isHeader>Category</TableCell>
          <TableCell isHeader>Memo</TableCell>
          <TableCell isHeader textAlign="end">Outflow</TableCell>
          <TableCell isHeader textAlign="end">Inflow</TableCell>
        </TableRow>
      </thead>
      <tbody>
        {transactions.map((transaction) =>
          <Transaction key={transaction.id} value={transaction}>
            <TableCell textAlign="center">
              <input
                type="checkbox"
                name={`transaction-${transaction.id}-selected`}
                checked={transaction.selected}
                onChange={
                  (e) => onTransactionSelectionChange(
                    transaction,
                    e.target.checked)}
              />
            </TableCell>
          </Transaction>
        )}
      </tbody>
    </Table>
  )
}
