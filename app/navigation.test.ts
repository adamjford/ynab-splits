import { describe, expect, it } from "vitest";
import { APP_DESTINATIONS, isDestinationCurrent } from "./navigation";

describe("navigation destinations", () => {
  it("navigation destinations expose labels, paths, keywords, and route matching", () => {
    expect(
      APP_DESTINATIONS.map(({ label, to, keywords }) => ({ label, to, keywords })),
    ).toEqual([
      { label: "Dashboard", to: "/", keywords: ["home", "overview"] },
      { label: "Inbox", to: "/inbox", keywords: ["transactions", "review"] },
      { label: "Ledger", to: "/ledger", keywords: ["entries", "expenses"] },
      { label: "Settle up", to: "/settlements/new", keywords: ["settlement", "payment"] },
      { label: "YNAB settings", to: "/settings/ynab", keywords: ["plan", "accounts", "categories"] },
    ]);

    const routeCases = [
      ["Dashboard", "/", true],
      ["Dashboard", "/ledger", false],
      ["Dashboard", "/anything", false],
      ["Inbox", "/inbox", true],
      ["Inbox", "/inbox/review", false],
      ["Inbox", "/", false],
      ["Ledger", "/ledger", true],
      ["Ledger", "/ledger/entry-123", true],
      ["Ledger", "/ledgerish", false],
      ["Settle up", "/settlements/new", true],
      ["Settle up", "/settlements/settlement-123", true],
      ["Settle up", "/settlement", false],
      ["YNAB settings", "/settings/ynab", true],
      ["YNAB settings", "/settings/ynab/accounts", false],
      ["YNAB settings", "/settings", false],
    ] as const;

    for (const [label, pathname, expected] of routeCases) {
      const destination = APP_DESTINATIONS.find((entry) => entry.label === label);
      expect(destination, `destination ${label} should exist`).toBeDefined();
      expect(isDestinationCurrent(destination!, pathname)).toBe(expected);
    }

    const knownPaths = [
      "/",
      "/inbox",
      "/ledger/entry-123",
      "/settlements/settlement-123",
      "/settings/ynab",
    ];
    for (const pathname of knownPaths) {
      expect(APP_DESTINATIONS.filter((destination) => isDestinationCurrent(destination, pathname))).toHaveLength(1);
    }

    expect(APP_DESTINATIONS.filter((destination) => isDestinationCurrent(destination, "/reports"))).toHaveLength(0);
  });
});
