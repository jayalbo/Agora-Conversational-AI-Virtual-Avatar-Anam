import { NextResponse } from "next/server";

import { authMode, clearSessionCookie } from "@/lib/auth";
import { buildLogoutUrl } from "@/lib/agora-sso";

/**
 * POST /api/auth/agora/logout  -> JSON { redirect: string }
 * GET  /api/auth/agora/logout  -> 302 to the redirect
 *
 * Clears our session cookie and returns (or redirects to) the Agora
 * SSO logout URL so the next sign-in actually shows the login page.
 * In bypass mode we just clear the cookie and send the user home;
 * there's no upstream to sign them out of.
 */
export async function POST(request: Request) {
  await clearSessionCookie();
  const redirect = logoutTarget(request);
  return NextResponse.json({ redirect });
}

export async function GET(request: Request) {
  await clearSessionCookie();
  return NextResponse.redirect(logoutTarget(request));
}

function logoutTarget(request: Request): string {
  const home = new URL("/", request.url).toString();
  if (authMode() === "bypass") return home;
  try {
    return buildLogoutUrl(home);
  } catch (err) {
    console.error("[auth] could not build SSO logout URL:", err);
    return home;
  }
}
