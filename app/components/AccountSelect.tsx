import { useState, type ChangeEventHandler } from "react";
import type { api as YnabApi } from "ynab";
import { useYnabFetchEffect } from "~/hooks/ynab/useYnabFetchEffect";

export function AccountSelect({
  name,
  className,
  selectedAccountId,
  onChange
}: {
  name?: string,
  className?: string,
  selectedAccountId?: string,
  onChange?: ChangeEventHandler<HTMLSelectElement>
}) {
  interface Account {
    id: string;
    name: string;
  }

  const [accounts, setAccounts] = useState([] as Account[]);

  async function getAccounts(ynabApi: YnabApi): Promise<Account[]> {
    const accountsResponse = await ynabApi.accounts.getAccounts("default");
    return accountsResponse.data.accounts
      .filter(account => !account.deleted && !account.closed)
      .map(account => {
        return {
          id: account.id,
          name: account.name,
        };
      });
  }

  useYnabFetchEffect(
    getAccounts,
    setAccounts
  )

  if (!accounts) {
    return null;
  }

  return (
    <select
      name={name}
      value={selectedAccountId}
      onChange={onChange}
      className={className}>
      <option key={null} value="">-- Select an account --</option>
      {accounts.map((account) =>
        <option key={account.id} value={account.id}>{account.name}</option>
      )}
    </select>
  );
}
