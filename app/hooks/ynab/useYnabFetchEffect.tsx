import type { api as YnabApi } from "ynab";
import { useYnabApi } from "./useYnabApi";
import { useEffect, type DependencyList } from "react";

export function useYnabFetchEffect<ResultType>(
  fetchFn: (ynabApi: YnabApi) => Promise<ResultType[]>,
  setResultFn: (value: ResultType[]) => void,
  setIsLoadingFn?: (value: boolean) => void,
  dependencies: DependencyList = []
) {
  const ynabApi = useYnabApi();

  useEffect(() => {
    let ignore = false;

    function startFetching() {
      if (!ignore) {
        setIsLoadingFn?.(true);
      }

      fetchFn(ynabApi).then((result) => {
        if (!ignore) {
          setResultFn(result);
          setIsLoadingFn?.(false);
        }
      });
    }

    startFetching();

    return () => {
      ignore = true;
    }
  }, dependencies);

}
