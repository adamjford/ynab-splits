import type { TransactionDetail } from "ynab"
import { Table, TableCell, TableRow } from "~/components";
import { SplitTransaction } from "~/components/SplitTransaction";

export interface SplitTransactionsProps {
  transactions: TransactionDetail[],
}

export function SplitTransactions({ transactions }: SplitTransactionsProps) {
  if (!transactions.length) {
    return <span>No transactions to split.</span>;
  }

  return (
    <Table>
      <thead>
        <TableRow className="bg-gray-800">
          <TableCell isHeader>Date</TableCell>
          <TableCell isHeader>Payee</TableCell>
          <TableCell isHeader>Category</TableCell>
          <TableCell isHeader>Memo</TableCell>
          <TableCell isHeader textAlign="end">Outflow</TableCell>
          <TableCell isHeader textAlign="end">Inflow</TableCell>
        </TableRow>
      </thead>
      <tbody>
        {transactions.map((transaction: TransactionDetail, index: number) =>
          <SplitTransaction
            key={transaction.id}
            value={transaction}
            className={index % 2 != 0 ? "bg-gray-900" : ""} />
        )}
      </tbody>
    </Table>
  )
}
