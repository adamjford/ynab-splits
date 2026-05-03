import type { TransactionDetail } from "ynab"
import { Table, TableCell, TableRow, Transaction } from "~/components";
import { SplitTransaction } from "~/components/SplitTransaction";

export interface TransactionsToSaveProps {
  transactions: TransactionDetail[],
}

export function TransactionsToSave({ transactions }: TransactionsToSaveProps) {
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
        {transactions.map((transaction: TransactionDetail, index: number) => {
          let className = index % 2 != 0 ? "bg-gray-900" : "";

          return transaction.subtransactions.length > 1
            ? <SplitTransaction
              key={transaction.id}
              value={transaction}
              className={className} />
            : <Transaction
              key={transaction.id}
              value={transaction}
              className={className} />
        }
        )}
      </tbody>
    </Table>
  )
}
