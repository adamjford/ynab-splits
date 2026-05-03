import type { ChangeEventHandler } from "react";
import { useAccounts } from "~/hooks/ynab/useAccounts";

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
  const accounts = useAccounts();

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
