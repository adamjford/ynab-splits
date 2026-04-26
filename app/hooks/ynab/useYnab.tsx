import { YnabApiContext } from "./ynabApiContext";
import { api as YnabApi } from "ynab";
import { useContext } from "react";

export function useYnab(): YnabApi {
  const ynabApi: YnabApi | null = useContext(YnabApiContext);

  if (!ynabApi) {
    throw new Error("YNAB API connection not found.")
  }

  return ynabApi;
}
