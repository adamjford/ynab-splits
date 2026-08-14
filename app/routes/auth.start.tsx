import { redirect } from "react-router";
import type { Route } from "./+types/auth.start";

export async function loader({ request }: Route.LoaderArgs) {
  const [{ buildAuthorizationUrl }, { getEnv }, { createOAuthCookie }] = await Promise.all([import("~/services/auth.server"), import("~/services/env.server"), import("~/services/session.server")]);
  const env = getEnv();
  const inviteId = new URL(request.url).searchParams.get("invite") ?? undefined;
  const { cookie, payload } = createOAuthCookie(env, inviteId);
  return redirect(buildAuthorizationUrl(env, payload.state, payload.verifier), { headers: { "Set-Cookie": cookie } });
}

export default function AuthStart() {
  return <p>Redirecting to YNAB…</p>;
}
