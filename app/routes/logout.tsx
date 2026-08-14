import { redirect } from "react-router";
import type { Route } from "./+types/logout";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") throw new Response("Method not allowed", { status: 405 });
  return redirect("/auth/ynab/start", { headers: { "Set-Cookie": "ynab_splits_auth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax" } });
}

export function loader() {
  return redirect("/");
}
export default function Logout() {
  return null;
}

