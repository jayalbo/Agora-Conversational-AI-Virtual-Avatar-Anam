import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { heartbeat } from "@/lib/quota";

type HeartbeatPayload = { reservationId?: string };

/**
 * POST /api/session/heartbeat  { reservationId }
 *
 * Called by the client every ~30s while a call is live. Extends the
 * reservation TTL so an active session isn't garbage collected, and
 * confirms to the client that it still owns the reservation. No-ops
 * in bypass mode.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as HeartbeatPayload;
    const reservationId = payload.reservationId?.trim();
    if (!reservationId) {
      return NextResponse.json(
        { error: "Missing reservationId." },
        { status: 400 },
      );
    }
    await heartbeat(user, reservationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[quota] /heartbeat failed:", err);
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
}
