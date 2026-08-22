import type { Route } from "./+types/invite";
import { secureRedirect, secureResponse } from "~/services/response.server";

export function loader({ params }: Route.LoaderArgs) {
  if (!params.token) throw secureResponse(new Response("Invite token is required", { status: 400 }));
  return secureRedirect(`/auth/ynab/start?invite=${encodeURIComponent(params.token)}`);
}

export default function Invite() {
  return <p>Redirecting to sign-in…</p>;
}
