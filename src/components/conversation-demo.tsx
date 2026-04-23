"use client";

import {
  Captions,
  CaptionsOff,
  ChevronRight,
  Infinity as InfinityIcon,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RotateCcw,
  SendHorizontal,
  Settings2,
  Timer,
  User,
  Video,
  X
} from "lucide-react";

import { AgoraLogo } from "@/components/ui/agora-logo";
import { AgoraMark } from "@/components/ui/agora-mark";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageType } from "agora-agent-client-toolkit";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LanguageSelector } from "@/components/ui/language-selector";
import { MicDeviceSelector, type MicDevice } from "@/components/ui/mic-device-selector";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const DEFAULT_VOICE_SPEED = 0.9;
const MIN_VOICE_SPEED = 0.7;
const MAX_VOICE_SPEED = 1.2;
const DEFAULT_MCP_SERVER_URL = "https://agorawebhooks.duckdns.org/mcp/sse";

// How often to push a camera frame to the agent as `sendImage`.
// Every few seconds keeps the visual context fresh without flooding the
// LLM. Frames only flow while vision is on AND the call is connected.
const VISION_FRAME_INTERVAL_MS = 3000;
// Target dimensions + starting JPEG quality. Badges contain small
// printed text (~15-20px cap height at arm's length), so we want as
// much resolution as we can fit under the toolkit's ~32KB base64
// message ceiling. Going bigger (1080p) forces the toolkit to chunk
// the image across multiple RTM messages, which in practice arrived
// corrupted/out-of-order and broke OCR — the agent could see shapes
// but not read text. 960x720 single-packet is the sweet spot.
const VISION_FRAME_MAX_WIDTH = 960;
const VISION_FRAME_MAX_HEIGHT = 720;
const VISION_FRAME_JPEG_QUALITY = 0.72;
// Base64 size ceiling in bytes. Staying under ~28KB keeps first-try
// delivery reliable across network conditions and avoids triggering
// the toolkit's chunked-message path. Re-encode at lower quality if
// we overshoot.
const VISION_PAYLOAD_MAX_BYTES = 28 * 1024;
const VISION_QUALITY_FLOOR = 0.35;
const VISION_QUALITY_STEP = 0.1;

type SessionResponse = {
  appId: string;
  channelName: string;
  uid: number;
  token: string;
  rtmToken: string;
  agent: {
    started: boolean;
    reason?: "missing_provider_configuration" | "missing_app_certificate" | "agora_join_failed";
    details?: string;
    agentId?: string;
    agentRtcUid?: string;
    avatarRtcUid?: string;
  };
  reservation?: {
    id: string;
    seconds: number;
  };
};

type AuthUser = {
  id: string;
  email: string;
  name: string;
};

type Me =
  | {
      authenticated: false;
      authMode: "sso" | "bypass";
    }
  | {
      authenticated: true;
      authMode: "sso" | "bypass";
      user: AuthUser;
      unlimited: boolean;
      bypass: boolean;
      quotaSeconds: number;
      usedSeconds: number;
      remainingSeconds: number;
    };

type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/**
 * The toolkit emits the full chat history on every TRANSCRIPT_UPDATED.
 * Each TranscriptHelperItem is one bubble, keyed by (uid, turn_id),
 * with `text` that grows as the utterance evolves. Role = uid vs local uid.
 */
function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function roleForItem(item: any, localUid: string): "user" | "assistant" {
  const itemUid = String(item?.uid ?? "");
  if (itemUid && itemUid === String(localUid)) return "user";
  const objectType = String(item?.metadata?.object ?? "");
  if (objectType === MessageType.AGENT_TRANSCRIPTION) return "assistant";
  if (objectType === MessageType.USER_TRANSCRIPTION) return "user";
  return "assistant";
}

/**
 * Pull text out of a TranscriptHelperItem. Agent items in WORD/CHUNK mode may
 * carry text on metadata.text or as an array of words instead of item.text.
 */
function extractItemText(item: any): string {
  const direct = typeof item?.text === "string" ? item.text : "";
  if (direct.trim()) return direct.trim();

  const metaText = typeof item?.metadata?.text === "string" ? item.metadata.text : "";
  if (metaText.trim()) return metaText.trim();

  const words = item?.metadata?.words ?? item?.words;
  if (Array.isArray(words)) {
    const joined = words
      .map((w) => (typeof w?.word === "string" ? w.word : typeof w?.text === "string" ? w.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (joined) return joined;
  }

  return "";
}


type SpeechRecognitionResult = {
  [index: number]: {
    transcript: string;
    confidence: number;
  };
  isFinal: boolean;
  length: number;
};

type SpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: {
    [index: number]: SpeechRecognitionResult;
    length: number;
  };
};

type SpeechRecognitionInstance = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    SpeechRecognition?: SpeechRecognitionCtor;
  }
}

