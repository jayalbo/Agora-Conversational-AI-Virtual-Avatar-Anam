import { NextResponse } from "next/server";

import { getSessionUser, isAdmin } from "@/lib/auth";
import {
  createPreset,
  listPresetsByOwner,
  normalizePresetInput,
} from "@/lib/presets";

/**
 * GET /api/presets
 * List the calling admin's own presets, newest first. 403 for
 * non-admins (no point in exposing the list to customers).
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const presets = await listPresetsByOwner(user.email);
    return NextResponse.json({ presets });
  } catch (err) {
    console.error("[presets] list failed:", err);
    return NextResponse.json(
      { error: "quota_store_unavailable" },
      { status: 503 },
    );
  }
}

/**
 * POST /api/presets
 * Create a new immutable preset. Body: { systemPrompt, greeting,
 * language, voiceSpeed }. Returns { id }.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = normalizePresetInput(body);
  if (!result.ok) {
    console.warn(`[presets] reject create: ${result.reason}`);
    return NextResponse.json(
      { error: "invalid_preset_payload", reason: result.reason },
      { status: 400 },
    );
  }

  try {
    const preset = await createPreset(user, result.input);
    return NextResponse.json({
      id: preset.id,
      createdAt: preset.createdAt,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "preset_limit_reached") {
      return NextResponse.json(
        { error: "preset_limit_reached" },
        { status: 409 },
      );
    }
    console.error("[presets] create failed:", err);
    return NextResponse.json(
      { error: "quota_store_unavailable" },
      { status: 503 },
    );
  }
}
