import type { TransactionDetail } from "ynab"
import { Transaction } from "./Transaction";
import { Table, TableCell, TableHeaderCell, TableRow } from "./Table";

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
        <TableRow>
          <TableHeaderCell>Selected</TableHeaderCell>
          <TableHeaderCell>Date</TableHeaderCell>
          <TableHeaderCell>Payee</TableHeaderCell>
          <TableHeaderCell>Category</TableHeaderCell>
          <TableHeaderCell>Memo</TableHeaderCell>
          <TableHeaderCell>Outflow</TableHeaderCell>
          <TableHeaderCell>Inflow</TableHeaderCell>
        </TableRow>
      </thead>
      <tbody>
        {transactions.map((transaction) =>
          <Transaction key={transaction.id} value={transaction}>
            <TableCell>
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
