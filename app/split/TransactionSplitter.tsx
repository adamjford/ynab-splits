import { useState } from "react";
import { AccountSelect, CategorySelect } from "~/components";
import { UnapprovedTransactions, type UnapprovedTransaction } from "~/components/UnapprovedTransactions";
import { useYnabFetchEffect } from "~/hooks/ynab/useYnabFetchEffect";
import { utils, type api as YnabApi } from "ynab";
import { useImmer } from "use-immer";
import { Wizard, useWizard } from 'react-use-wizard';
import { useNumberFormat } from "~/context/numberFormatContext";

export function TransactionSplitter() {
  const numberFormat = useNumberFormat();

  function fmt(value: number): string {
    return numberFormat.format(
      utils.convertMilliUnitsToCurrencyAmount(value)
    )
  }

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

  function spreadsheetTransactions(transactions: UnapprovedTransaction[]): string {
    return transactions
      .map((t) => [
        t.date,
        t.payee_name,
        utils.convertMilliUnitsToCurrencyAmount(-t.amount),
        "Adam"
      ])
      .map((t) => t.join("\t"))
      .join("\n")
  }

  function WizardHeader() {
    const {
      isFirstStep,
      isLastStep,
      previousStep,
      nextStep
    } = useWizard();

    return (
      <div className="flex justify-evenly w-full">
        {!isFirstStep &&
          <button
            className="basis-1"
            onClick={previousStep}>
            Previous
          </button>
        }
        {!isLastStep &&
          <button
            className="basis-1"
            onClick={nextStep}>
            Next
          </button>
        }
      </div>
    );
  }

  return (
    <main className="pt-16 pb-4 w-full flex flex-col items-center justify-center">
      <div className="flex flex-col items-center w-9/10 gap-y-10">
        <div className="flex justify-evenly w-full">
          <AccountSelect
            name="accountId"
            selectedAccountId={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="basis-1 bg-white text-black" />

          <CategorySelect
            name="settlingUpCategoryId"
            selectedCategoryId={settlingUpCategoryId}
            onChange={(e) => setSettlingUpCategoryId(e.target.value)}
            className="basis-1 bg-white text-black" />
        </div>

        {accountId && (
          <Wizard
            header={<WizardHeader />}
            wrapper={<div className="flex justify-evenly w-full" />}>
            <UnapprovedTransactions
              transactions={unapprovedTransactions}
              onTransactionSelectionChange={onTransactionSelectionChange}
            />
            <textarea
              name="spreadsheetTransactions"
              className="flex-1 h-500 w-full bg-white text-black"
              value={
                spreadsheetTransactions(
                  unapprovedTransactions.filter((t) => t.selected))}
            />
          </Wizard>
        )}
      </div>
    </main >
  );
}
