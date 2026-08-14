import { useEffect, useRef } from "react";
import { Form, Link, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/app-layout";
import { authenticatedUser, database } from "~/services/request.server";
import { secureData, secureRedirect } from "~/services/response.server";
import { APP_DESTINATIONS, isDestinationCurrent } from "~/navigation";
import { QuickNavigation } from "~/components/QuickNavigation";
import { Button } from "~/components/Button";
export function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    return secureData(authenticatedUser(request, db));
  } catch (error) {
    if (error instanceof Response && error.status === 401) throw secureRedirect("/auth/ynab/start");
    if (error instanceof Response && error.status === 409) throw secureRedirect("/onboarding");
    throw error;
  } finally { db.close(); }
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstPathnameRef = useRef(pathname);

  useEffect(() => {
    if (pathname === firstPathnameRef.current) return;
    firstPathnameRef.current = pathname;
    mainRef.current?.focus();
  }, [pathname]);

  const dashboard = APP_DESTINATIONS[0];
  const destinations = APP_DESTINATIONS.slice(1);
  const linkClass = (current: boolean) => current
    ? "inline-flex min-h-11 items-center rounded bg-slate-100 px-3 py-2 font-medium text-slate-950"
    : "inline-flex min-h-11 items-center rounded px-3 py-2 text-slate-700";

  return <div className="min-h-screen bg-slate-50 text-slate-950">
    <a className="skip-link" href="#main-content" onClick={() => mainRef.current?.focus()}>Skip to main content</a>
    <header className="border-b bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 p-4">
        <Link
          to={dashboard.to}
          aria-current={isDestinationCurrent(dashboard, pathname) ? "page" : undefined}
          className={linkClass(isDestinationCurrent(dashboard, pathname))}
        >Household ledger</Link>
        <nav aria-label="Main navigation" className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
          {destinations.map((destination) => {
            const current = isDestinationCurrent(destination, pathname);
            return <Link
              key={destination.to}
              to={destination.to}
              aria-current={current ? "page" : undefined}
              className={linkClass(current)}
            >{destination.label}</Link>;
          })}
          <span className="px-2 text-slate-500">{loaderData.displayName}</span>
          <QuickNavigation />
          <Form method="post" action="/logout">
            <Button variant="secondary" type="submit">Log out</Button>
          </Form>
        </nav>
      </div>
    </header>
    <main ref={mainRef} id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl p-4"><Outlet /></main>
  </div>;
}
