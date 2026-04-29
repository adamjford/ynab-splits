import { createContext, useState } from "react";
import config from "../../config.json";
import { api as YnabApi } from "ynab";

function setUpYnabApi(): YnabApi {
  let token = null;
  const search =
    window.location.hash
      .substring(1).replace(/&/g, '","').replace(/=/g, '":"');

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

  return new YnabApi(token);
}

export const YnabApiContext = createContext(null as YnabApi | null);

export const YnabApiProvider = ({ children }: React.PropsWithChildren) => {
  const [ynabApi, _] = useState(() => setUpYnabApi());

  return (
    <YnabApiContext.Provider value={ynabApi}>
      {children}
    </YnabApiContext.Provider>
  );
};