export function ConversationDemo() {
  const { t, localeMeta } = useI18n();

  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [typedMessage, setTypedMessage] = useState("");
  const [, setLiveCaption] = useState("");
  // Tracks whether the user has manually edited these fields; if not, they
  // auto-update when the locale changes so the agent replies in the selected
  // language out of the box.
  const systemPromptTouchedRef = useRef(false);
  const greetingTouchedRef = useRef(false);
  const [systemPrompt, setSystemPrompt] = useState<string>(t.systemPromptDefault);
  const [greeting, setGreeting] = useState<string>(t.greetingDefault);
  const [voiceSpeed, setVoiceSpeed] = useState<number>(DEFAULT_VOICE_SPEED);
  const [mcpEnabled, setMcpEnabled] = useState<boolean>(true);
  const [mcpServerUrl, setMcpServerUrl] = useState<string>(DEFAULT_MCP_SERVER_URL);
  const [visionEnabled, setVisionEnabled] = useState<boolean>(false);
  const [appId, setAppId] = useState<string>("");
  const [appCertificate, setAppCertificate] = useState<string>("");
  const [micDevices, setMicDevices] = useState<MicDevice[]>([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [agentState, setAgentState] = useState<string>("waiting_rtm");
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [showCaptions, setShowCaptions] = useState(false);
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null);

  // Auth + quota state. `me` is the server's view of who we are and
  // how much time we have left; it's refetched after login and after
  // each call so the countdown stays honest. While a call is live we
  // tick `liveRemainingSeconds` locally every second for a smooth UI.
  const [me, setMe] = useState<Me | null>(null);
  const [liveRemainingSeconds, setLiveRemainingSeconds] = useState<number | null>(null);
  const reservationRef = useRef<{ id: string; startedAt: number } | null>(null);

  // Hydrate overrides from localStorage once on mount. If a stored value
  // exists, treat the field as "touched" so locale changes don't clobber it.
  useEffect(() => {
    try {
      const storedPrompt = window.localStorage.getItem("yan.systemPrompt");
      if (storedPrompt !== null && storedPrompt !== "") {
        systemPromptTouchedRef.current = true;
        setSystemPrompt(storedPrompt);
      }
      const storedGreeting = window.localStorage.getItem("yan.greeting");
      if (storedGreeting !== null && storedGreeting !== "") {
        greetingTouchedRef.current = true;
        setGreeting(storedGreeting);
      }
      const storedSpeed = window.localStorage.getItem("yan.voiceSpeed");
      if (storedSpeed !== null) {
        const parsed = Number(storedSpeed);
        if (Number.isFinite(parsed) && parsed >= MIN_VOICE_SPEED && parsed <= MAX_VOICE_SPEED) {
          setVoiceSpeed(parsed);
        }
      }
      const storedMcpEnabled = window.localStorage.getItem("yan.mcpEnabled");
      if (storedMcpEnabled === "true" || storedMcpEnabled === "false") {
        setMcpEnabled(storedMcpEnabled === "true");
      }
      const storedMcpUrl = window.localStorage.getItem("yan.mcpServerUrl");
      if (storedMcpUrl !== null && storedMcpUrl !== "") {
        setMcpServerUrl(storedMcpUrl);
      }
      const storedVision = window.localStorage.getItem("yan.visionEnabled");
      if (storedVision === "true" || storedVision === "false") {
        setVisionEnabled(storedVision === "true");
      }
      const storedMic = window.localStorage.getItem("yan.micDeviceId");
      if (storedMic !== null && storedMic !== "") {
        setSelectedMicDeviceId(storedMic);
      }
      const storedAppId = window.localStorage.getItem("yan.appId");
      if (storedAppId !== null && storedAppId !== "") {
        setAppId(storedAppId);
      }
      const storedAppCert = window.localStorage.getItem("yan.appCertificate");
      if (storedAppCert !== null && storedAppCert !== "") {
        setAppCertificate(storedAppCert);
      }
    } catch {
      // storage unavailable — ignore
    }
  }, []);

  // Fetch identity + quota. Called on mount, after any auth redirect,
  // and whenever we finish a call (so the remaining-minutes chip updates).
  const refreshMe = useCallback(async () => {
    try {
      const res = await fetch("/api/session/me", { cache: "no-store" });
      if (!res.ok) {
        setMe({ authenticated: false, authMode: "sso" });
        return;
      }
      const data = (await res.json()) as Me;
      setMe(data);
    } catch (err) {
      console.warn("[auth] /me failed", err);
      setMe({ authenticated: false, authMode: "sso" });
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  // If we just came back from the SSO callback with ?authError=..., surface
  // it and strip the query param so a refresh doesn't keep showing it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const reason = url.searchParams.get("authError");
    if (!reason) return;
    setError(t.errors.authFailed(reason));
    url.searchParams.delete("authError");
    window.history.replaceState({}, "", url.toString());
  }, [t.errors]);

  // Enumerate microphones. Labels are hidden until the user grants
  // microphone permission, so we re-enumerate after the call starts too
  // (when getUserMedia has already been called) and whenever the OS
  // reports a device change.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    let cancelled = false;

    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const mics: MicDevice[] = list
          .filter((device) => device.kind === "audioinput" && device.deviceId)
          .map((device, idx) => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${idx + 1}`
          }));
        setMicDevices(mics);
        // If the persisted deviceId is no longer available (mic unplugged,
        // permission revoked, profile switch), drop it so we fall back to
        // the system default instead of failing getUserMedia.
        const permissionKnown = mics.some((m) => m.label);
        setSelectedMicDeviceId((prev) => {
          if (!prev) return prev;
          if (mics.some((m) => m.deviceId === prev)) return prev;
          if (!permissionKnown) return prev; // can't tell yet; keep it
          try {
            window.localStorage.removeItem("yan.micDeviceId");
          } catch {
            // ignore storage errors
          }
          return null;
        });
      } catch {
        // ignore — enumeration can fail in odd contexts
      }
    };

    void refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [status]);

  useEffect(() => {
    if (!systemPromptTouchedRef.current) {
      setSystemPrompt(t.systemPromptDefault);
    }
  }, [t.systemPromptDefault]);

  useEffect(() => {
    if (!greetingTouchedRef.current) {
      setGreeting(t.greetingDefault);
    }
  }, [t.greetingDefault]);

  const clientRef = useRef<any>(null);
  const rtmClientRef = useRef<any>(null);
  const voiceAiRef = useRef<any>(null);
  const aiToolkitRef = useRef<any>(null);
  const agentUidRef = useRef<string | null>(null);
  const agentSessionRef = useRef<{
    agentId: string;
    channelName: string;
    userUid: number;
    appId?: string;
    appCertificate?: string;
  } | null>(null);
  const localAudioTrackRef = useRef<any>(null);
  const localCameraTrackRef = useRef<any>(null);
  const visionFrameHandleRef = useRef<number | null>(null);
  const agoraRtcRef = useRef<any>(null);
  const agoraRtmRef = useRef<any>(null);
  const rtmChannelRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const avatarVideoRef = useRef<HTMLDivElement | null>(null);
  const selfViewRef = useRef<HTMLDivElement | null>(null);
  const applyTranscriptUpdate = useCallback((items: any[], localUid: string) => {
    // The toolkit delivers the full chat history as one item per
    // (uid, turn_id). In TEXT mode each item holds the final assembled
    // text for that turn — we just map them to bubbles.
    const next: TranscriptMessage[] = [];
    for (const item of items ?? []) {
      const text = extractItemText(item);
      if (!text) continue;
      next.push({
        id: `${item?.uid ?? "uid"}:${item?.turn_id ?? "turn"}`,
        role: roleForItem(item, localUid),
        text
      });
    }
    setTranscript(next);
  }, []);

  const sendMessageToAgent = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const agentUid = agentUidRef.current;
      if (!agentUid) {
        setError(t.errors.rtmNotReady);
        return;
      }

      try {
        setIsResponding(true);
        const { AgoraVoiceAI, ChatMessagePriority, ChatMessageType } = await import(
          "agora-agent-client-toolkit"
        );
        const voiceAi = AgoraVoiceAI.getInstance();
        await voiceAi.sendText(agentUid, {
          messageType: ChatMessageType.TEXT,
          text: trimmed,
          priority: ChatMessagePriority.INTERRUPTED,
          responseInterruptable: true
        });
      } catch {
        setError(t.errors.sendFailed);
      } finally {
        setIsResponding(false);
      }
    },
    [t.errors.rtmNotReady, t.errors.sendFailed]
  );

  // Browser SpeechRecognition is used only for a live caption hint while the
  // user is talking. Actual user transcript bubbles come from the agent over
  // RTM (USER_TRANSCRIPTION). We never re-send mic text as a chat message —
  // that would duplicate what the agent already hears via RTC audio.
  const setupSpeechRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = localeMeta.speechLang;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const phrase = event.results[i][0]?.transcript ?? "";
        if (!event.results[i].isFinal) interim += phrase;
      }
      setLiveCaption(interim.trim());
    };

    recognition.onerror = () => {
      setLiveCaption("");
    };

    recognition.start();
    recognitionRef.current = recognition;
  }, [localeMeta.speechLang]);

  const stopSpeechRecognition = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setLiveCaption("");
  }, []);

  // Capture a still frame from the <video> element the Agora camera
  // track renders into, scale it down to a size that comfortably fits
  // the toolkit's ~32KB base64 ceiling, and push it to the agent via
  // RTM. Called on a short interval while vision is on.
  const captureAndSendFrame = useCallback(async () => {
    const voiceAi = voiceAiRef.current;
    const agentUid = agentUidRef.current;
    const cameraTrack = localCameraTrackRef.current;
    const aiToolkit = aiToolkitRef.current;
    if (!voiceAi || !agentUid || !cameraTrack || !aiToolkit) return;

    const startedAt = performance.now();
    try {
      // Agora's camera track holds a MediaStreamTrack we can sample.
      // `getMediaStreamTrack()` is the stable accessor across SDK versions.
      const mediaTrack: MediaStreamTrack | undefined =
        typeof cameraTrack.getMediaStreamTrack === "function"
          ? cameraTrack.getMediaStreamTrack()
          : undefined;
      if (!mediaTrack) return;

      // ImageCapture is the cleanest way to grab a frame without
      // juggling <video> DOM nodes, but Safari still doesn't ship it.
      // Fall back to a hidden <video> + <canvas> draw when it's missing.
      let bitmap: ImageBitmap | null = null;
      const ImageCaptureCtor = (window as unknown as {
        ImageCapture?: new (track: MediaStreamTrack) => {
          grabFrame: () => Promise<ImageBitmap>;
        };
      }).ImageCapture;
      if (ImageCaptureCtor) {
        try {
          const capture = new ImageCaptureCtor(mediaTrack);
          bitmap = await capture.grabFrame();
        } catch {
          bitmap = null;
        }
      }

      let sourceWidth: number;
      let sourceHeight: number;
      let drawSource: CanvasImageSource;
      let videoEl: HTMLVideoElement | null = null;

      if (bitmap) {
        sourceWidth = bitmap.width;
        sourceHeight = bitmap.height;
        drawSource = bitmap;
      } else {
        videoEl = document.createElement("video");
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.srcObject = new MediaStream([mediaTrack]);
        await videoEl.play().catch(() => {});
        // Wait a tick so width/height populate.
        if (!videoEl.videoWidth) {
          await new Promise<void>((resolve) => {
            const onLoaded = () => resolve();
            videoEl?.addEventListener("loadedmetadata", onLoaded, { once: true });
            window.setTimeout(resolve, 500);
          });
        }
        sourceWidth = videoEl.videoWidth || VISION_FRAME_MAX_WIDTH;
        sourceHeight = videoEl.videoHeight || VISION_FRAME_MAX_HEIGHT;
        drawSource = videoEl;
      }

      const scale = Math.min(
        1,
        VISION_FRAME_MAX_WIDTH / sourceWidth,
        VISION_FRAME_MAX_HEIGHT / sourceHeight,
      );
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap?.close?.();
        videoEl?.remove();
        return;
      }
      ctx.drawImage(drawSource, 0, 0, targetWidth, targetHeight);
      bitmap?.close?.();
      videoEl?.remove();

      // Encode at target quality, then step quality down if the payload
      // is over budget. Base64 length is deterministic from JPEG byte
      // size (4/3 expansion) so we can use it directly as the ceiling.
      let quality = VISION_FRAME_JPEG_QUALITY;
      let base64 = canvas
        .toDataURL("image/jpeg", quality)
        .slice("data:image/jpeg;base64,".length);
      let encodeAttempts = 1;
      while (
        base64.length > VISION_PAYLOAD_MAX_BYTES &&
        quality > VISION_QUALITY_FLOOR
      ) {
        quality = Math.max(VISION_QUALITY_FLOOR, quality - VISION_QUALITY_STEP);
        base64 = canvas
          .toDataURL("image/jpeg", quality)
          .slice("data:image/jpeg;base64,".length);
        encodeAttempts += 1;
      }

      const { ChatMessageType } = aiToolkit;
      const uuid = crypto.randomUUID();
      await voiceAi.sendImage(agentUid, {
        messageType: ChatMessageType.IMAGE,
        uuid,
        base64,
      });

      const payloadKb = Math.round(base64.length / 102.4) / 10;
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(
        `[vision] frame sent → agent=${agentUid} uuid=${uuid.slice(0, 8)} size=${targetWidth}x${targetHeight} q=${quality.toFixed(2)}${encodeAttempts > 1 ? ` (${encodeAttempts} encodes)` : ""} payload=${payloadKb}KB elapsed=${elapsedMs}ms source=${bitmap ? "ImageCapture" : "video"}`,
      );
    } catch (err) {
      console.warn("[vision] failed to send frame", err);
    }
  }, []);

  const stopVisionFrameLoop = useCallback(() => {
    if (visionFrameHandleRef.current !== null) {
      window.clearInterval(visionFrameHandleRef.current);
      visionFrameHandleRef.current = null;
    }
  }, []);

  const startVisionFrameLoop = useCallback(() => {
    stopVisionFrameLoop();
    // Kick one frame immediately so the first visible context lands
    // before the first interval fires.
    void captureAndSendFrame();
    visionFrameHandleRef.current = window.setInterval(() => {
      void captureAndSendFrame();
    }, VISION_FRAME_INTERVAL_MS);
  }, [captureAndSendFrame, stopVisionFrameLoop]);

  const cleanupSession = useCallback(async () => {
    stopSpeechRecognition();
    stopVisionFrameLoop();

    // Tear down the ConvAI agent server-side so it stops running (and
    // billing) instead of waiting for its session timeout. Fire-and-forget
    // with a short timeout so a slow leave call doesn't block UI teardown.
    const agentSession = agentSessionRef.current;
    const reservation = reservationRef.current;
    reservationRef.current = null;
    if (agentSession || reservation) {
      agentSessionRef.current = null;
      const stopBody = {
        ...(agentSession ?? {}),
        reservationId: reservation?.id,
        elapsedSeconds: reservation
          ? Math.max(
              0,
              Math.floor((Date.now() - reservation.startedAt) / 1000),
            )
          : 0,
      };
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        await fetch("/api/session/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stopBody),
          signal: controller.signal,
          keepalive: true
        }).catch((err) => {
          console.warn("[convai] stop request failed", err);
        });
        clearTimeout(timeout);
      } catch (err) {
        console.warn("[convai] stop request threw", err);
      }
      // Refresh the quota chip so the remaining-minutes readout is accurate.
      void refreshMe();
    }

    const client = clientRef.current;
    const voiceAi = voiceAiRef.current;
    const rtmClient = rtmClientRef.current;
    if (voiceAi) {
      voiceAi.unsubscribe?.();
      voiceAi.destroy?.();
      voiceAiRef.current = null;
    }
    if (rtmClient) {
      if (rtmChannelRef.current) {
        await rtmClient.unsubscribe?.(rtmChannelRef.current);
      }
      await rtmClient.logout?.();
      rtmClientRef.current = null;
    }
    rtmChannelRef.current = null;
    agentUidRef.current = null;
    setAgentState("waiting_rtm");
    if (localAudioTrackRef.current) {
      localAudioTrackRef.current.stop();
      localAudioTrackRef.current.close();
      localAudioTrackRef.current = null;
    }
    if (localCameraTrackRef.current) {
      try {
        localCameraTrackRef.current.stop();
        localCameraTrackRef.current.close();
      } catch {
        // already stopped
      }
      localCameraTrackRef.current = null;
    }
    if (client) {
      await client.leave();
      clientRef.current = null;
    }
    setStatus("idle");
    setIsMuted(false);
    if (avatarVideoRef.current) {
      avatarVideoRef.current.innerHTML = "";
    }
    if (selfViewRef.current) {
      selfViewRef.current.innerHTML = "";
    }
  }, [refreshMe, stopSpeechRecognition, stopVisionFrameLoop]);

  const startCall = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    setTranscript([]);

    try {
      const startRes = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt,
          greeting,
          voiceSpeed,
          fillerPhrases: t.fillerPhrases,
          asrLanguage: localeMeta.speechLang,
          appId: appId.trim() || undefined,
          appCertificate: appCertificate.trim() || undefined,
          mcp: mcpEnabled && mcpServerUrl.trim()
            ? { enabled: true, serverUrl: mcpServerUrl.trim() }
            : { enabled: false },
          vision: { enabled: visionEnabled }
        })
      });

      if (!startRes.ok) {
        const payload = (await startRes.json().catch(() => ({}))) as { error?: string };
        // 402 = out of quota, 401 = session cookie missing/expired. Translate
        // both into user-friendly messages before bailing.
        if (startRes.status === 402 || payload.error === "quota_exhausted") {
          await refreshMe();
          setStatus("idle");
          throw new Error(t.errors.quotaExhausted);
        }
        if (startRes.status === 401) {
          await refreshMe();
          setStatus("idle");
          throw new Error(t.errors.notAuthenticated);
        }
        throw new Error(payload.error ?? t.errors.startFailed);
      }

      const session = (await startRes.json()) as SessionResponse;

      // Record the reservation so heartbeats and /stop can report the
      // elapsed time against the right bucket.
      if (session.reservation?.id) {
        reservationRef.current = {
          id: session.reservation.id,
          startedAt: Date.now(),
        };
      }

      // Remember the agent session so we can hit /api/session/stop later
      // and explicitly tear down the Agora Conversational AI agent.
      if (session.agent.started && session.agent.agentId) {
        agentSessionRef.current = {
          agentId: session.agent.agentId,
          channelName: session.channelName,
          userUid: session.uid,
          appId: appId.trim() || undefined,
          appCertificate: appCertificate.trim() || undefined
        };
      }

      if (!agoraRtcRef.current) {
        const mod = await import("agora-rtc-sdk-ng");
        agoraRtcRef.current = mod.default;
      }
      if (!agoraRtmRef.current) {
        const mod = await import("agora-rtm");
        agoraRtmRef.current = mod.default;
      }
      if (!aiToolkitRef.current) {
        aiToolkitRef.current = await import("agora-agent-client-toolkit");
      }
      const AgoraRTC = agoraRtcRef.current;
      const AgoraRTM = agoraRtmRef.current;
      const { AgoraVoiceAI, AgoraVoiceAIEvents, TranscriptHelperMode } = aiToolkitRef.current;

      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = client;

      client.on("user-published", async (remoteUser: any, mediaType: string) => {
        await client.subscribe(remoteUser, mediaType);
        if (mediaType === "audio") {
          remoteUser.audioTrack?.play();
        }
        if (mediaType === "video" && avatarVideoRef.current) {
          remoteUser.videoTrack?.play(avatarVideoRef.current);
        }
      });

      // Initialize RTM + toolkit BEFORE joining the RTC channel so the
      // toolkit's `audio-pts` listener is bound before the agent's TTS frames
      // start flowing. Otherwise the first turn's PTS events are missed and
      // WORD-mode buffers the whole turn, producing the "one turn behind,
      // not word-by-word" behavior.
      const rtmClient = new AgoraRTM.RTM(session.appId, String(session.uid));
      await rtmClient.login({ token: session.rtmToken });
      await rtmClient.subscribe(session.channelName);
      rtmClientRef.current = rtmClient;
      rtmChannelRef.current = session.channelName;

      let voiceAi: any = null;
      if (session.agent.started) {
        voiceAi = await AgoraVoiceAI.init({
          rtcEngine: client,
          rtmConfig: { rtmEngine: rtmClient },
          renderMode: TranscriptHelperMode.TEXT
        });
        voiceAi.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items: any[]) => {
          applyTranscriptUpdate(items, String(session.uid));
        });
        voiceAi.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (agentUserId: string, event: any) => {
          agentUidRef.current = agentUserId;
          setAgentState(String(event?.state ?? "idle"));
        });
        voiceAi.on(AgoraVoiceAIEvents.AGENT_ERROR, (_agentUserId: string, evt: any) => {
          setError(String(evt?.message ?? "Unknown agent error"));
        });
        voiceAi.subscribeMessage(session.channelName);
        voiceAiRef.current = voiceAi;
        agentUidRef.current = session.agent.agentRtcUid ?? null;
        setAgentState("connecting");
      } else {
        setError(
          `Call connected, but agent start failed: ${session.agent.reason ?? "unknown_reason"}${
            session.agent.details ? ` | ${session.agent.details.slice(0, 180)}` : ""
          }`
        );
      }

      await client.join(session.appId, session.channelName, session.token, session.uid);

      // Create the mic track. If a previously-persisted deviceId is stale
      // (e.g. the USB mic was unplugged or the browser forgot the perm),
      // getUserMedia sometimes returns but Agora can't find the stream,
      // throwing "UNEXPECTED_ERROR: can not find stream after getUserMedia".
      // Retry once with the system default before giving up.
      let track: Awaited<ReturnType<typeof AgoraRTC.createMicrophoneAudioTrack>>;
      try {
        track = await AgoraRTC.createMicrophoneAudioTrack(
          selectedMicDeviceId ? { microphoneId: selectedMicDeviceId } : undefined
        );
      } catch (micErr) {
        console.warn(
          "createMicrophoneAudioTrack failed, retrying with system default",
          micErr
        );
        if (selectedMicDeviceId) {
          try {
            window.localStorage.removeItem("yan.micDeviceId");
          } catch {
            // ignore storage errors
          }
          setSelectedMicDeviceId(null);
          track = await AgoraRTC.createMicrophoneAudioTrack();
        } else {
          throw micErr;
        }
      }
      localAudioTrackRef.current = track;
      await client.publish([track]);

      // Open the camera locally (best-effort). We deliberately do NOT
      // publish it to the RTC channel — the agent gets visual context
      // exclusively through sendImage over RTM. Publishing would
      // broadcast the user's camera to every other participant (none
      // today, but a footgun waiting to happen) and waste upstream
      // bandwidth on a stream nothing consumes. Failure must not kill
      // the voice call.
      if (visionEnabled) {
        try {
          const cameraTrack = await AgoraRTC.createCameraVideoTrack({
            encoderConfig: "720p_1",
          });
          localCameraTrackRef.current = cameraTrack;
          if (selfViewRef.current) {
            cameraTrack.play(selfViewRef.current, { mirror: true });
          }
          startVisionFrameLoop();
        } catch (camErr) {
          console.warn("[vision] camera capture failed", camErr);
          setError(t.settings.visionCameraError);
        }
      }

      setStatus("connected");
      setupSpeechRecognition();
    } catch (err) {
      await cleanupSession();
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Unknown error while starting call.");
    }
  }, [
    appCertificate,
    appId,
    applyTranscriptUpdate,
    cleanupSession,
    greeting,
    localeMeta.speechLang,
    mcpEnabled,
    mcpServerUrl,
    refreshMe,
    selectedMicDeviceId,
    setupSpeechRecognition,
    startVisionFrameLoop,
    systemPrompt,
    t.errors.notAuthenticated,
    t.errors.quotaExhausted,
    t.errors.startFailed,
    t.fillerPhrases,
    t.settings.visionCameraError,
    visionEnabled,
    voiceSpeed
  ]);

  const handleMicDeviceChange = useCallback(async (deviceId: string | null) => {
    setSelectedMicDeviceId(deviceId);
    try {
      if (deviceId) {
        window.localStorage.setItem("yan.micDeviceId", deviceId);
      } else {
        window.localStorage.removeItem("yan.micDeviceId");
      }
    } catch {
      // ignore storage errors
    }

    // If we're currently in a call, swap the device live without
    // rebuilding the publisher. setDevice accepts the empty string to
    // mean "system default".
    const track = localAudioTrackRef.current;
    if (track?.setDevice) {
      try {
        await track.setDevice(deviceId ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to switch microphone.");
      }
    }
  }, []);

  const resetSettingsToDefaults = useCallback(() => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(t.settings.restoreDefaultsConfirm);
      if (!ok) return;
    }

    setSystemPrompt(t.systemPromptDefault);
    setGreeting(t.greetingDefault);
    setVoiceSpeed(DEFAULT_VOICE_SPEED);
    setMcpEnabled(true);
    setMcpServerUrl(DEFAULT_MCP_SERVER_URL);
    setVisionEnabled(false);
    systemPromptTouchedRef.current = false;
    greetingTouchedRef.current = false;

    try {
      window.localStorage.removeItem("yan.systemPrompt");
      window.localStorage.removeItem("yan.greeting");
      window.localStorage.removeItem("yan.voiceSpeed");
      window.localStorage.removeItem("yan.mcpEnabled");
      window.localStorage.removeItem("yan.mcpServerUrl");
      window.localStorage.removeItem("yan.visionEnabled");
    } catch {
      // ignore storage errors
    }
  }, [t.greetingDefault, t.settings.restoreDefaultsConfirm, t.systemPromptDefault]);

  const toggleMute = useCallback(async () => {
    const next = !isMuted;
    setIsMuted(next);
    await localAudioTrackRef.current?.setMuted(next);

    if (next) {
      stopSpeechRecognition();
    } else if (status === "connected") {
      setupSpeechRecognition();
    }
  }, [isMuted, setupSpeechRecognition, status, stopSpeechRecognition]);

  const endCall = useCallback(async () => {
    await cleanupSession();
  }, [cleanupSession]);

  const connectionBadge = useMemo(() => {
    if (status === "connected") return <Badge variant="success">{t.status.live}</Badge>;
    if (status === "connecting") return <Badge variant="warn">{t.status.connecting}</Badge>;
    return <Badge>{t.status.idle}</Badge>;
  }, [status, t.status.idle, t.status.connecting, t.status.live]);

  const hasCredentials = Boolean(appId.trim() && appCertificate.trim());

  // Latest assistant line for the caption overlay.
  const latestAssistantLine = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const m = transcript[i];
      if (m.role === "assistant" && m.text.trim()) return m.text;
    }
    return "";
  }, [transcript]);

  useEffect(() => {
    return () => {
      void cleanupSession();
    };
  }, [cleanupSession]);

  // If the user closes the tab/window or navigates away while an agent is
  // running, fire a best-effort /stop via sendBeacon so the agent tears
  // down server-side instead of running until it times out.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stopOnUnload = () => {
      const session = agentSessionRef.current;
      const reservation = reservationRef.current;
      if (!session && !reservation) return;
      try {
        const body = {
          ...(session ?? {}),
          reservationId: reservation?.id,
          elapsedSeconds: reservation
            ? Math.max(
                0,
                Math.floor((Date.now() - reservation.startedAt) / 1000),
              )
            : 0,
        };
        const blob = new Blob([JSON.stringify(body)], {
          type: "application/json"
        });
        navigator.sendBeacon?.("/api/session/stop", blob);
      } catch {
        // sendBeacon can throw on some browsers; nothing useful to do here.
      }
    };
    window.addEventListener("pagehide", stopOnUnload);
    window.addEventListener("beforeunload", stopOnUnload);
    return () => {
      window.removeEventListener("pagehide", stopOnUnload);
      window.removeEventListener("beforeunload", stopOnUnload);
    };
  }, []);

  useEffect(() => {
    transcriptBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript]);

  // While a call is live and the account is quota-limited, tick a local
  // countdown every second (smooth UI) and send a heartbeat every 30s
  // (keeps the server-side reservation alive). When the countdown hits
  // zero we end the call automatically so we don't run past the budget.
  useEffect(() => {
    if (status !== "connected") {
      setLiveRemainingSeconds(null);
      return;
    }
    if (!me || !me.authenticated || me.unlimited) {
      setLiveRemainingSeconds(null);
      return;
    }
    const startedAt = reservationRef.current?.startedAt ?? Date.now();
    const initialRemaining = me.remainingSeconds;
    setLiveRemainingSeconds(initialRemaining);

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(0, initialRemaining - elapsed);
      setLiveRemainingSeconds(remaining);
      if (remaining <= 0) {
        void cleanupSession();
      }
    };
    const tickHandle = window.setInterval(tick, 1000);

    const heartbeatHandle = window.setInterval(() => {
      const reservation = reservationRef.current;
      if (!reservation) return;
      void fetch("/api/session/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: reservation.id }),
      }).catch(() => {
        // Best-effort; the reservation TTL is long enough that a
        // temporary network glitch won't kill the session.
      });
    }, 30_000);

    return () => {
      window.clearInterval(tickHandle);
      window.clearInterval(heartbeatHandle);
    };
  }, [cleanupSession, me, status]);

  const handleSignIn = useCallback(() => {
    window.location.href = "/api/auth/agora/start";
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/agora/logout", { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as {
        redirect?: string;
      };
      window.location.href = payload.redirect ?? "/";
    } catch {
      window.location.href = "/";
    }
  }, []);

  const isIdle = status === "idle";
  const isConnecting = status === "connecting";
  const isConnected = status === "connected";

  // Derived quota display: use the live countdown when a call is in
  // progress, otherwise the last value /api/session/me returned.
  const effectiveRemainingSeconds =
    me?.authenticated && !me.unlimited
      ? liveRemainingSeconds ?? me.remainingSeconds
      : null;
  const quotaExhausted =
    !!me &&
    me.authenticated &&
    !me.unlimited &&
    effectiveRemainingSeconds !== null &&
    effectiveRemainingSeconds <= 0 &&
    status === "idle";
  const canStart =
    !!me &&
    me.authenticated &&
    hasCredentials &&
    (me.unlimited ||
      (effectiveRemainingSeconds ?? 0) > 0);

  // While we're still fetching identity, avoid a login flash.
  if (me === null) {
    return (
      <main className="flex h-screen w-screen items-center justify-center text-slate-400">
        <LoaderCircle className="h-5 w-5 animate-spin" />
      </main>
    );
  }

  if (!me.authenticated) {
    return (
      <main className="flex h-screen w-screen items-center justify-center px-4 text-slate-100">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <AgoraLogo className="h-10 w-auto" />
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{t.auth.signInTitle}</h1>
            <p className="text-sm text-slate-400">{t.auth.signInSubtitle}</p>
          </div>
          <Button size="lg" onClick={handleSignIn} className="w-full">
            {t.auth.signInButton}
          </Button>
          <p className="text-xs text-slate-500">{t.auth.signInNote}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden text-slate-100">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-white/5 bg-slate-950/50 px-4 py-3 backdrop-blur-sm md:px-6">
        <div className="flex items-center gap-3">
          <AgoraLogo className="h-7 w-auto" />
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-semibold text-slate-100">{t.app.title}</p>
            <p className="text-xs text-slate-400">{t.app.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Quota chip: "Unlimited" / "Dev mode" for bypass, else "M:SS left". */}
          {me.unlimited ? (
            <Badge variant="default" className="gap-1">
              {me.authMode === "bypass" ? (
                <>
                  <Timer className="h-3 w-3" />
                  {t.auth.devMode}
                </>
              ) : (
                <>
                  <InfinityIcon className="h-3 w-3" />
                  {t.auth.unlimited}
                </>
              )}
            </Badge>
          ) : effectiveRemainingSeconds !== null ? (
            <Badge
              variant={effectiveRemainingSeconds <= 60 ? "danger" : "default"}
              className="gap-1"
            >
              <Timer className="h-3 w-3" />
              {t.auth.minutesLeft(formatDuration(effectiveRemainingSeconds))}
            </Badge>
          ) : null}
          {/* User chip + sign out */}
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-xs text-slate-300 md:flex">
            <User className="h-3.5 w-3.5" />
            <span className="max-w-[160px] truncate">
              {me.user.email || me.user.name || me.user.id}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
              title={t.auth.signOut}
              aria-label={t.auth.signOut}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
          {connectionBadge}
          {isConnected ? (
            <Badge variant="default" className="uppercase tracking-wide">
              {agentState}
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.controls.settings}
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Stage: avatar center + chat right.
          On narrow screens everything stacks and the page scrolls; on md+
          we lock to the viewport so the avatar fills the vertical space. */}
      <div className="relative flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:min-h-0 md:flex-row md:gap-6 md:overflow-hidden md:p-6">
        {/* Avatar stage */}
        <section className="relative flex min-w-0 flex-1 items-center justify-center md:min-h-0">
          <div className="relative aspect-[4/3] h-auto w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-black shadow-2xl shadow-black/60 md:h-full md:w-auto md:max-h-full md:min-h-[320px] md:min-w-[280px]">
            <div ref={avatarVideoRef} className="absolute inset-0 h-full w-full" />
            {/* Placeholder when no video yet */}
            {!isConnected ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-slate-900/40 via-slate-950/60 to-black/80 px-6 text-center">
                <AgoraLogo className="h-14 w-auto drop-shadow-[0_0_24px_rgba(0,194,255,0.25)]" />
                {quotaExhausted ? (
                  <div className="max-w-sm space-y-2">
                    <p className="text-base font-semibold text-slate-100">
                      {t.auth.quotaExhaustedTitle}
                    </p>
                    <p className="text-sm text-slate-400">
                      {t.auth.quotaExhaustedBody}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-300">
                    {isConnecting ? t.stage.connecting : t.stage.pressStart}
                  </p>
                )}
              </div>
            ) : null}

            {/* Agent name tag */}
            <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs font-medium text-slate-200 backdrop-blur-md">
              <AgoraMark className="h-3.5 w-3.5 text-[color:var(--agora-blue)]" />
              {t.stage.assistant}
              {isConnected ? (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[color:var(--agora-blue)] shadow-[0_0_8px_rgba(0,194,255,0.85)]" />
              ) : null}
            </div>

            {/* Self-view PIP — only rendered while the camera is on so
                the user has a clear signal that they're being filmed. */}
            <div
              ref={selfViewRef}
              className={cn(
                "absolute bottom-4 right-4 h-28 w-36 overflow-hidden rounded-xl border border-white/10 bg-black/60 shadow-lg backdrop-blur-sm md:h-32 md:w-44",
                visionEnabled && isConnected ? "block" : "hidden"
              )}
              aria-hidden="true"
            />

            {/* Caption overlay */}
            {showCaptions && latestAssistantLine ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6">
                <p className="max-w-[90%] rounded-lg bg-black/70 px-4 py-2 text-center text-base leading-snug text-white shadow-lg backdrop-blur-sm md:text-lg">
                  {latestAssistantLine}
                </p>
              </div>
            ) : null}
          </div>

          {/* Chat toggle tab — sits on the edge of the stage facing the chat.
              Styled as a slim Agora-blue glass handle: subtle gradient,
              hairline border, and a soft cyan glow on hover. On mobile it
              clings to the bottom edge; on md+ to the right edge. */}
          <button
            type="button"
            onClick={() => setShowChat((v) => !v)}
            aria-label={showChat ? t.controls.hideChat : t.controls.showChat}
            title={showChat ? t.controls.hideChat : t.controls.showChat}
            className={cn(
              "group absolute z-20 flex items-center justify-center",
              "rounded-full border border-white/10 bg-slate-950/70 backdrop-blur-md",
              "text-slate-400 transition-all duration-200 ease-out",
              "hover:border-[color:var(--agora-primary)]/50 hover:text-[color:var(--agora-blue)]",
              "hover:bg-slate-900/80 hover:shadow-[0_0_20px_rgba(0,194,255,0.35)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--agora-primary)]/60",
              // Mobile (stacked): bottom-center, horizontal pill
              "bottom-0 left-1/2 h-7 w-14 -translate-x-1/2 translate-y-1/2",
              // Desktop (side-by-side): right-center, vertical pill
              "md:bottom-auto md:left-auto md:right-0 md:top-1/2 md:h-14 md:w-7 md:-translate-y-1/2 md:translate-x-1/2"
            )}
          >
            {/* Faint inner gradient sheen for a bit of depth */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/5 to-transparent md:bg-gradient-to-r"
            />
            {/* Icon points in the direction the chat will move when toggled. */}
            {showChat ? (
              <ChevronRight className="relative h-3.5 w-3.5 rotate-90 transition-transform duration-200 group-hover:translate-y-0.5 md:rotate-0 md:group-hover:translate-x-0.5 md:group-hover:translate-y-0" />
            ) : (
              <ChevronRight className="relative h-3.5 w-3.5 -rotate-90 transition-transform duration-200 group-hover:-translate-y-0.5 md:rotate-180 md:group-hover:-translate-x-0.5 md:group-hover:translate-y-0" />
            )}
          </button>
        </section>


        {/* Chat panel */}
        {showChat ? (
        <aside className="flex h-[420px] w-full shrink-0 flex-col md:h-auto md:min-h-0 md:w-[340px] lg:w-[380px]">
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="border-b border-white/5">
              <div className="flex items-center justify-between">
                <CardTitle>{t.chat.title}</CardTitle>
                <Badge variant="default">{t.chat.messageCount(transcript.length)}</Badge>
              </div>
              <CardDescription>{t.chat.description}</CardDescription>
            </CardHeader>

            <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
              {transcript.length === 0 ? (
                <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
                    <MessageSquare className="h-4 w-4 text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-400">{t.chat.empty}</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {transcript.map((message) => {
                    const isUser = message.role === "user";
                    return (
                      <li
                        key={message.id}
                        className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                      >
                        {!isUser ? (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--agora-primary)]/30 bg-[color:var(--agora-primary)]/15 text-[color:var(--agora-blue)]">
                            <AgoraMark className="h-3.5 w-3.5" />
                          </div>
                        ) : null}
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
                            isUser
                              ? "rounded-br-md bg-[color:var(--agora-primary)] text-white"
                              : "rounded-bl-md border border-white/10 bg-white/5 text-slate-100"
                          }`}
                        >
                          {message.text}
                        </div>
                        {isUser ? (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300">
                            <User className="h-3.5 w-3.5" />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div ref={transcriptBottomRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-white/5 p-4">
              <div className="flex items-end gap-2">
                <Input
                  value={typedMessage}
                  onChange={(event) => setTypedMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessageToAgent(typedMessage);
                      setTypedMessage("");
                    }
                  }}
                  placeholder={
                    isConnected ? t.chat.composerPlaceholder : t.chat.composerPlaceholderIdle
                  }
                  disabled={!isConnected}
                />
                <Button
                  size="icon"
                  disabled={!isConnected || !typedMessage.trim() || isResponding}
                  onClick={() => {
                    void sendMessageToAgent(typedMessage);
                    setTypedMessage("");
                  }}
                  aria-label={t.chat.send}
                >
                  {isResponding ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <SendHorizontal className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {error ? (
                <p className="mt-2 rounded-lg border border-[color:var(--agora-accent-negative)]/25 bg-[color:var(--agora-accent-negative)]/10 px-3 py-2 text-xs text-[color:var(--agora-accent-negative)]">
                  {error}
                </p>
              ) : null}
            </div>
          </Card>
        </aside>
        ) : null}

        {/* Settings drawer (overlay) */}
        {showSettings ? (
          <div className="absolute inset-0 z-20 flex items-start justify-end bg-black/40 p-4 backdrop-blur-sm md:p-6">
            <Card className="flex max-h-full w-full max-w-md flex-col overflow-hidden">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>{t.settings.title}</CardTitle>
                  <CardDescription>{t.settings.description}</CardDescription>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t.settings.close}
                  onClick={() => setShowSettings(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="scrollbar-thin flex-1 space-y-4 overflow-y-auto">
                <div className="space-y-2 rounded-lg border border-[color:var(--agora-primary)]/20 bg-[color:var(--agora-primary)]/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--agora-blue)]">
                      {t.settings.credentials}
                    </p>
                    {hasCredentials ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAppId("");
                          setAppCertificate("");
                          try {
                            window.localStorage.removeItem("yan.appId");
                            window.localStorage.removeItem("yan.appCertificate");
                          } catch {
                            // ignore storage errors
                          }
                        }}
                      >
                        {t.settings.clearCredentials}
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400" htmlFor="yan-app-id">
                      {t.settings.appId}
                    </label>
                    <Input
                      id="yan-app-id"
                      value={appId}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => {
                        const next = event.target.value.trim();
                        setAppId(next);
                        try {
                          if (next) {
                            window.localStorage.setItem("yan.appId", next);
                          } else {
                            window.localStorage.removeItem("yan.appId");
                          }
                        } catch {
                          // ignore storage errors
                        }
                      }}
                      placeholder={t.settings.appIdPlaceholder}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      className="text-xs text-slate-400"
                      htmlFor="yan-app-certificate"
                    >
                      {t.settings.appCertificate}
                    </label>
                    <Input
                      id="yan-app-certificate"
                      type="password"
                      value={appCertificate}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => {
                        const next = event.target.value.trim();
                        setAppCertificate(next);
                        try {
                          if (next) {
                            window.localStorage.setItem("yan.appCertificate", next);
                          } else {
                            window.localStorage.removeItem("yan.appCertificate");
                          }
                        } catch {
                          // ignore storage errors
                        }
                      }}
                      placeholder={t.settings.appCertificatePlaceholder}
                    />
                  </div>
                  <p className="text-xs text-slate-500">{t.settings.credentialsHint}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {t.settings.language}
                  </p>
                  <LanguageSelector variant="full" align="start" />
                  <p className="text-xs text-slate-500">{t.settings.languageHint}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {t.settings.greeting}
                  </p>
                  <Textarea
                    value={greeting}
                    onChange={(event) => {
                      greetingTouchedRef.current = true;
                      const next = event.target.value;
                      setGreeting(next);
                      try {
                        window.localStorage.setItem("yan.greeting", next);
                      } catch {
                        // ignore storage errors
                      }
                    }}
                    placeholder={t.settings.greetingPlaceholder}
                    className="min-h-20"
                  />
                  <p className="text-xs text-slate-500">{t.settings.greetingHint}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {t.settings.voiceSpeed}
                    </p>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-200 tabular-nums">
                      {voiceSpeed.toFixed(2)}×
                    </span>
                  </div>
                  <Slider
                    min={MIN_VOICE_SPEED}
                    max={MAX_VOICE_SPEED}
                    step={0.05}
                    value={voiceSpeed}
                    onValueChange={(next) => {
                      const rounded = Math.round(next * 100) / 100;
                      setVoiceSpeed(rounded);
                      try {
                        window.localStorage.setItem("yan.voiceSpeed", String(rounded));
                      } catch {
                        // ignore storage errors
                      }
                    }}
                    aria-label={t.settings.voiceSpeed}
                  />
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>{t.settings.voiceSpeedSlower}</span>
                    <span>{t.settings.voiceSpeedFaster}</span>
                  </div>
                  <p className="text-xs text-slate-500">{t.settings.voiceSpeedHint}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {t.settings.mcp}
                    </p>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <span>{t.settings.mcpEnable}</span>
                      <Switch
                        checked={mcpEnabled}
                        onCheckedChange={(next) => {
                          setMcpEnabled(next);
                          try {
                            window.localStorage.setItem("yan.mcpEnabled", String(next));
                          } catch {
                            // ignore storage errors
                          }
                        }}
                        aria-label={t.settings.mcpEnable}
                      />
                    </label>
                  </div>
                  <Input
                    value={mcpServerUrl}
                    onChange={(event) => {
                      const next = event.target.value;
                      setMcpServerUrl(next);
                      try {
                        window.localStorage.setItem("yan.mcpServerUrl", next);
                      } catch {
                        // ignore storage errors
                      }
                    }}
                    placeholder={t.settings.mcpServerUrlPlaceholder}
                    disabled={!mcpEnabled}
                  />
                  <p className="text-xs text-slate-500">{t.settings.mcpHint}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                      <Video className="h-3.5 w-3.5" />
                      {t.settings.vision}
                    </p>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <span>{t.settings.visionEnable}</span>
                      <Switch
                        checked={visionEnabled}
                        onCheckedChange={(next) => {
                          setVisionEnabled(next);
                          try {
                            window.localStorage.setItem("yan.visionEnabled", String(next));
                          } catch {
                            // ignore storage errors
                          }
                        }}
                        aria-label={t.settings.visionEnable}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-slate-500">{t.settings.visionHint}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {t.settings.systemPrompt}
                  </p>
                  <Textarea
                    value={systemPrompt}
                    onChange={(event) => {
                      systemPromptTouchedRef.current = true;
                      const next = event.target.value;
                      setSystemPrompt(next);
                      try {
                        window.localStorage.setItem("yan.systemPrompt", next);
                      } catch {
                        // ignore storage errors
                      }
                    }}
                    placeholder={t.settings.systemPromptPlaceholder}
                    className="min-h-36"
                  />
                  <p className="text-xs text-slate-500">{t.settings.systemPromptHint}</p>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-4">
                  <p className="text-xs text-slate-500">{t.settings.restoreDefaultsHint}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={resetSettingsToDefaults}
                    className="shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t.settings.restoreDefaults}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      {/* Control dock */}
      <footer className="border-t border-white/5 bg-slate-950/60 px-4 py-3 backdrop-blur-sm md:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="icon-lg"
            onClick={() => void toggleMute()}
            disabled={!isConnected}
            aria-label={isMuted ? t.controls.unmute : t.controls.mute}
            className={isMuted ? "text-[color:var(--agora-accent-negative)]" : ""}
          >
            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Button>

          <Button
            variant="secondary"
            size="icon-lg"
            onClick={() => setShowCaptions((v) => !v)}
            aria-label={showCaptions ? t.controls.hideCaptions : t.controls.showCaptions}
            title={showCaptions ? t.controls.hideCaptions : t.controls.showCaptions}
            aria-pressed={showCaptions}
            className={showCaptions ? "text-[color:var(--agora-blue)]" : ""}
          >
            {showCaptions ? (
              <Captions className="h-5 w-5" />
            ) : (
              <CaptionsOff className="h-5 w-5" />
            )}
          </Button>

          <MicDeviceSelector
            devices={micDevices}
            selectedDeviceId={selectedMicDeviceId}
            onSelect={(id) => void handleMicDeviceChange(id)}
            defaultLabel={t.controls.microphoneDefault}
            ariaLabel={t.controls.microphone}
          />

          {isIdle || isConnecting ? (
            <Button
              size="lg"
              className="min-w-40"
              onClick={() => {
                if (!hasCredentials) {
                  setError(t.settings.credentialsRequired);
                  setShowSettings(true);
                  return;
                }
                if (quotaExhausted) {
                  setError(t.errors.quotaExhausted);
                  return;
                }
                void startCall();
              }}
              disabled={isConnecting || !canStart}
              title={
                !hasCredentials
                  ? t.settings.credentialsRequired
                  : quotaExhausted
                    ? t.errors.quotaExhausted
                    : undefined
              }
            >
              {isConnecting ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  {t.controls.connecting}
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4" />
                  {t.controls.start}
                </>
              )}
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="lg"
              className="min-w-40"
              onClick={() => void endCall()}
            >
              <PhoneOff className="h-4 w-4" />
              {t.controls.end}
            </Button>
          )}
        </div>
      </footer>
    </main>
  );
}
