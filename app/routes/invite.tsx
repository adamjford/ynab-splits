import { redirect } from "react-router";
import type { Route } from "./+types/invite";

export function loader({ params }: Route.LoaderArgs) {
  if (!params.token) throw new Response("Invite token is required", { status: 400 });
  return redirect(`/auth/ynab/start?invite=${encodeURIComponent(params.token)}`);
}

export default function Invite() {
  return <p>Redirecting to sign-in…</p>;
}