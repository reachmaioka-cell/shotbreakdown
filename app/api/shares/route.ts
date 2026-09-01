import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { getAppUrl } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createShare, revokeShare, shareUrl } from "@/lib/shares";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  resourceType: z.enum(["shot", "collection", "video"]),
  resourceId: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to share", 401);

  const limited = await enforceRateLimit("share", request, user.id);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const share = await createShare(parsed.data.resourceType, parsed.data.resourceId, user.id);
  if (!share) return jsonError("Not found", 404);

  trackAsync("share_created", {
    userId: user.id,
    properties: { resourceType: parsed.data.resourceType },
  });

  return NextResponse.json({ token: share.token, url: shareUrl(getAppUrl(), share.token) });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const ok = await revokeShare(parsed.data.resourceType, parsed.data.resourceId, user.id);
  if (!ok) return jsonError("Not found", 404);
  return NextResponse.json({ ok: true });
}
