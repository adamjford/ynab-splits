import type { Route } from "./+types/auth.callback";
import { secureRedirect, secureResponse } from "~/services/response.server";

export async function loader({ request }: Route.LoaderArgs) {
  const [{ exchangeCode, persistConnection }, { database }, { getEnv }, { clearOAuthCookie, createAuthCookie, readOAuthCookie }, { HttpYnabGateway }] = await Promise.all([import("~/services/auth.server"), import("~/services/request.server"), import("~/services/env.server"), import("~/services/session.server"), import("~/services/ynab.server")]);
  const env = getEnv();
  const url = new URL(request.url);
  const oauth = readOAuthCookie(request.headers.get("Cookie"), env);
  if (!oauth || oauth.state !== url.searchParams.get("state")) throw secureResponse(new Response("OAuth state expired or invalid", { status: 400 }));
  const code = url.searchParams.get("code");
  if (!code) throw secureResponse(new Response("YNAB authorization was denied", { status: 400 }));
  const token = await exchangeCode(env, code, oauth.verifier);
  const gateway = new HttpYnabGateway(token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000, env.YNAB_CLIENT_ID, env.YNAB_CLIENT_SECRET);
  const ynabUser = await gateway.getUser();
  const db = database();
  try {
    const userId = persistConnection(db, env, ynabUser, "Pending", token);
    const headers = new Headers();
    headers.append("Set-Cookie", createAuthCookie(userId, env));
    headers.append("Set-Cookie", clearOAuthCookie(env));
    return secureRedirect(`/onboarding${oauth.inviteId ? `?invite=${encodeURIComponent(oauth.inviteId)}` : ""}`, { headers });
  } finally { db.close(); }
}

export default function AuthCallback() {
  return <p>Completing YNAB sign-in…</p>;
}
