export interface AppDestination {
  readonly label: string;
  readonly to: string;
  readonly keywords: readonly string[];
  readonly matches: (pathname: string) => boolean;
}

const exact = (path: string) => (pathname: string): boolean => pathname === path;
const nested = (path: string) => (pathname: string): boolean => pathname === path || pathname.startsWith(`${path}/`);

export const APP_DESTINATIONS = [
  { label: "Dashboard", to: "/", keywords: ["home", "overview"], matches: exact("/") },
  { label: "Inbox", to: "/inbox", keywords: ["transactions", "review"], matches: exact("/inbox") },
  { label: "Ledger", to: "/ledger", keywords: ["entries", "expenses"], matches: nested("/ledger") },
  { label: "Settle up", to: "/settlements/new", keywords: ["settlement", "payment"], matches: nested("/settlements") },
  {
    label: "YNAB settings",
    to: "/settings/ynab",
    keywords: ["plan", "accounts", "categories"],
    matches: exact("/settings/ynab"),
  },
] as const satisfies readonly AppDestination[];

export function isDestinationCurrent(destination: AppDestination, pathname: string): boolean {
  return destination.matches(pathname);
}
