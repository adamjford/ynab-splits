# Route shell and interaction specification

This system owns route composition, authenticated shell behavior, accessible
navigation, and user-visible action outcomes. Server-side ownership and YNAB
orchestration are specified in [../services/SPEC.md](../services/SPEC.md); the
application contract is in [../../SPEC.md](../../SPEC.md).

## Route boundaries and access

- Public routes start and complete YNAB OAuth, log out the current session,
  accept an invite token, and complete onboarding. Authenticated routes expose
  the dashboard, inbox, shared ledger, owner-scoped ledger detail, YNAB
  settings, settlement creation, and settlement detail.
- An unauthenticated request to an authenticated route redirects to
  `/auth/ynab/start`. An authenticated user without a completed household
  membership is redirected to `/onboarding`. Route loaders and actions retain
  explicit HTTP or redirect outcomes rather than silently rendering an empty
  state.
- The authenticated shell is shared by all application routes. It exposes the
  member-safe navigation and logout control while leaving YNAB identifiers,
  posting controls, and manual-task controls visible only to their owner.

## Development diagnostics and instance identity

- In development, `GET /__dev/health` returns only the safe readiness payload
  `{ ok: true, instanceId, origin }`. It never exposes secrets, database
  paths, fake-service state, or operational health details, and the route is
  disabled in production.
- When `INSTANCE_LABEL` is non-empty, the authenticated shell renders the
  accessible non-secret label `Instance: <label>`. An empty label adds no
  instance marker. Auth and OAuth cookies are
  `${COOKIE_PREFIX}_auth` and `${COOKIE_PREFIX}_oauth`, preventing a
  same-host session from crossing instance boundaries. Instance identity is
  runtime metadata only and does not change household or member authorization.

## Navigation and accessibility

- Every authenticated top-level destination is registered in
  `APP_DESTINATIONS`. Shell links and the Navigate palette use the same labels,
  destination paths, and current-section matching; exactly the matching
  destination receives `aria-current="page"`.
- The visible Navigate control opens a keyboard- and pointer-usable palette.
  Filtering matches destination labels or keywords. `Ctrl+K` on Windows/Linux
  and `Command+K` on macOS open it; other modifier combinations and editable
  fields retain their normal behavior. Escape closes it, keyboard navigation
  activates a result, and focus returns to the opener or main content after
  dismissal/navigation.
- The shell provides a skip link, a labeled main navigation, a focusable main
  landmark, route-change focus restoration, readable feedback roles, and
  controls that remain usable at responsive widths. Action errors use
  `role="alert"`; successful status feedback uses `role="status"`; new
  feedback receives focus when the action result changes.

## Workflow responses and recovery

- Connect, invite/onboarding, settings, inbox review, ledger correction,
  settlement creation, posting, verification, void, restore, and logout each
  report their success or failure in the route response. Empty inboxes,
  disconnected connections, expired invites, missing settings, currency
  mismatches, stale sources, rate limits, failed postings, zero-net periods,
  CSV mismatches, and database failures remain visible with a recovery action or
  an explicit instruction.
- Route forms revalidate authenticated ownership and current state on submit;
  a forged ID, stale review, unauthorized owner control, or ineligible source
  cannot be converted into a successful local or remote write.
- A route-level failure renders the application error boundary with a clear
  request-failed message and a dashboard recovery instruction instead of a
  blank screen or swallowed exception.

## Acceptance criteria

1. The route map reaches the intended public, onboarding, authenticated,
   ledger, and settlement surfaces, with auth and onboarding redirects applied
   at the shell boundary.
2. Every destination has one consistent current-state indication, keyboard and
   pointer navigation works, and feedback announces and focuses the resulting
   status or error.
3. Owner-private data and controls remain absent from the other member's
   rendered shared views.
4. Expected financial, authorization, stale/conflict, and database failures
   remain explicit and actionable at the route surface.
5. Development `GET /__dev/health` exposes only `{ ok, instanceId, origin }`,
   is unavailable in production, and never exposes secrets or operational
   paths.
6. A non-empty `INSTANCE_LABEL` renders as the accessible `Instance: <label>`
   marker in the authenticated shell; an empty label renders no marker.
7. Auth and OAuth cookies use the configured instance prefix and cannot
   authenticate a different same-host instance.

## Implementation and test map

| Contract section | Implementation | Focused evidence |
| --- | --- | --- |
| Development diagnostics and instance label | `app/routes.ts`, `app/routes/dev-health.tsx`, `app/routes/app-layout.tsx`, `app/services/env.server.ts` | `app/services/env.test.ts`, `e2e/test-server.ts`, `e2e/app.spec.ts` |
| Public, onboarding, and authenticated route composition | `app/routes.ts`, `app/routes/app-layout.tsx`, `app/routes/auth.start.tsx`, `app/routes/auth.callback.tsx`, `app/routes/invite.tsx`, `app/routes/onboarding.tsx` | `app/routes/onboarding.test.tsx`, `e2e/app.spec.ts`, `e2e/action-feedback.spec.ts` |
| Shared navigation and current-route matching | `app/navigation.ts`, `app/routes/app-layout.tsx` | `app/navigation.test.ts`, `e2e/navigation.spec.ts` |
| Quick navigation keyboard, filtering, and focus | `app/components/QuickNavigation.tsx` | `e2e/navigation.spec.ts` |
| Action feedback and route-level errors | `app/components/ActionFeedback.tsx`, `app/root.tsx`, route loaders/actions | `e2e/action-feedback.spec.ts`, focused route tests |
| Inbox, ledger, settings, and settlement surfaces | `app/routes/inbox.tsx`, `app/routes/ledger.tsx`, `app/routes/ledger-entry.tsx`, `app/routes/settings-ynab.tsx`, `app/routes/settlement-new.tsx`, `app/routes/settlement-detail.tsx` | `e2e/app.spec.ts`, `e2e/action-feedback.spec.ts`, `e2e/settlement-interactions.spec.ts` |
