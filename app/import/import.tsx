import type { NewTransaction } from "ynab";
import { useState } from "react";
import { AccountSelect, CategorySelect } from "../components";
import { useYnab } from "../hooks/ynab";

export function Import() {
  const ynabApi = useYnab();

  function moneyToMilliunits(money: string): number {
    if (!money) return 0;
    return Number(money.replace(/[^0-9.-]+/g, "")) * 1000;
  }

  const [transactions, setTransactions] = useState("");
  const [settlingUpCategoryId, setSettlingUpCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setTransactions(e.target.value);
  }

  function createTransactions(e: React.SubmitEvent) {
    e.preventDefault();

    if (!transactions || !settlingUpCategoryId || !accountId) {
      return;
    }

    const stringSplitTransactions: Array<Array<string>> =
      transactions
        .split(/\r?\n/)
        .map((line) => line.split("\t"));

    const newTransactions: NewTransaction[] =
      stringSplitTransactions
        .map(function (array) {
          const totalAmount = moneyToMilliunits(array[2]);
          const amountToSettleLater = moneyToMilliunits(array[12]);

          if (!totalAmount || !amountToSettleLater) return null;

          const myShareAmount = totalAmount - amountToSettleLater;

          if (!myShareAmount) {
            // nothing to split
            return;
          }

          const transaction: NewTransaction = {
            date: new Date(array[0]).toISOString().substring(0, 10),
            amount: totalAmount,
            account_id: accountId,
            payee_name: array[1],
            memo: array[1],
            subtransactions: [
              {
                amount: myShareAmount
              },
              {
                amount: amountToSettleLater,
                category_id: settlingUpCategoryId
              }
            ]
          };

          return transaction;
        })
        .filter(n => n != null);

    console.log(newTransactions);

    if (!newTransactions) {
      return;
    }

    ynabApi.transactions.createTransactions("default", { transactions: newTransactions });
  }

  return (
    <main className="pt-16 pb-4 w-full flex flex-col items-center justify-center">
      <form className="flex flex-wrap items-center justify-center w-2/3 gap-y-20" onSubmit={createTransactions}>
        <CategorySelect
          name="settlingUpCategoryId"
          selectedCategoryId={settlingUpCategoryId}
          onChange={(e) => setSettlingUpCategoryId(e.target.value)}
          className="m-auto bg-white text-black" />

        <AccountSelect
          name="accountId"
          selectedAccountId={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="m-auto bg-white text-black" />

        <textarea
          name="transactions"
          className="bg-white text-black w-full h-100 flex-none m-auto"
          value={transactions}
          onChange={handleTextareaChange}
        />
        <button
          className="bg-gray-500 text-black m-auto"
          type="submit">
          Submit
        </button>
      </form>
    </main>
  );
}
