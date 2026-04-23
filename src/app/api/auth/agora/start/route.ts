import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
  DEV_USER,
  authMode,
  setOAuthStateCookie,
  setSessionCookie,
  signSession,
} from "@/lib/auth";
import { buildAuthorizeUrl } from "@/lib/agora-sso";

/**
 * GET /api/auth/agora/start
 *
 * In SSO mode: mint a CSRF `state` (stored in a short-lived HttpOnly
 * cookie) and redirect the browser to Agora SSO's authorize endpoint.
 *
 * In bypass mode (local dev only): sign the dev user's session cookie
 * directly and send them home. Refuses to operate in production.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));

  if (authMode() === "bypass") {
    const token = await signSession({ ...DEV_USER });
    await setSessionCookie(token);
    return NextResponse.redirect(new URL(returnTo, request.url));
  }

  try {
    const state = randomUUID();
    await setOAuthStateCookie(state);
    const authorizeUrl = buildAuthorizeUrl(state);
    // We don't currently preserve returnTo through the round-trip (not
    // worth the extra state handling for this demo). The callback
    // always lands the user on `/`.
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    console.error("[auth] /start failed:", err);
    return NextResponse.json(
      { error: "SSO is not configured on this deployment." },
      { status: 500 },
    );
  }
}

function sanitizeReturnTo(raw: string | null): string {
  if (!raw) return "/";
  // Only allow same-origin relative paths to avoid open redirects.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
