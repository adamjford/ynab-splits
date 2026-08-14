/* global process, URL */
const targetOrigin = process.env.E2E_FAKE_YNAB_ORIGIN;
if (targetOrigin) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const source = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    let target = source;
    if (source.startsWith("https://api.ynab.com/v1/")) target = `${targetOrigin}${new URL(source).pathname}${new URL(source).search}`;
    if (source === "https://app.ynab.com/oauth/token") target = `${targetOrigin}/oauth/token`;
    if (target === source) return originalFetch(input, init);
    return originalFetch(target, init);
  };
}
