import type { api as YnabApi } from "ynab";
import { useYnabApi } from "./useYnabApi";
import { useEffect } from "react";

export function useYnabFetchEffect<ReturnType>(
  fetchFn: (ynabApi: YnabApi) => Promise<ReturnType[]>,
  setterFn: (value: ReturnType[]) => void
) {
  const ynabApi = useYnabApi();

  useEffect(() => {
    let ignore = false;

    function startFetching() {
      fetchFn(ynabApi).then((result) => {
        if (!ignore) {
          setterFn(result);
        }
      });
    }

    startFetching();

    return () => {
      ignore = true;
    }
  }, [ynabApi]);

}
