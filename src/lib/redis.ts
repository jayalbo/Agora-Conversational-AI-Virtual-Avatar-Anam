import { Redis } from "@upstash/redis";

/**
 * Shared Upstash Redis client. Used by quota tracking AND preset
 * storage. We memoize the instance so each route handler doesn't open
 * a fresh connection.
 *
 * Accepts either the bare Upstash names or Vercel's KV-flavored
 * aliases — Vercel's Marketplace Upstash integration injects the
 * latter automatically.
 */
let _redis: Redis | null = null;

export function redis(): Redis {
  if (_redis) return _redis;
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
