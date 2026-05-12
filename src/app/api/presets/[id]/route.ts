import { NextResponse } from "next/server";

import { getSessionUser, isAdmin } from "@/lib/auth";
import { deletePreset, getPreset, isValidPresetId } from "@/lib/presets";

/**
 * GET /api/presets/:id
 * Public to any signed-in user (admins to load their own UI, customers
 * to consume a shared URL). We strip `createdBy` from the response so
 * sharing a URL doesn't leak the admin's email.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isValidPresetId(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const preset = await getPreset(id);
    if (!preset) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      id: preset.id,
      label: preset.label,
      systemPrompt: preset.systemPrompt,
      greeting: preset.greeting,
      language: preset.language,
      voiceSpeed: preset.voiceSpeed,
      createdAt: preset.createdAt,
    });
  } catch (err) {
    console.error("[presets] get failed:", err);
    return NextResponse.json(
      { error: "quota_store_unavailable" },
      { status: 503 },
    );
  }
}

/**
 * DELETE /api/presets/:id
 * Admin-only. Must own the preset (enforced inside deletePreset()).
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isValidPresetId(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const ok = await deletePreset(id, user.email);
    if (!ok) {
      // Either doesn't exist or owned by someone else. We return 404
      // in both cases to avoid leaking that a preset id is taken.
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[presets] delete failed:", err);
    return NextResponse.json(
      { error: "quota_store_unavailable" },
      { status: 503 },
    );
  }
}
