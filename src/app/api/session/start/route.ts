import { RtcRole, RtcTokenBuilder } from "agora-token";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { quotaSecondsPerUser, reserve } from "@/lib/quota";

type McpConfig = { enabled: false } | { enabled: true; serverUrl: string };
type VisionConfig = { enabled: boolean };

type StartSessionPayload = {
  systemPrompt?: string;
  greeting?: string;
  voiceSpeed?: number;
  mcp?: McpConfig;
  vision?: VisionConfig;
  fillerPhrases?: string[];
  asrLanguage?: string;
  // When the user brings their own Agora account, the client provides
  // these per call. Otherwise the server falls back to the values baked
  // into environment variables (useful for local dev).
  appId?: string;
  appCertificate?: string;
};

const DEFAULT_FILLER_PHRASES_EN = [
  "Let me check that for you...",
  "One sec...",
  "Looking that up...",
  "Hmm, let me see...",
];

// ElevenLabs speed parameter is clamped to [0.7, 1.2] by Agora.
const MIN_VOICE_SPEED = 0.7;
const MAX_VOICE_SPEED = 1.2;
const DEFAULT_VOICE_SPEED = 0.9;

function clampVoiceSpeed(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_VOICE_SPEED;
  return Math.min(MAX_VOICE_SPEED, Math.max(MIN_VOICE_SPEED, value));
}

// Build an MCP server entry for Agora's llm.mcp_servers. Agora's REST
// currently only accepts `streamable_http` transport, so we route all
// configured servers through that even when the URL path is /sse.
// Name must be <=48 chars and alphanumeric only.
function sanitizeMcpName(input: string): string {
  const base = input.replace(/[^a-zA-Z0-9]/g, "").slice(0, 48);
  return base || "mcpserver";
}

// Agora ASR supports a set of BCP-47-ish locale codes. Keep a small
// allowlist so we don't forward anything arbitrary from the client.
const SUPPORTED_ASR_LANGUAGES = new Set([
  "en-US",
  "pt-BR",
  "es-ES",
  "es-MX",
  "fr-FR",
  "de-DE",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
]);
const DEFAULT_ASR_LANGUAGE = "en-US";

function normalizeAsrLanguage(input: string | undefined): string {
  if (!input || typeof input !== "string") return DEFAULT_ASR_LANGUAGE;
  if (SUPPORTED_ASR_LANGUAGES.has(input)) return input;
  // Accept a bare language code (e.g. "pt") by mapping to the first match.
  const lower = input.toLowerCase();
  for (const lang of SUPPORTED_ASR_LANGUAGES) {
    if (lang.toLowerCase().startsWith(lower + "-")) return lang;
  }
  return DEFAULT_ASR_LANGUAGE;
}

