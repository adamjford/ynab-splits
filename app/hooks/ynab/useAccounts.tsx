import { useState } from "react";
import { useYnabFetchEffect } from "./useYnabFetchEffect";
import { type Account, type api as YnabApi } from "ynab";

export function useAccounts(): Account[] {
  const [accounts, setAccounts] = useState([] as Account[]);

  async function getAccounts(ynabApi: YnabApi): Promise<Account[]> {
    const accountsResponse = await ynabApi.accounts.getAccounts("default");
    return accountsResponse.data.accounts
      .filter(account => !account.deleted && !account.closed);
  }

  useYnabFetchEffect(
    getAccounts,
    setAccounts
  )

  return accounts;
}
