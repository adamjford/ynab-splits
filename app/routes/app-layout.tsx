import { Form, NavLink, Outlet, redirect } from "react-router";
import type { Route } from "./+types/app-layout";
import { authenticatedUser, database } from "~/services/request.server";

export function loader({ request }: Route.LoaderArgs) {
  const db = database();
  try {
    return authenticatedUser(request, db);
  } catch (error) {
    if (error instanceof Response && error.status === 401) throw redirect("/auth/ynab/start");
    throw error;
  } finally { db.close(); }
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return <div className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4">
      <NavLink to="/" className="text-lg font-semibold">Household ledger</NavLink>
      <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-3 text-sm"><NavLink to="/inbox">Inbox</NavLink><NavLink to="/ledger">Ledger</NavLink><NavLink to="/settlements/new">Settle up</NavLink><NavLink to="/settings/ynab">YNAB settings</NavLink><span className="text-slate-500">{loaderData.displayName}</span><Form method="post" action="/logout"><button className="rounded border px-3 py-1" type="submit">Log out</button></Form></nav>
    </div></header>
    <main className="mx-auto max-w-6xl p-4"><Outlet /></main>
  </div>;
}
