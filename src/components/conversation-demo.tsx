"use client";

import {
  Captions,
  CaptionsOff,
  ChevronRight,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RotateCcw,
  SendHorizontal,
  Settings2,
  User,
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
  const agoraRtcRef = useRef<any>(null);
  const agoraRtmRef = useRef<any>(null);
  const rtmChannelRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const avatarVideoRef = useRef<HTMLDivElement | null>(null);
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

  const cleanupSession = useCallback(async () => {
    stopSpeechRecognition();

    // Tear down the ConvAI agent server-side so it stops running (and
    // billing) instead of waiting for its session timeout. Fire-and-forget
    // with a short timeout so a slow leave call doesn't block UI teardown.
    const agentSession = agentSessionRef.current;
    if (agentSession) {
      agentSessionRef.current = null;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        await fetch("/api/session/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(agentSession),
          signal: controller.signal,
          keepalive: true
        }).catch((err) => {
          console.warn("[convai] stop request failed", err);
        });
        clearTimeout(timeout);
      } catch (err) {
        console.warn("[convai] stop request threw", err);
      }
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
    if (client) {
      await client.leave();
      clientRef.current = null;
    }
    setStatus("idle");
    setIsMuted(false);
    if (avatarVideoRef.current) {
      avatarVideoRef.current.innerHTML = "";
    }
  }, [stopSpeechRecognition]);

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
            : { enabled: false }
        })
      });

      if (!startRes.ok) {
        const payload = (await startRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? t.errors.startFailed);
      }

      const session = (await startRes.json()) as SessionResponse;

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
    selectedMicDeviceId,
    setupSpeechRecognition,
    systemPrompt,
    t.errors.startFailed,
    t.fillerPhrases,
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
    systemPromptTouchedRef.current = false;
    greetingTouchedRef.current = false;

    try {
      window.localStorage.removeItem("yan.systemPrompt");
      window.localStorage.removeItem("yan.greeting");
      window.localStorage.removeItem("yan.voiceSpeed");
      window.localStorage.removeItem("yan.mcpEnabled");
      window.localStorage.removeItem("yan.mcpServerUrl");
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
      if (!session) return;
      try {
        const blob = new Blob([JSON.stringify(session)], {
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

  const isIdle = status === "idle";
  const isConnecting = status === "connecting";
  const isConnected = status === "connected";

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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-slate-900/40 via-slate-950/60 to-black/80">
                <AgoraLogo className="h-14 w-auto drop-shadow-[0_0_24px_rgba(0,194,255,0.25)]" />
                <p className="text-sm text-slate-300">
                  {isConnecting ? t.stage.connecting : t.stage.pressStart}
                </p>
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
                void startCall();
              }}
              disabled={isConnecting}
              title={!hasCredentials ? t.settings.credentialsRequired : undefined}
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
