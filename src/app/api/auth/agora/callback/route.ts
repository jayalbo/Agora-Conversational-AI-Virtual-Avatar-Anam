import { NextResponse } from "next/server";

import {
  authMode,
  consumeOAuthStateCookie,
  setSessionCookie,
  signSession,
} from "@/lib/auth";
import { exchangeCodeForToken, fetchCustomer } from "@/lib/agora-sso";

/**
 * GET /api/auth/agora/callback?code=...&state=...
 *
 * Verifies state, exchanges the authorization code for an access
 * token, fetches the Agora customer profile, signs our own session
 * JWT, and redirects the browser home.
 *
 * In bypass mode this route is not expected to be hit — the start
 * route short-circuits — but we return 403 defensively if it is.
 */
export async function GET(request: Request) {
  if (authMode() === "bypass") {
    return NextResponse.json(
      { error: "SSO callback is disabled in bypass mode." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const ssoError = url.searchParams.get("error");

  if (ssoError) {
    console.error(`[auth] SSO returned error=${ssoError}`);
    return redirectToHome(request, { authError: ssoError });
  }

  if (!code || !state) {
    return redirectToHome(request, { authError: "missing_params" });
  }

  const expectedState = await consumeOAuthStateCookie();
  if (!expectedState || expectedState !== state) {
    console.error("[auth] state mismatch on SSO callback");
    return redirectToHome(request, { authError: "state_mismatch" });
  }

  try {
    const token = await exchangeCodeForToken(code);
    const customer = await fetchCustomer(token.access_token);
    const sessionJwt = await signSession({
      id: customer.id,
      email: customer.email,
      name: customer.name,
    });
    await setSessionCookie(sessionJwt);
    return redirectToHome(request);
  } catch (err) {
    console.error("[auth] callback failed:", err);
    return redirectToHome(request, { authError: "exchange_failed" });
  }
}

function redirectToHome(
  request: Request,
  search?: Record<string, string>,
): NextResponse {
  const target = new URL("/", request.url);
  if (search) {
    for (const [key, value] of Object.entries(search)) {
      target.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(target);
}
