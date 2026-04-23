# Agora Conversational AI — Live Demo

A public-facing demo of [Agora's Conversational AI Agent](https://www.agora.io/en/products/conversational-ai-agent/)
running with real-time voice, live transcriptions, and a lifelike avatar. Visitors
bring their own Agora account (App ID + Certificate) and talk to a digital twin
of Yan, Agora's developer relations rep in Brazil.

![Tech stack: Next.js · TypeScript · Tailwind · Agora Conversational AI · ElevenLabs · OpenAI · Anam avatar](https://img.shields.io/badge/stack-Next.js%20·%20Agora%20ConvAI%20·%20ElevenLabs%20·%20OpenAI%20·%20Anam-00C2FF)

## Features

- **Agora Conversational AI** agent orchestrated from the backend (`/join` + `/leave`)
- **Real-time voice** via Agora RTC with ElevenLabs TTS
- **Live avatar** video from Anam
- **Live transcriptions** streamed over Agora RTM (no polling)
- **Word-accurate captions** overlay (toggle with the CC button)
- **MCP tools** — connect the agent to any MCP server (defaults to the
  Agora docs MCP for live doc lookups)
- **Natural-sounding filler words** while the LLM/MCP takes a moment
- **Microphone device picker** with hot-swap during a call
- **Internationalization** — English, Português (Brasil), and Español (México),
  user-switchable
- **Bring-your-own Agora account** — App ID + Certificate stored locally in
  the browser, never persisted on the server
- **Agora SSO** — visitors sign in with their Agora account; no account, no demo
- **Per-user time budget** — 10 minutes per Agora account, tracked in Upstash
  Redis (configurable; allowlist supported for live demos)
- **Agora-branded UI** — dark palette, glass surfaces, cyan accents

## Quick start

### 1. Install

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Required for any call:

| Variable | What it is |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI key used for the LLM |
| `ELEVENLABS_API_KEY` | ElevenLabs key used for TTS |
| `ELEVENLABS_VOICE_ID` | ElevenLabs voice ID |
| `ANAM_API_KEY` | Anam key for the avatar |
| `ANAM_AVATAR_ID` | Anam avatar to render |

Optional (defaults shown):

| Variable | Default |
| --- | --- |
| `OPENAI_MODEL` | `gpt-4o-mini` |
| `ELEVENLABS_MODEL_ID` | `eleven_flash_v2_5` |

#### Agora credentials (App ID + Certificate)

Two modes are supported:

1. **BYO (public demo)** — leave `NEXT_PUBLIC_AGORA_APP_ID` and
   `AGORA_APP_CERTIFICATE` empty in the server env. Users are required to
   enter their own credentials in the Settings panel. This is the recommended
   mode for anything public.
2. **Local dev** — set them in `.env.local` to skip the settings prompt on
   your own machine.

Get them at [console.agora.io](https://console.agora.io) → Project Management.

#### Agora SSO (required for production)

For the public deployment we restrict usage to people with an Agora account.
Request these credentials from the Agora SSO admin (`sunmingda`) and share
your callback URL `https://<your-domain>/api/auth/agora/callback`:

- `AGORA_SSO_CLIENT_ID`
- `AGORA_SSO_CLIENT_SECRET`
- `AGORA_SSO_REDIRECT_URI` — must match the callback URL you shared

Also required:

- `SESSION_JWT_SECRET` — 32+ random chars. Generate with `openssl rand -hex 48`.

#### Upstash Redis (quota storage)

The per-user minute budget is tracked in Upstash Redis. On Vercel, open
the project → **Storage** → **Marketplace** → **Upstash for Redis** →
**Link**. The `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
env vars are injected automatically.

For local dev, either:

- Create a free database at [upstash.com](https://upstash.com/) and paste
  the REST URL + token into `.env.local`, **or**
- Set `AUTH_MODE=bypass` in `.env.local` to skip SSO + quota entirely
  (treated as a synthetic dev user; ignored in production).

#### Quota settings

- `DEMO_QUOTA_SECONDS` — per-account budget in seconds (default `600` = 10 min).
- `QUOTA_BYPASS_ACCOUNTS` — comma-separated list of Agora user ids or emails
  that get an "Unlimited" badge. Useful for the people running the demo live.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:4000](http://localhost:4000).

## How it works

```
┌────────────┐       /api/session/start        ┌──────────────────────┐
│  Browser   │ ──────────────────────────────▶ │ Next.js API route    │
│ (React UI) │                                 │                      │
│            │       RTC tokens + agentId      │  builds tokens,      │
│            │ ◀────────────────────────────── │  calls Agora /join   │
│            │                                 └──────────┬───────────┘
│            │                                            │
│            │        RTC (voice + avatar video)          ▼
│            │ ◀──────────────────────────────── Agora ConvAI Agent
│            │              RTM (transcripts)           │
│            │ ◀────────────────────────────────────────┘
│            │       /api/session/stop         ┌──────────────────────┐
│            │ ──────────────────────────────▶ │ Next.js API route    │
│            │                                 │  calls Agora /leave  │
└────────────┘                                 └──────────────────────┘
```

- `src/app/api/session/start/route.ts` — builds the RTC/RTM tokens and calls
  `POST https://api.agora.io/api/conversational-ai-agent/v2/projects/{appId}/join`
  with the full agent config (LLM, TTS, avatar, MCP servers, ASR language,
  filler words, etc.).
- `src/app/api/session/stop/route.ts` — tears down the agent via
  `POST /api/conversational-ai-agent/v2/projects/{appId}/agents/{agentId}/leave`
  and commits the elapsed time against the user's quota. Called on end-call,
  page unload (via `navigator.sendBeacon`), and component unmount. Without
  this, the agent would keep running until it times out.
- `src/app/api/session/me/route.ts` — returns the current user + remaining
  quota so the UI can render the countdown chip.
- `src/app/api/session/heartbeat/route.ts` — keepalive hit by the client
  every 30s while a call is live, so abandoned sessions can be GC'd.
- `src/app/api/auth/agora/*` — SSO start / callback / logout routes.
- `src/app/api/assistant/respond/route.ts` — fallback path for typed messages.
- `src/components/conversation-demo.tsx` — the React client: RTC join, RTM
  subscribe, transcript state, settings drawer, captions, mic picker,
  sign-in gate, quota chip, heartbeat loop.
- `src/lib/auth.ts` / `src/lib/agora-sso.ts` — session JWTs + Agora OAuth.
- `src/lib/quota.ts` — reserve-then-commit time budgeting against Upstash Redis.
- `src/lib/i18n.tsx` — tiny dictionary-based i18n with `localStorage`
  persistence. System prompt and greeting are per-locale so the agent speaks
  the user's language.

## Settings panel

All tunables live in the Settings drawer (gear icon top-right) and persist in
`localStorage`:

- **Agora credentials** — App ID + Certificate (required for public demos)
- **Language** — English / Português (Brasil), drives UI + ASR + prompt
- **Greeting** — the agent's opening line
- **Voice speed** — ElevenLabs TTS speed, clamped to `[0.7, 1.2]`
- **MCP tools** — enable/disable and set a server URL (SSE)
- **System prompt** — full override of the agent persona

A **Restore defaults** button resets everything except the Agora credentials.

## Deployment

The demo runs on any Node host that supports Next.js 15 (Vercel, Fly, Railway,
a plain VM, etc.).

For a public deployment:

- Leave `NEXT_PUBLIC_AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` unset so visitors
  are forced to bring their own Agora account.
- Keep the other keys (`OPENAI_API_KEY`, `ELEVENLABS_*`, `ANAM_*`) server-side
  so they are not exposed.
- The server never logs Agora credentials or API keys.

## Stack

- [Next.js 15](https://nextjs.org/) (App Router) + React 19
- TypeScript
- Tailwind CSS v4 + shadcn-style primitives
- [`agora-rtc-sdk-ng`](https://www.npmjs.com/package/agora-rtc-sdk-ng) — RTC
- [`agora-rtm`](https://www.npmjs.com/package/agora-rtm) — signaling / transcripts
- [`agora-agent-client-toolkit`](https://www.npmjs.com/package/agora-agent-client-toolkit) — transcript helpers
- [`agora-token`](https://www.npmjs.com/package/agora-token) — server-side token builder
- [`@upstash/redis`](https://www.npmjs.com/package/@upstash/redis) — serverless Redis client for quota storage
- [`jose`](https://www.npmjs.com/package/jose) — JWT sign/verify for session cookies

## License

MIT
