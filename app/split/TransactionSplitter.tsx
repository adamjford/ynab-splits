import { useState } from "react";
import { AccountSelect, CategorySelect } from "~/components";
import { UnapprovedTransactions } from "~/components/UnapprovedTransactions";

export function TransactionSplitter() {
  const [accountId, setAccountId] = useState("");
  const [settlingUpCategoryId, setSettlingUpCategoryId] = useState("");

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
          ? <UnapprovedTransactions accountId={accountId} />
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
