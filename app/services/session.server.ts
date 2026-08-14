import { randomBytes } from "node:crypto";
import { signValue, verifyValue } from "./crypto.server";
import type { AppEnv } from "./env.server";

const AUTH_COOKIE = "ynab_splits_auth";
const OAUTH_COOKIE = "ynab_splits_oauth";

interface AuthPayload {
  userId: string;
}

export interface OAuthPayload {
  state: string;
  verifier: string;
  inviteId?: string;
  expiresAt: number;
}

function serialize(name: string, value: string, env: AppEnv, maxAge: number): string {
  const secure = new URL(env.APP_ORIGIN).protocol === "https:";
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

export function createAuthCookie(userId: string, env: AppEnv): string {
  return serialize(AUTH_COOKIE, signValue({ userId }, env.SESSION_SECRET), env, 60 * 60 * 24 * 30);
}

export function readAuthUserId(cookieHeader: string | null, env: AppEnv): string | null {
  const value = cookieValue(cookieHeader, AUTH_COOKIE);
  if (!value) return null;
  try {
    return verifyValue<AuthPayload>(value, env.SESSION_SECRET).userId;
  } catch {
    return null;
  }
}

export function createOAuthCookie(env: AppEnv, inviteId?: string): { cookie: string; payload: OAuthPayload } {
  const payload: OAuthPayload = {
    state: randomBytes(24).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    inviteId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  return { cookie: serialize(OAUTH_COOKIE, signValue(payload, env.SESSION_SECRET), env, 600), payload };
}

export function readOAuthCookie(cookieHeader: string | null, env: AppEnv): OAuthPayload | null {
  const value = cookieValue(cookieHeader, OAUTH_COOKIE);
  if (!value) return null;
  try {
    const payload = verifyValue<OAuthPayload>(value, env.SESSION_SECRET);
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function clearOAuthCookie(env: AppEnv): string {
  return serialize(OAUTH_COOKIE, "", env, 0);
}
