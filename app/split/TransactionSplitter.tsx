import { useState } from "react";
import { AccountSelect, CategorySelect } from "~/components";
import { UnapprovedTransactions, type UnapprovedTransaction } from "~/components/UnapprovedTransactions";
import { useYnabFetchEffect } from "~/hooks/ynab/useYnabFetchEffect";
import type { api as YnabApi } from "ynab";
import { useImmer } from "use-immer";

export function TransactionSplitter() {
  const [accountId, setAccountId] = useState("");
  const [settlingUpCategoryId, setSettlingUpCategoryId] = useState("");
  const [unapprovedTransactions, setUnapprovedTransactions] = useImmer([] as UnapprovedTransaction[]);

  async function getTransactions(ynabApi: YnabApi): Promise<UnapprovedTransaction[]> {
    if (!accountId) {
      return [];
    }
    const transactionsResponse =
      await ynabApi.transactions.getTransactionsByAccount("default", accountId);
    return transactionsResponse.data.transactions
      .filter((transaction) => !transaction.approved && !transaction.deleted)
      .map((transaction) => {
        return {
          selected: true,
          ...transaction
        } as UnapprovedTransaction
      });
  }

  useYnabFetchEffect(
    getTransactions,
    setUnapprovedTransactions,
    [accountId]
  )

  function onTransactionSelectionChange(
    transaction: UnapprovedTransaction,
    newSelectedValue: boolean
  ) {
    setUnapprovedTransactions((draft) => {
      draft.find(
        (t) => t.id == transaction.id
      )!.selected = newSelectedValue;
    });
  }

  return (
    <main className="pt-16 pb-4 w-full flex flex-col items-center justify-center">
      <form className="flex flex-wrap items-center justify-center w-2/3 gap-y-20">
        <AccountSelect
          name="accountId"
          selectedAccountId={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="m-auto bg-white text-black" />

        <CategorySelect
          name="settlingUpCategoryId"
          selectedCategoryId={settlingUpCategoryId}
          onChange={(e) => setSettlingUpCategoryId(e.target.value)}
          className="m-auto bg-white text-black" />

        {accountId
          ? <UnapprovedTransactions
            transactions={unapprovedTransactions}
            onTransactionSelectionChange={onTransactionSelectionChange}
          />
          : null}

        <button
          className="bg-gray-500 text-black m-auto"
          type="submit">
          Submit
        </button>
      </form>
    </main>
  );
}
