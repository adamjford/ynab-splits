import { getEnv } from "~/services/env.server";
import { clearAuthCookie } from "~/services/session.server";
import { secureRedirect, secureResponse } from "~/services/response.server";
import type { Route } from "./+types/logout";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST")
    throw secureResponse(new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } }));
  return secureRedirect("/auth/ynab/start", { headers: { "Set-Cookie": clearAuthCookie(getEnv()) } });
}

export function loader() {
  throw secureResponse(new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } }));
}
export default function Logout() {
  return null;
}
