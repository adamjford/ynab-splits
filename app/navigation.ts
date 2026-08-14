export interface AppDestination {
  readonly label: string;
  readonly to: string;
  readonly keywords: readonly string[];
  readonly matches: (pathname: string) => boolean;
}

const normalizePathname = (pathname: string): string => {
  const normalized = pathname.toLowerCase().replace(/\/+$/, "");
  return normalized || "/";
};

const exact = (path: string) => {
  const normalizedPath = normalizePathname(path);
  return (pathname: string): boolean => normalizePathname(pathname) === normalizedPath;
};

const nested = (path: string) => {
  const normalizedPath = normalizePathname(path);
  return (pathname: string): boolean => {
    const normalizedPathname = normalizePathname(pathname);
    return normalizedPathname === normalizedPath || normalizedPathname.startsWith(`${normalizedPath}/`);
  };
};

export const DASHBOARD_DESTINATION = {
  label: "Dashboard",
  to: "/",
  keywords: ["home", "overview"],
  matches: exact("/"),
} as const satisfies AppDestination;

export const APP_DESTINATIONS = [
  DASHBOARD_DESTINATION,
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
