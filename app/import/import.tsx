import * as ynab from "ynab";
import { useEffect, useState } from "react";
import config from "../config.json";

export function Import() {
  interface Category {
    id: string;
    name: string;
    group_id: string;
    group_name: string;
  }

  function setUpYnabApi() {
    let token = null;
    const search =
      window.location.hash.
        substring(1).replace(/&/g, '","').replace(/=/g, '":"');

    if (search && search !== '') {
      // Try to get access_token from the hash returned by OAuth
      const params = JSON.parse('{"' + search + '"}', function (key, value) {
        return key === '' ? value : decodeURIComponent(value);
      });
      token = params.access_token;
      sessionStorage.setItem('ynab_access_token', token);
      window.location.hash = '';
    } else {
      // Otherwise try sessionStorage
      token = sessionStorage.getItem('ynab_access_token');
    }

    if (!token) {
      const uri: string = `https://app.ynab.com/oauth/authorize?client_id=${config.clientId}&redirect_uri=${config.redirectUri}&response_type=token`;
      location.replace(uri);
    }

    return new ynab.api(token);
  }

  function moneyToMilliunits(money: string): number {
    if (!money) return 0;
    return Number(money.replace(/[^0-9.-]+/g, "")) * 1000;
  }

  const [ynabApi, _] = useState(() => setUpYnabApi());
  const [transactions, setTransactions] = useState("");
  const [settlingUpCategoryId, setSettlingUpCategoryId] = useState("");
  const [categories, setCategories] = useState([] as Category[]);

  async function getCategories(ynabApi: ynab.api): Promise<Category[]> {
    const categoriesResponse = await ynabApi.categories.getCategories("default");
    return categoriesResponse.data.category_groups
      .filter(group => !group.deleted && !group.hidden)
      .flatMap(group => {
        return group.categories
          .filter(category =>
            !category.deleted &&
            !category.hidden &&
            category.name.toLowerCase().includes("settling up"))
          .map(function (category): Category {
            return {
              id: category.id,
              name: category.name,
              group_id: group.id,
              group_name: group.name,
            };
          });
      });
  }

  useEffect(() => {
    let ignore = false;

    setCategories([]);

    getCategories(ynabApi).then(result => {
      if (!ignore) {
        setCategories(result);
        setSettlingUpCategoryId(result[0].id);
      }
    });

    return () => {
      ignore = true;
    }
  }, [ynabApi]);

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setTransactions(e.target.value);
  }

  function createTransactions(e: React.SubmitEvent) {
    e.preventDefault();

    if (!transactions) {
      return;
    }

    const stringSplitTransactions: Array<Array<string>> =
      transactions
        .split(/\r?\n/)
        .map((line) => line.split("\t"));

    const newTransactions: ynab.NewTransaction[] =
      stringSplitTransactions
        .map(function (array) {
          const totalAmount = moneyToMilliunits(array[13]);
          const rightAmount = moneyToMilliunits(array[15]);

          if (!totalAmount || !rightAmount) return null;

          const leftAmount: number = totalAmount - rightAmount;

          const transaction: ynab.NewTransaction = {
            date: new Date(array[0]).toISOString().substring(0, 10),
            amount: moneyToMilliunits(array[13]),
            subtransactions: [
              {
                amount: leftAmount
              },
              {
                amount: rightAmount,
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
    <main className="pt-16 pb-4 w-full flex items-center justify-center">
      <form className="flex flex-wrap items-center justify-center w-2/3 gap-y-20" onSubmit={createTransactions}>
        <select
          name="settlingUpCategoryId"
          value={settlingUpCategoryId}
          onChange={e => setSettlingUpCategoryId(e.target.value)}
          className="bg-white text-black">
          {categories.map((category) =>
            <option key={category.id} value={category.id}>{category.group_name} - {category.name}</option>
          )}
        </select>

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
