/**
 * Shareable demo presets — Yan's pitch tool.
 *
 * Admins (@agora.io) save a bundle of (systemPrompt, greeting,
 * language, voiceSpeed) and get a short URL like `?p=x7k2qa` to share
 * with prospects. Anyone with the URL who's signed into SSO loads the
 * preset before their call starts. Customer-facing UI shows nothing
 * about the preset existing — the call feels like a normal demo.
 *
 * Presets are IMMUTABLE: once created they can be deleted but not
 * edited. This guarantees a URL shared with a customer always plays
 * the same demo until explicitly killed.
 *
 * Storage (Upstash):
 *   preset:<id>           hash of the preset fields (no TTL)
 *   preset:by:<email>     sorted set, score=createdAt, member=id
 *                         used for "list my presets" without a SCAN
 */

import { redis } from "./redis";

/** Locale tags the rest of the app understands. */
export type PresetLanguage = "en" | "pt-BR" | "es-MX";

export type PresetInput = {
  systemPrompt: string;
  greeting: string;
  language: PresetLanguage;
  voiceSpeed: number;
};

export type Preset = PresetInput & {
  id: string;
  createdBy: string;
  createdAt: number;
};

const PRESET_ID_LENGTH = 6;
// Crockford-style base32 minus the ambiguous glyphs (0/O/I/L/1).
// 32 chars × 6 = ~1B combinations; collisions are astronomically
// unlikely at the scale we care about.
const PRESET_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const MAX_PRESETS_PER_USER = 50;

function presetKey(id: string): string {
  return `preset:${id}`;
}

function presetIndexKey(email: string): string {
  return `preset:by:${email.toLowerCase()}`;
}

function generateId(): string {
  // Reasonably uniform pick — Math.floor(Math.random() * 32) per char.
  // We're not using this for security, just URL identifiers.
  let out = "";
  for (let i = 0; i < PRESET_ID_LENGTH; i += 1) {
    out += PRESET_ID_ALPHABET.charAt(
      Math.floor(Math.random() * PRESET_ID_ALPHABET.length),
    );
  }
  return out;
}

/**
 * `^[a-z2-9]{4,12}$` — permissive enough to accept the format above
 * but strict enough that we never query Redis with arbitrary input.
 */
export function isValidPresetId(id: string): boolean {
  return /^[a-z2-9]{4,12}$/.test(id);
}

/** Quick sanity-check + clamp on incoming preset payloads. */
export function normalizePresetInput(raw: unknown): PresetInput | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const systemPrompt =
    typeof obj.systemPrompt === "string" ? obj.systemPrompt.trim() : "";
  const greeting =
    typeof obj.greeting === "string" ? obj.greeting.trim() : "";
  const language =
    obj.language === "en" || obj.language === "pt-BR" || obj.language === "es-MX"
      ? (obj.language as PresetLanguage)
      : null;
  const voiceSpeedRaw =
    typeof obj.voiceSpeed === "number" ? obj.voiceSpeed : NaN;
  // Mirror the client's clamp range so we never accept something the
  // /start route would refuse anyway.
  const voiceSpeed = Number.isFinite(voiceSpeedRaw)
    ? Math.min(1.2, Math.max(0.7, voiceSpeedRaw))
    : 1.0;

  if (!systemPrompt || systemPrompt.length > 4000) return null;
  if (!greeting || greeting.length > 1000) return null;
  if (!language) return null;
  return { systemPrompt, greeting, language, voiceSpeed };
}

export async function createPreset(
  user: { email: string },
  input: PresetInput,
): Promise<Preset> {
  // Cap how many presets a single admin can keep around. Stops a
  // runaway script from filling Redis and gives Yan a nudge to clean
  // up when he hits the wall.
  const existingCount = await redis().zcard(presetIndexKey(user.email));
  if (existingCount >= MAX_PRESETS_PER_USER) {
    throw new Error("preset_limit_reached");
  }

  // Generate a unique id. Collisions at 6 chars over 32 symbols are
  // ~1 in 10^9, but retry just in case (very cheap).
  let id = generateId();
  for (let i = 0; i < 5; i += 1) {
    const exists = await redis().exists(presetKey(id));
    if (!exists) break;
    id = generateId();
  }

  const now = Date.now();
  const record: Preset = {
    id,
    ...input,
    createdBy: user.email,
    createdAt: now,
  };

  await redis().hset(presetKey(id), {
    systemPrompt: record.systemPrompt,
    greeting: record.greeting,
    language: record.language,
    voiceSpeed: record.voiceSpeed,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
  });
  await redis().zadd(presetIndexKey(user.email), {
    score: now,
    member: id,
  });

  return record;
}

export async function getPreset(id: string): Promise<Preset | null> {
  if (!isValidPresetId(id)) return null;
  const raw = await redis().hgetall<Record<string, string | number>>(
    presetKey(id),
  );
  if (!raw || Object.keys(raw).length === 0) return null;
  const language =
    raw.language === "en" || raw.language === "pt-BR" || raw.language === "es-MX"
      ? (raw.language as PresetLanguage)
      : "en";
  const voiceSpeed =
    typeof raw.voiceSpeed === "number"
      ? raw.voiceSpeed
      : Number.parseFloat(String(raw.voiceSpeed));
  return {
    id,
    systemPrompt: String(raw.systemPrompt ?? ""),
    greeting: String(raw.greeting ?? ""),
    language,
    voiceSpeed: Number.isFinite(voiceSpeed) ? voiceSpeed : 1.0,
    createdBy: String(raw.createdBy ?? ""),
    createdAt:
      typeof raw.createdAt === "number"
        ? raw.createdAt
        : Number.parseInt(String(raw.createdAt), 10) || 0,
  };
}

/**
 * Newest-first list of presets owned by `email`. Capped at
 * MAX_PRESETS_PER_USER so a runaway dataset can't blow up the admin
 * UI either.
 */
export async function listPresetsByOwner(email: string): Promise<Preset[]> {
  const ids = await redis().zrange<string[]>(
    presetIndexKey(email),
    0,
    MAX_PRESETS_PER_USER - 1,
    { rev: true },
  );
  if (!ids || ids.length === 0) return [];
  const presets = await Promise.all(ids.map((id) => getPreset(id)));
  // Drop any holes from indices that point at deleted preset hashes
  // (shouldn't happen, but if it does we self-heal silently).
  const cleaned: Preset[] = [];
  for (let i = 0; i < presets.length; i += 1) {
    const preset = presets[i];
    if (preset) {
      cleaned.push(preset);
    } else {
      await redis().zrem(presetIndexKey(email), ids[i]);
    }
  }
  return cleaned;
}

/**
 * Delete a preset. The caller is responsible for confirming ownership
 * — we expose `ownerEmail` here as a safety check so a misrouted
 * call can't nuke someone else's preset.
 */
export async function deletePreset(
  id: string,
  ownerEmail: string,
): Promise<boolean> {
  if (!isValidPresetId(id)) return false;
  const preset = await getPreset(id);
  if (!preset) return false;
  if (preset.createdBy.toLowerCase() !== ownerEmail.toLowerCase()) {
    return false;
  }
  await redis().del(presetKey(id));
  await redis().zrem(presetIndexKey(ownerEmail), id);
  return true;
}
