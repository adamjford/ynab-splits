import { randomBytes } from "node:crypto";
import { signValue, verifyValue } from "./crypto.server";
import type { AppEnv } from "./env.server";

const DEFAULT_COOKIE_PREFIX = "ynab_splits";
const AUTH_COOKIE_SUFFIX = "_auth";
const OAUTH_COOKIE_SUFFIX = "_oauth";
const AUTH_MAX_AGE = 60 * 60 * 24 * 30;
const OAUTH_MAX_AGE = 600;

interface AuthPayload {
  userId: string;
}

export interface OAuthPayload {
  state: string;
  verifier: string;
  inviteId?: string;
  expiresAt: number;
}

function serialize(name: string, value: string, env: AppEnv, maxAge: number, expires?: string): string {
  const secure = new URL(env.APP_ORIGIN).protocol === "https:";
  return `${name}=${value}; Max-Age=${maxAge}; ${expires ? `Expires=${expires}; ` : ""}Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}
function cookieNames(env: AppEnv): { auth: string; oauth: string } {
  const prefix = env.COOKIE_PREFIX || DEFAULT_COOKIE_PREFIX;
  return {
    auth: `${prefix}${AUTH_COOKIE_SUFFIX}`,
    oauth: `${prefix}${OAUTH_COOKIE_SUFFIX}`,
  };
}

export function createAuthCookie(userId: string, env: AppEnv): string {
  return serialize(cookieNames(env).auth, signValue({ userId }, env.SESSION_SECRET), env, AUTH_MAX_AGE);
}

export function clearAuthCookie(env: AppEnv): string {
  return serialize(cookieNames(env).auth, "", env, 0, "Thu, 01 Jan 1970 00:00:00 GMT");
}

export function readAuthUserId(cookieHeader: string | null, env: AppEnv): string | null {
  const value = cookieValue(cookieHeader, cookieNames(env).auth);
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
  return { cookie: serialize(cookieNames(env).oauth, signValue(payload, env.SESSION_SECRET), env, OAUTH_MAX_AGE), payload };
}

export function readOAuthCookie(cookieHeader: string | null, env: AppEnv): OAuthPayload | null {
  const value = cookieValue(cookieHeader, cookieNames(env).oauth);
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
  return serialize(cookieNames(env).oauth, "", env, 0, "Thu, 01 Jan 1970 00:00:00 GMT");
}
