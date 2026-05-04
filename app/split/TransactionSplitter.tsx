import { useState } from "react";
import { Wizard, useWizard } from 'react-use-wizard';
import { useImmer } from "use-immer";
import { utils, type PatchTransactionsWrapper, type SubTransaction, type TransactionDetail, type api as YnabApi } from "ynab";
import { AccountSelect, CategorySelect } from "~/components";
import { Button } from "~/components/Button";
import { useYnabApi } from "~/hooks/ynab";
import { useYnabFetchEffect } from "~/hooks/ynab/useYnabFetchEffect";
import { TransactionsToSave } from "./TransactionsToSave";
import { FlaggedTransactions, type FlaggedTransaction } from "./FlaggedTransactions";
import { useAccounts } from "~/hooks/ynab/useAccounts";

export function TransactionSplitter() {
  const ynabApi = useYnabApi();
  const accounts = useAccounts();

  const onBudgetAccounts = accounts.filter((a) => a.on_budget);

  const [accountId, setAccountId] = useState("");
  const [settlingUpCategory, setSettlingUpCategory] =
    useState({ id: "", name: "" });
  const [isFlaggedTransactionsLoading, setIsFlaggedTransactionsLoading] =
    useState(true);
  const [flaggedTransactions, setFlaggedTransactions] =
    useImmer([] as FlaggedTransaction[]);
  const [flaggedTransactionsRefreshKey, setFlaggedTransactionsRefreshKey] =
    useImmer(0);

  async function getTransactions(ynabApi: YnabApi): Promise<FlaggedTransaction[]> {
    if (!accountId) {
      return [];
    }

    const transactionsResponse =
      await ynabApi.transactions.getTransactionsByAccount(
        "default",
        accountId
      );

    return transactionsResponse.data.transactions
      .filter((transaction) =>
        !transaction.deleted &&
        (!transaction.transfer_account_id ||
          onBudgetAccounts.every((a) => transaction.transfer_account_id != a.id)) &&
        transaction.flag_color == "green" &&
        transaction.subtransactions.length < 2)
      .map((transaction) => {
        return {
          selected: true,
          toSplit: transaction.category_id != settlingUpCategory.id,
          ...transaction
        } as FlaggedTransaction
      });
  }

  useYnabFetchEffect(
    getTransactions,
    setFlaggedTransactions,
    setIsFlaggedTransactionsLoading,
    [accountId, settlingUpCategory.id, flaggedTransactionsRefreshKey]
  )

  function onTransactionSelectionChange(
    transactionId: string,
    valueName: "selected" | "toSplit",
    newValue: boolean
  ) {
    setFlaggedTransactions((draft) => {
      const draftTransaction = draft.find(
        (t) => t.id == transactionId
      )!;

      if (valueName == "selected") {
        draftTransaction.selected = newValue;
      }

      if (valueName == "toSplit") {
        draftTransaction.toSplit = newValue;
      }
    });
  }

  function selectedTransactions(): FlaggedTransaction[] {
    return (
      flaggedTransactions
        .filter((t) => t.selected));
  }

  function transactionToSave(): TransactionDetail[] {
    return flaggedTransactions.map((t: FlaggedTransaction) => {
      let transaction = t as TransactionDetail;

      let {
        id,
        category_id,
        category_name,
        subtransactions,
      } = transaction;

      if (t.selected) {
        if (!t.toSplit && !t.category_id) {
          category_id = settlingUpCategory.id;
          category_name = settlingUpCategory.name;
        } else if (!t.toSplit) {
          const settleUpAmount = Math.ceil(t.amount / 20) * 10;
          const myAmount = t.amount - settleUpAmount;

          subtransactions = [
            {
              transaction_id: id,
              category_id: settlingUpCategory.id,
              category_name: settlingUpCategory.name,
              amount: settleUpAmount
            },
            {
              transaction_id: id,
              category_id: category_id,
              category_name: category_name,
              amount: myAmount
            },
          ] as SubTransaction[];
        }
      }

      return {
        ...transaction,
        flag_color: null,
        category_id: category_id,
        category_name: category_name,
        subtransactions: subtransactions
      } as TransactionDetail
    });
  }

  function spreadsheetTransactions(transactions: FlaggedTransaction[]): string {
    return transactions
      .map((t: FlaggedTransaction) => {
        let array =
          [
            t.date,
            t.payee_name,
          ] as (string | number | null | undefined)[];

        if (t.toSplit) {
          array.push(
            utils.convertMilliUnitsToCurrencyAmount(-t.amount),
            "Adam"
          );
        } else {
          array.push(
            utils.convertMilliUnitsToCurrencyAmount(t.amount),
            "Chelsea",
            "1",
            "0"
          );
        }

        return array;
      })
      .map((t) => t.join("\t"))
      .join("\n")
  }

  const spreadsheetTransactionsValue = spreadsheetTransactions(selectedTransactions());

  async function copy() {
    await navigator.clipboard.writeText(spreadsheetTransactionsValue);
  }

  async function update() {
    await ynabApi.transactions.updateTransactions(
      "default",
      {
        transactions: transactionToSave()
      } as PatchTransactionsWrapper
    )

    setFlaggedTransactionsRefreshKey((draft) => draft + 1);
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
        {(() => {
          switch (activeStep) {
            case 1:
              return (
                <Button
                  type="button"
                  onClick={copy}>
                  Copy to clipboard
                </Button>);
            case 2:
              return (
                <Button
                  type="button"
                  onClick={update}>
                  Update YNAB
                </Button>);
            default:
              return null;
          }
        })()}
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

    if (isFlaggedTransactionsLoading) {
      return <span>Loading...</span>
    }

    if (!flaggedTransactions.length) {
      return <span>No green-flagged transactions found for the selected account.</span>
    }


    return (
      <Wizard
        header={<WizardHeader />}
        wrapper={<div className="flex justify-evenly w-full" />}>
        <FlaggedTransactions
          transactions={flaggedTransactions}
          onTransactionSelectionChange={onTransactionSelectionChange}
        />
        <textarea
          readOnly
          name="spreadsheetTransactions"
          className="w-1/2 field-sizing-content bg-white text-black"
          value={spreadsheetTransactionsValue}
        />
        <TransactionsToSave
          transactions={transactionToSave()}
        />
      </Wizard>
    )
  }

  function accountChanged(newAccountId: string) {
    setAccountId(newAccountId);
    setIsFlaggedTransactionsLoading(true);
    setFlaggedTransactionsRefreshKey(0);
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
            selectedCategoryId={settlingUpCategory.id}
            onChange={(e) =>
              setSettlingUpCategory(
                {
                  id: e.target.value,
                  name: e.target.selectedOptions[0].innerText
                })}
            className="basis-1 bg-white text-black" />
        </div>

        <SplitterWizard />
      </div>
    </main >
  );
}
