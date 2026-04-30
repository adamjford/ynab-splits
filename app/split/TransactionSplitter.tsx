import { useState } from "react";
import { AccountSelect, CategorySelect } from "~/components";
import { UnapprovedTransactions, type UnapprovedTransaction } from "~/components/UnapprovedTransactions";
import { useYnabFetchEffect } from "~/hooks/ynab/useYnabFetchEffect";
import { utils, type api as YnabApi } from "ynab";
import { useImmer } from "use-immer";
import { Wizard, useWizard } from 'react-use-wizard';
import { Button } from "~/components/Button";

export function TransactionSplitter() {
  const [accountId, setAccountId] = useState("");
  const [settlingUpCategoryId, setSettlingUpCategoryId] = useState("");
  const [isUnapprovedTransactionsLoading, setIsUnapprovedTransactionsLoading] = useState(true);
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
    setIsUnapprovedTransactionsLoading,
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

  const spreadsheetTransactionsValue =
    spreadsheetTransactions(
      unapprovedTransactions.filter((t) => t.selected));

  async function copy() {
    await navigator.clipboard.writeText(spreadsheetTransactionsValue);
  }

  function WizardHeader() {
    const {
      isFirstStep,
      isLastStep,
      previousStep,
      nextStep,
      activeStep
    } = useWizard();

    return (
      <div className="flex justify-evenly w-full">
        {!isFirstStep &&
          <Button
            onClick={previousStep}>
            Previous
          </Button>
        }
        {activeStep == 1 &&
          <Button
            type="button"
            onClick={copy}>
            Copy to clipboard
          </Button>
        }
        {!isLastStep &&
          <Button
            onClick={nextStep}>
            Next
          </Button>
        }
      </div>
    );
  }

  function SplitterWizard() {
    if (!accountId) {
      return null;
    }

    if (isUnapprovedTransactionsLoading) {
      return <span>Loading...</span>
    }

    if (!unapprovedTransactions.length) {
      return <span>No unapproved transactions found for the selected account.</span>
    }


    return (
      <Wizard
        header={<WizardHeader />}
        wrapper={<div className="flex justify-evenly w-full" />}>
        <UnapprovedTransactions
          transactions={unapprovedTransactions}
          onTransactionSelectionChange={onTransactionSelectionChange}
        />
        <textarea
          readOnly
          name="spreadsheetTransactions"
          className="w-1/2 field-sizing-content bg-white text-black"
          value={spreadsheetTransactionsValue}
        />
      </Wizard>
    )
  }

  function accountChanged(newAccountId: string) {
    setAccountId(newAccountId);
    setIsUnapprovedTransactionsLoading(true);
  }

  return (
    <main className="pt-16 pb-4 w-full flex flex-col items-center justify-center">
      <div className="flex flex-col items-center w-9/10 gap-y-10">
        <div className="flex justify-evenly w-full">
          <AccountSelect
            name="accountId"
            selectedAccountId={accountId}
            onChange={(e) => accountChanged(e.target.value)}
            className="basis-1 bg-white text-black" />

          <CategorySelect
            name="settlingUpCategoryId"
            selectedCategoryId={settlingUpCategoryId}
            onChange={(e) => setSettlingUpCategoryId(e.target.value)}
            className="basis-1 bg-white text-black" />
        </div>

        <SplitterWizard />
      </div>
    </main >
  );
}
