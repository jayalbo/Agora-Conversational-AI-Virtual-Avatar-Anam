import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * A synthetic identity used when AUTH_MODE=bypass (local dev only).
 * See `authMode()` below for why this exists.
 */
export const DEV_USER = {
  id: "dev@local",
  email: "dev@local",
  name: "Local Dev",
} as const;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

/** Cookie names used for the session + for the short-lived OAuth state. */
export const SESSION_COOKIE = "yan_session";
export const OAUTH_STATE_COOKIE = "yan_oauth_state";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24h — comfortably longer than any demo session.
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10; // 10 minutes to complete the SSO round-trip.

function getSessionSecret(): Uint8Array {
  const raw = process.env.SESSION_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "SESSION_JWT_SECRET must be set to at least 32 characters (use a random hex string).",
    );
  }
  return new TextEncoder().encode(raw);
}

/**
 * "sso"    → full OAuth against Agora SSO (production + staging).
 * "bypass" → local dev shortcut. Every request is treated as DEV_USER.
 *            Guarded: refuses to operate when NODE_ENV === "production".
 */
export function authMode(): "sso" | "bypass" {
  const raw = (process.env.AUTH_MODE || "sso").toLowerCase();
  if (raw === "bypass") {
    if (process.env.NODE_ENV === "production") {
      // Belt-and-suspenders. If someone mis-sets AUTH_MODE=bypass in prod,
      // we refuse to honor it regardless.
      return "sso";
    }
    return "bypass";
  }
  return "sso";
}

export async function signSession(user: SessionUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(getSessionSecret());
}

export async function verifySession(
  token: string,
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), {
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    return {
      id: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
    };
  } catch {
    return null;
  }
}

/**
 * Read the current user from the session cookie. Returns DEV_USER in
 * bypass mode so downstream code never needs to special-case.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (authMode() === "bypass") {
    return { ...DEV_USER };
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return await verifySession(token);
}

/**
 * Set the session cookie on the response returned by a route handler.
 * We use `cookies()` from next/headers which mutates the outgoing
 * Set-Cookie on the current response, matching how Next 15 expects it.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function setOAuthStateCookie(state: string): Promise<void> {
  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export async function consumeOAuthStateCookie(): Promise<string | null> {
  const store = await cookies();
  const current = store.get(OAUTH_STATE_COOKIE)?.value ?? null;
  store.delete(OAUTH_STATE_COOKIE);
  return current;
}
