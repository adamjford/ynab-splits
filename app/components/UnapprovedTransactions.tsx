import type { TransactionDetail } from "ynab"
import { useState } from "react";
import type { api as YnabApi } from "ynab";
import { useYnabFetchEffect } from "~/hooks/ynab/useYnabFetchEffect";
import { Transaction } from "./Transaction";
import { Table, TableRow } from "./Table";

export interface UnapprovedTransactionsProps {
  accountId: string
}

export function UnapprovedTransactions(
  { accountId }: UnapprovedTransactionsProps
) {
  const [unapprovedTransactions, setUnapprovedTransactions] = useState([] as TransactionDetail[]);

  async function getTransactions(ynabApi: YnabApi): Promise<TransactionDetail[]> {
    const transactionsResponse = await ynabApi.transactions.getTransactionsByAccount("default", accountId);
    return transactionsResponse.data.transactions
      .filter((transaction) => !transaction.approved && !transaction.deleted);
  }

  useYnabFetchEffect(
    getTransactions,
    setUnapprovedTransactions
  )

  if (!unapprovedTransactions) {
    return <span>No unapproved transactions found.</span>;
  }

  return (
    <Table>
      <thead>
        <TableRow>
          <th>Date</th>
          <th>Payee</th>
          <th>Category</th>
          <th>Memo</th>
          <th>Outflow</th>
          <th>Inflow</th>
        </TableRow>
      </thead>
      <tbody>
        {unapprovedTransactions.map((transaction) =>
          <Transaction value={transaction} />
        )}
      </tbody>
    </Table>
  )
}
