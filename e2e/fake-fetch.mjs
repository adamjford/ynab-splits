/* global process, URL, Request */
const targetOrigin = process.env.E2E_FAKE_YNAB_ORIGIN;
if (targetOrigin) {
  const apiTargetOrigin = process.env.E2E_FAKE_API_ORIGIN ?? targetOrigin;
  const oauthTargetOrigin = process.env.E2E_FAKE_OAUTH_ORIGIN ?? targetOrigin;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const source = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    let target = source;
    try {
      const sourceUrl = new URL(source);
      if (sourceUrl.origin === "https://api.ynab.com" && (sourceUrl.pathname === "/v1" || sourceUrl.pathname.startsWith("/v1/"))) {
        target = `${apiTargetOrigin}${sourceUrl.pathname}${sourceUrl.search}`;
      } else if (sourceUrl.origin === "https://app.ynab.com" && sourceUrl.pathname === "/oauth/token") {
        target = `${oauthTargetOrigin}/oauth/token${sourceUrl.search}`;
      }
    } catch {
      return originalFetch(input, init);
    }
    if (target === source) return originalFetch(input, init);
    if (typeof input === "string" || input instanceof URL) return originalFetch(target, init);
    return originalFetch(target, init ? new Request(input, init) : input);
  };
}