async function startConversationalAgent(params: {
  appId: string;
  appCertificate: string;
  channelName: string;
  userUid: number;
  systemPrompt: string;
  greeting: string;
  voiceSpeed: number;
  mcp: McpConfig;
  vision: VisionConfig;
  fillerPhrases: string[];
  asrLanguage: string;
}) {
  const anamApiKey = process.env.ANAM_API_KEY;
  const anamAvatarId = process.env.ANAM_AVATAR_ID;
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const openAiModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;
  const elevenLabsModelId =
    process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5";

  if (
    !anamApiKey ||
    !anamAvatarId ||
    !openAiApiKey ||
    !elevenLabsApiKey ||
    !elevenLabsVoiceId
  ) {
    return {
      started: false as const,
      reason: "missing_provider_configuration" as const,
    };
  }

  const agentRtcUid = Math.floor(100000 + Math.random() * 900000);
  const avatarRtcUid = Math.floor(100000 + Math.random() * 900000);
  const privilegeExpiredTs = Math.floor(Date.now() / 1000) + 60 * 60;

  const agentRtcToken = RtcTokenBuilder.buildTokenWithRtm(
    params.appId,
    params.appCertificate,
    params.channelName,
    String(agentRtcUid),
    RtcRole.PUBLISHER,
    privilegeExpiredTs,
    privilegeExpiredTs,
  );

  const avatarRtcToken = RtcTokenBuilder.buildTokenWithUid(
    params.appId,
    params.appCertificate,
    params.channelName,
    avatarRtcUid,
    RtcRole.PUBLISHER,
    privilegeExpiredTs,
    privilegeExpiredTs,
  );
  const authToken = RtcTokenBuilder.buildTokenWithRtm(
    params.appId,
    params.appCertificate,
    params.channelName,
    String(params.userUid),
    RtcRole.PUBLISHER,
    privilegeExpiredTs,
    privilegeExpiredTs,
  );

  let mcpServerName = "mcpserver";
  if (params.mcp.enabled) {
    try {
      mcpServerName = sanitizeMcpName(new URL(params.mcp.serverUrl).hostname);
    } catch {
      mcpServerName = "mcpserver";
    }
  }
  const mcpServers =
    params.mcp.enabled && params.mcp.serverUrl.trim()
      ? [
          {
            name: mcpServerName,
            endpoint: params.mcp.serverUrl,
            transport: "streamable_http",
            allowed_tools: ["*"],
            timeout_ms: 15000,
          },
        ]
      : [];

  const systemMessages: Array<{ role: "system"; content: string }> = [
    { role: "system", content: params.systemPrompt },
    {
      role: "system",
      content: `When the conversation begins, greet the user with exactly: "${params.greeting}"`,
    },
  ];

  // Vision addendum — only added when the client has the camera on, so
  // the agent doesn't hallucinate having eyes when it doesn't. The
  // primary use case is reading conference attendee badges: names,
  // companies, and roles printed on lanyards are the most
  // conversation-unlocking signal in the frame.
  if (params.vision.enabled) {
    systemMessages.push({
      role: "system",
      content: [
        "VISION IS ENABLED: the user has shared their camera and you receive a fresh frame every few seconds as image input. Treat the latest image as 'what you can see right now.'",
        "Badge reading is the priority use case. At the IIMA Digital Tech Show, visitors wear lanyards with a printed name and company. When you can read a badge:",
        "• Greet the visitor by their first name as soon as you're confident you've read it correctly (e.g. \"Oh, nice to meet you, Marina!\").",
        "• If you can also see the company, weave it in naturally (\"How's everything going at Petrobras?\"). Do not list every field on the badge — pick the one or two that make the conversation feel personal.",
        "• If the badge text is blurry, too small, glare-covered, or partially out of frame, do NOT guess. Say something warm like \"I can almost see your badge — could you hold it a bit closer?\" and try again on the next frame.",
        "• Never read a badge aloud character-by-character, never spell out IDs, QR codes, or numbers printed on it, and never mention that frames are arriving periodically — just behave like you're looking at the person.",
        "Beyond badges: briefly acknowledge other obvious visual cues when relevant (a laptop sticker, a conference tote, a t-shirt logo) as natural conversational hooks, but keep voice-first priorities — short spoken replies, no describing the scene unprompted.",
        "If the user explicitly asks what you see ('what am I holding?', 'what color is my shirt?'), answer from the latest frame confidently and concisely.",
      ].join(" "),
    });
  }

  const llmConfig: Record<string, unknown> = {
    url: "https://api.openai.com/v1/chat/completions",
    api_key: openAiApiKey,
    system_messages: systemMessages,
    greeting_message: params.greeting,
    max_history: 64,
    params: {
      model: openAiModel,
    },
  };
  if (mcpServers.length > 0) {
    llmConfig.mcp_servers = mcpServers;
  }
  // Flip the LLM into multimodal mode so it accepts frames pushed from
  // the client via the toolkit's sendImage (RTM). The selected model
  // (gpt-4o-mini by default) already supports vision. Agora's agent
  // relays these as image content on the next LLM turn.
  if (params.vision.enabled) {
    llmConfig.input_modalities = ["text", "image"];
  }

  const buildJoinBody = (name: string) => ({
    name,
    properties: {
      channel: params.channelName,
      token: agentRtcToken,
      agent_rtc_uid: String(agentRtcUid),
      remote_rtc_uids: [String(params.userUid)],
      advanced_features: {
        enable_rtm: true,
        enable_tools: mcpServers.length > 0,
      },
      parameters: {
        data_channel: "rtm",
        enable_metrics: true,
        enable_error_message: true,
        fixed_greeting: params.greeting,
        audio_scenario: "chorus",
      },
      llm: llmConfig,
      asr: {
        language: params.asrLanguage,
      },
      // Play short filler phrases when the LLM/MCP tool-call takes a
      // moment, so the agent doesn't feel frozen while the tool is
      // searching Agora docs.
      filler_words: {
        enable: true,
        trigger: {
          mode: "fixed_time",
          fixed_time_config: {
            response_wait_ms: 2500,
          },
        },
        content: {
          mode: "static",
          static_config: {
            phrases: params.fillerPhrases,
            selection_rule: "shuffle",
          },
        },
      },
      tts: {
        vendor: "elevenlabs",
        params: {
          base_url: "wss://api.elevenlabs.io/v1",
          key: elevenLabsApiKey,
          model_id: elevenLabsModelId,
          voice_id: elevenLabsVoiceId,
          sample_rate: 24000,
          speed: params.voiceSpeed,
        },
      },
      avatar: {
        vendor: "anam",
        enable: true,
        params: {
          api_key: anamApiKey,
          avatar_id: anamAvatarId,
          agora_uid: String(avatarRtcUid),
          agora_token: avatarRtcToken,
          sample_rate: 24000,
          quality: "high",
          video_encoding: "H264",
        },
      },
    },
  });

  const makeJoinRequest = async (name: string) => {
    const body = buildJoinBody(name);
    console.log(
      `[convai] POST /join name=${name} channel=${params.channelName} asr=${params.asrLanguage} mcp=${
        mcpServers.length > 0 ? "enabled" : "disabled"
      } vision=${params.vision.enabled ? "enabled" : "disabled"} speed=${params.voiceSpeed}`,
    );
    return fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${params.appId}/join`,
      {
        method: "POST",
        headers: {
          Authorization: `agora token=${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  };

  let response = await makeJoinRequest(
    `anam-openai-elevenlabs-${randomUUID().slice(0, 8)}`,
  );
  if (response.status === 409) {
    response = await makeJoinRequest(
      `anam-openai-elevenlabs-${randomUUID().slice(0, 8)}`,
    );
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[convai] join failed status=${response.status} body=${errorBody}`,
    );
    return {
      started: false as const,
      reason: "agora_join_failed" as const,
      details: errorBody,
    };
  }

  console.log(`[convai] join succeeded status=${response.status}`);

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return {
    started: true as const,
    agentId: String(payload.agent_id ?? payload.agentId ?? ""),
    agentRtcUid: String(payload.agent_rtc_uid ?? agentRtcUid),
    avatarRtcUid: String(avatarRtcUid),
  };
}

export async function POST(request: Request) {
  try {
    // Gate: the caller must be signed in (or in bypass mode locally).
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 },
      );
    }

    const payload = (await request.json()) as StartSessionPayload;

    // Prefer credentials supplied by the client (BYO Agora account).
    // Fall back to env vars for local development convenience.
    const appId = payload.appId?.trim() || process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate =
      payload.appCertificate?.trim() || process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
      return NextResponse.json(
        {
          error:
            "Missing Agora credentials. Provide appId and appCertificate in the request, or set NEXT_PUBLIC_AGORA_APP_ID and AGORA_APP_CERTIFICATE on the server.",
        },
        { status: 400 },
      );
    }

    // Reserve the user's remaining quota (or the per-session maximum,
    // whichever is lower). Bypassed / unlimited users get a no-op
    // reservation. If the user is out of time, bail before we spin up
    // the agent.
    const reservation = await reserve(user, quotaSecondsPerUser());
    if (!reservation) {
      return NextResponse.json(
        { error: "quota_exhausted" },
        { status: 402 },
      );
    }

    const channelName = `convai-demo-${randomUUID().slice(0, 8)}`;
    const uid = Math.floor(100000 + Math.random() * 900000);
    const expirationInSeconds = 60 * 60;
    const privilegeExpiredTs =
      Math.floor(Date.now() / 1000) + expirationInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      privilegeExpiredTs,
      privilegeExpiredTs,
    );
    const rtmToken = RtcTokenBuilder.buildTokenWithRtm(
      appId,
      appCertificate,
      channelName,
      String(uid),
      RtcRole.PUBLISHER,
      privilegeExpiredTs,
      privilegeExpiredTs,
    );

    const mcpInput = payload.mcp;
    const mcp: McpConfig =
      mcpInput && mcpInput.enabled && mcpInput.serverUrl?.trim()
        ? { enabled: true, serverUrl: mcpInput.serverUrl.trim() }
        : { enabled: false };

    const vision: VisionConfig = {
      enabled: Boolean(payload.vision?.enabled),
    };

    const agent = await startConversationalAgent({
      appId,
      appCertificate,
      channelName,
      userUid: uid,
      systemPrompt:
        payload.systemPrompt?.trim() ||
        "You are a digital twin of Yan, Agora's developer relations representative in Brazil, speaking live at the IIMA Digital Tech Show (https://iimainfo.com.br/digital-tech-show/). Showcase Agora's real-time engagement platform with a focus on Conversational AI, and note that this very session is powered by Agora Conversational AI with real-time TTS and a lifelike avatar. Keep replies warm, concise, and conversational (1–3 sentences), in plain spoken language, without markdown or lists.",
      greeting:
        payload.greeting?.trim() ||
        "Hi! I'm Yan's digital twin, powered by Agora's Conversational AI. Welcome to the IIMA Digital Tech Show! What would you like to know about Agora?",
      voiceSpeed: clampVoiceSpeed(payload.voiceSpeed),
      mcp,
      vision,
      fillerPhrases:
        Array.isArray(payload.fillerPhrases) &&
        payload.fillerPhrases.every((p) => typeof p === "string" && p.trim()) &&
        payload.fillerPhrases.length > 0
          ? payload.fillerPhrases.map((p) => p.trim()).slice(0, 10)
          : DEFAULT_FILLER_PHRASES_EN,
      asrLanguage: normalizeAsrLanguage(payload.asrLanguage),
    });

    return NextResponse.json({
      appId,
      channelName,
      uid,
      token,
      rtmToken,
      expiresAt: privilegeExpiredTs,
      systemPrompt: payload.systemPrompt ?? "",
      agent,
      reservation: {
        id: reservation.id,
        seconds: reservation.seconds,
      },
    });
  } catch (err) {
    console.error("[convai] /api/session/start failed:", err);
    return NextResponse.json(
      { error: "Invalid request payload." },
      { status: 400 },
    );
  }
}
