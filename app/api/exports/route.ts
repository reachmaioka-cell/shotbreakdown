import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { getAppUrl } from "@/lib/env";
import { buildExportPayload, toCsv, toJson, toPdf } from "@/lib/export";
import { jsonError } from "@/lib/http";
import { planLimits } from "@/lib/plans";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const Query = z.object({
  resourceType: z.enum(["collection", "video", "shot"]),
  resourceId: z.string().uuid(),
  format: z.enum(["pdf", "csv", "json"]),
});

function filename(title: string, format: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "shotbreakdown";
  return `${base}.${format}`;
}

/**
 * Exports run through the same authorization as the pages themselves, so an
 * export can never reveal a shot the caller could not already open.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to export", 401);

  const limited = await enforceRateLimit("export", request, user.id);
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = Query.safeParse({
    resourceType: url.searchParams.get("resourceType"),
    resourceId: url.searchParams.get("resourceId"),
    format: url.searchParams.get("format"),
  });
  if (!parsed.success) return jsonError("Invalid export request", 400);

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();
  const limits = planLimits(profile?.plan as string | null);
  if (!limits.exports) {
    return NextResponse.json(
      { error: "plan_limit_reached", message: "Exports are a Pro feature." },
      { status: 402 }
    );
  }

  trackAsync("export_started", {
    userId: user.id,
    properties: { format: parsed.data.format, resourceType: parsed.data.resourceType },
  });

  const payload = await buildExportPayload(
    parsed.data.resourceType,
    parsed.data.resourceId,
    user.id,
    getAppUrl()
  );
  if (!payload) return jsonError("Not found", 404);
  if (payload.rows.length === 0) return jsonError("There is nothing to export yet", 400);

  try {
    if (parsed.data.format === "csv") {
      trackAsync("export_completed", { userId: user.id, properties: { format: "csv", shots: payload.rows.length } });
      return new NextResponse(toCsv(payload), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename(payload.title, "csv")}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (parsed.data.format === "json") {
      trackAsync("export_completed", { userId: user.id, properties: { format: "json", shots: payload.rows.length } });
      return new NextResponse(toJson(payload), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename(payload.title, "json")}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const pdf = await toPdf(payload);
    trackAsync("export_completed", { userId: user.id, properties: { format: "pdf", shots: payload.rows.length } });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename(payload.title, "pdf")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("export failed", e instanceof Error ? e.message : e);
    return jsonError("Could not build the export", 500);
  }
}
