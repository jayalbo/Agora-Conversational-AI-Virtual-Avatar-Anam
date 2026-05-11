import { Redis } from "@upstash/redis";
import { authMode } from "./auth";

/**
 * Per-user DAILY time-budget tracking for the public demo.
 *
 * Each visitor gets DEMO_QUOTA_SECONDS (default 600 = 10 min) of
 * ConvAI agent time per UTC calendar day. The Redis key includes the
 * day bucket, so a fresh quota appears automatically at 00:00 UTC
 * with no cron — yesterday's key just stops being touched and
 * evicts itself via TTL.
 *
 * The accounting is "reserve on start, commit on stop":
 *  - `reserve(user, seconds)` optimistically deducts a chunk of budget
 *    with an expiry. Returns a `Reservation` that locks in the day
 *    bucket at start time, so a call that crosses midnight still
 *    counts against the day it began.
 *  - `commit(user, reservation, actualSeconds)` replaces the
 *    reservation with the real elapsed time.
 *
 * Bypass paths (short-circuit to "unlimited" with no Redis writes):
 *  - AUTH_MODE=bypass (local dev)
 *  - User matches QUOTA_BYPASS_ACCOUNTS
 */

export const DEFAULT_QUOTA_SECONDS = 600;
const RESERVATION_TTL_SECONDS = 60 * 60 * 2; // 2h safety net for abandoned sessions.
// Each bucket only needs to live long enough to cover any in-flight
// call that started before midnight plus a wraparound buffer. 36h is
// plenty and keeps Redis tidy.
const HASH_TTL_SECONDS = 60 * 60 * 36;

export type Usage = {
  unlimited: boolean;
  quotaSeconds: number;
  usedSeconds: number;
  reservedSeconds: number;
  remainingSeconds: number;
};

export type Reservation = {
  id: string;
  seconds: number;
  startedAt: number;
  /**
   * UTC day bucket ("YYYY-MM-DD") captured at reserve() time. Carried
   * through heartbeat()/commit() so a call billed at 00:03 still
   * counts against the day it actually ran.
   */
  bucket: string;
};

