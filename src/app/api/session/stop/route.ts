import { RtcRole, RtcTokenBuilder } from "agora-token";
import { NextResponse } from "next/server";

type StopSessionPayload = {
  agentId?: string;
  channelName?: string;
  userUid?: number | string;
  appId?: string;
  appCertificate?: string;
};

/**
 * Tells Agora's Conversational AI backend to tear down the agent for a
 * channel. Without this call the agent keeps running (and billing) until
 * it times out on its own. Safe to call even if the agent already left:
 * we just log and return 200.
 */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as StopSessionPayload;
    const agentId = payload.agentId?.trim();
    const channelName = payload.channelName?.trim();
    const userUid = payload.userUid != null ? String(payload.userUid) : "";

    // Use the same credentials that started the session if the client
    // sent them, otherwise fall back to server env vars.
    const appId = payload.appId?.trim() || process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate =
      payload.appCertificate?.trim() || process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
      return NextResponse.json(
        { error: "Missing Agora credentials." },
        { status: 400 },
      );
    }
    if (!agentId) {
      return NextResponse.json(
        { error: "Missing agentId." },
        { status: 400 },
      );
    }

    // Mirror the auth scheme /join uses: an RTC+RTM token bound to the
    // user's channel + uid.
    const privilegeExpiredTs = Math.floor(Date.now() / 1000) + 60 * 5;
    const authToken = RtcTokenBuilder.buildTokenWithRtm(
      appId,
      appCertificate,
      channelName ?? "leave",
      userUid || "leave",
      RtcRole.PUBLISHER,
      privilegeExpiredTs,
      privilegeExpiredTs,
    );

    const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/agents/${encodeURIComponent(
      agentId,
    )}/leave`;

    console.log(
      `[convai] POST /leave agentId=${agentId} channel=${channelName ?? "-"}`,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `agora token=${authToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      // 404 / 410 are fine — the agent already left or never existed.
      if (response.status === 404 || response.status === 410) {
        console.log(
          `[convai] /leave: agent already gone (status=${response.status})`,
        );
        return NextResponse.json({ stopped: true, alreadyGone: true });
      }
      console.error(
        `[convai] /leave failed status=${response.status} body=${body}`,
      );
      return NextResponse.json(
        { stopped: false, status: response.status, details: body },
        { status: 502 },
      );
    }

    return NextResponse.json({ stopped: true });
  } catch (err) {
    console.error("[convai] /api/session/stop failed:", err);
    return NextResponse.json(
      { error: "Invalid request payload." },
      { status: 400 },
    );
  }
}
