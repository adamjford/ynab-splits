import { YnabApiContext } from "~/context/ynab";
import { api as YnabApi } from "ynab";
import { useContext } from "react";

export function useYnabApi(): YnabApi {
  const ynabApi: YnabApi | null = useContext(YnabApiContext);

  if (!ynabApi) {
    throw new Error("YNAB API connection not found.")
  }

  return ynabApi;
}
