import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  route("auth/ynab/start", "routes/auth.start.tsx"),
  route("auth/ynab/callback", "routes/auth.callback.tsx"),
  route("logout", "routes/logout.tsx"),
  route("invite/:token", "routes/invite.tsx"),
  route("onboarding", "routes/onboarding.tsx"),
  route("__dev/health", "routes/dev-health.tsx"),
  route("", "routes/app-layout.tsx", [
    index("routes/dashboard.tsx"),
    route("inbox", "routes/inbox.tsx"),
    route("ledger", "routes/ledger.tsx"),
    route("ledger/:entryId", "routes/ledger-entry.tsx"),
    route("settings/ynab", "routes/settings-ynab.tsx"),
    route("settlements/new", "routes/settlement-new.tsx"),
    route("settlements/:settlementId", "routes/settlement-detail.tsx"),
  ]),
] satisfies RouteConfig;
