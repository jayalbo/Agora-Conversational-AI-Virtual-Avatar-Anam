import { NextResponse } from "next/server";

import { authMode, getSessionUser } from "@/lib/auth";
import { getUsage, isBypassed, quotaSecondsPerUser } from "@/lib/quota";

/**
 * GET /api/session/me
 *
 * Returns the current viewer's identity + remaining quota so the UI
 * can decide whether to show the sign-in landing, the normal demo, or
 * the "you've used your time" banner.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { authenticated: false, authMode: authMode() },
      { status: 200 },
    );
  }

  const usage = await getUsage(user);
  return NextResponse.json({
    authenticated: true,
    authMode: authMode(),
    user: { id: user.id, email: user.email, name: user.name },
    unlimited: usage.unlimited,
    bypass: isBypassed(user),
    quotaSeconds: usage.quotaSeconds,
    usedSeconds: usage.usedSeconds,
    // `Infinity` is not valid JSON, so we substitute a large sentinel
    // when the account is unlimited. The frontend checks `unlimited`
    // first and never renders this value in that case.
    remainingSeconds: usage.unlimited
      ? quotaSecondsPerUser() * 1_000
      : usage.remainingSeconds,
  });
}
