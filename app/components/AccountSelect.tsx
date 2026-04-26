import { useEffect, useState, type ChangeEventHandler } from "react";
import { useYnab } from "../hooks/ynab";

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
  const ynabApi = useYnab();

  interface Account {
    id: string;
    name: string;
  }

  const [accounts, setAccounts] = useState([] as Account[]);

  async function getAccounts(): Promise<Account[]> {
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

  useEffect(() => {
    let ignore = false;

    function startFetching() {
      getAccounts().then((result) => {
        if (!ignore) {
          setAccounts(result);
        }
      });
    }

    startFetching();

    return () => {
      ignore = true;
    }
  }, [ynabApi]);

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