/** UTC day key in "YYYY-MM-DD" form. */
function dayBucket(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** True if `bucket` looks like a valid "YYYY-MM-DD" string. */
export function isValidBucket(bucket: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(bucket);
}

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  // Works for any of the Redis providers Vercel links (Upstash, plain
  // Redis). Reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN or
  // the KV_REST_API_* fallbacks that older Vercel projects still carry.
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Upstash Redis is not configured. Link a Redis store on Vercel (Storage → Upstash for Redis) or set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN locally.",
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

export function quotaSecondsPerUser(): number {
  const raw = process.env.DEMO_QUOTA_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_QUOTA_SECONDS;
}

function normalizeForList(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * A user is on the allowlist if either their id OR their email appears
 * in QUOTA_BYPASS_ACCOUNTS (case-insensitive). That way the env var
 * can be configured without knowing which field Agora's /customer
 * returns as the stable id.
 */
export function isBypassed(user: {
  id: string;
  email?: string | null;
}): boolean {
  if (authMode() === "bypass") return true;
  const raw = process.env.QUOTA_BYPASS_ACCOUNTS;
  if (!raw) return false;
  const list = raw
    .split(",")
    .map((entry) => normalizeForList(entry))
    .filter(Boolean);
  if (list.length === 0) return false;
  const idKey = normalizeForList(user.id);
  const emailKey = user.email ? normalizeForList(user.email) : "";
  return list.includes(idKey) || (!!emailKey && list.includes(emailKey));
}

function usageKey(userId: string, bucket: string = dayBucket()): string {
  return `usage:${userId}:${bucket}`;
}

export async function getUsage(user: {
  id: string;
  email?: string | null;
}): Promise<Usage> {
  const quotaSeconds = quotaSecondsPerUser();

  if (isBypassed(user)) {
    return {
      unlimited: true,
      quotaSeconds,
      usedSeconds: 0,
      reservedSeconds: 0,
      remainingSeconds: Number.POSITIVE_INFINITY,
    };
  }

  const key = usageKey(user.id);
  const [usedRaw, reservedRaw, resExpRaw] = await Promise.all([
    redis().hget<number | string>(key, "used"),
    redis().hget<number | string>(key, "reserved"),
    redis().hget<number | string>(key, "resExp"),
  ]);

  const used = coerceInt(usedRaw);
  let reserved = coerceInt(reservedRaw);

  // An expired reservation is effectively zero — the visitor either
  // crashed out or never called commit. We report the effective value
  // here but don't mutate storage from a read path; the next reserve()
  // call clears it atomically.
  const nowMs = Date.now();
  const resExpMs = coerceInt(resExpRaw);
  if (resExpMs && resExpMs < nowMs) reserved = 0;

  const effectiveUsed = Math.max(0, used) + Math.max(0, reserved);
  const remainingSeconds = Math.max(0, quotaSeconds - effectiveUsed);
  return {
    unlimited: false,
    quotaSeconds,
    usedSeconds: used,
    reservedSeconds: reserved,
    remainingSeconds,
  };
}

/**
 * Optimistically carve out a chunk of budget before starting a call.
 * Returns `null` when the user is out of budget (caller should refuse
 * to start). Returns the reservation record on success.
 */
export async function reserve(
  user: { id: string; email?: string | null },
  seconds: number,
): Promise<Reservation | null> {
  const bucket = dayBucket();
  if (isBypassed(user)) {
    return {
      id: "bypass",
      seconds: 0,
      startedAt: Date.now(),
      bucket,
    };
  }
  const usage = await getUsage(user);
  if (usage.remainingSeconds <= 0) return null;

  const reservedSeconds = Math.min(seconds, usage.remainingSeconds);
  const id = crypto.randomUUID();
  const key = usageKey(user.id, bucket);

  // Clear any stale reservation (its expiry has already excluded it
  // from `remainingSeconds`, so we're safe to overwrite), then set the
  // new one.
  const expMs = Date.now() + RESERVATION_TTL_SECONDS * 1000;
  await redis().hset(key, {
    reserved: reservedSeconds,
    resId: id,
    resExp: expMs,
  });
  await redis().expire(key, HASH_TTL_SECONDS);

  return { id, seconds: reservedSeconds, startedAt: Date.now(), bucket };
}

/**
 * Finalize a session: add the actual elapsed seconds to `used` and
 * clear the reservation. Idempotent on reservationId mismatch (we
 * don't double-count if /stop fires twice).
 *
 * The bucket is read off the reservation, not from "today" — so a
 * call that began before midnight UTC and ended after still counts
 * against the day it started, not the new day.
 */
export async function commit(
  user: { id: string; email?: string | null },
  reservationId: string,
  reservationBucket: string,
  actualElapsedSeconds: number,
): Promise<void> {
  if (isBypassed(user)) return;
  if (!isValidBucket(reservationBucket)) return;

  const key = usageKey(user.id, reservationBucket);
  const currentResId = await redis().hget<string>(key, "resId");
  if (currentResId !== reservationId) {
    // Already committed (or replaced by a newer reservation). No-op.
    return;
  }

  const clamped = Math.max(0, Math.floor(actualElapsedSeconds));
  await redis().hincrby(key, "used", clamped);
  await redis().hdel(key, "reserved", "resId", "resExp");
  await redis().expire(key, HASH_TTL_SECONDS);
}

/**
 * Extend the reservation TTL so an actively-used call isn't garbage
 * collected while it's still going. No-op in bypass mode.
 */
export async function heartbeat(
  user: { id: string; email?: string | null },
  reservationId: string,
  reservationBucket: string,
): Promise<void> {
  if (isBypassed(user)) return;
  if (!isValidBucket(reservationBucket)) return;
  const key = usageKey(user.id, reservationBucket);
  const currentResId = await redis().hget<string>(key, "resId");
  if (currentResId !== reservationId) return;
  const expMs = Date.now() + RESERVATION_TTL_SECONDS * 1000;
  await redis().hset(key, { resExp: expMs });
}

/** Admin helper: wipe a user's current-day usage. */
export async function resetUsage(userId: string): Promise<void> {
  await redis().del(usageKey(userId));
}

function coerceInt(value: number | string | null): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
