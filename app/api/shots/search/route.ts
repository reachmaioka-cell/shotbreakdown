import { NextResponse } from "next/server";
import { z } from "zod";
import { trackAsync } from "@/lib/analytics";
import { reportError } from "@/lib/errors";
import { jsonError } from "@/lib/http";
import { FEATURES } from "@/lib/features";
import { enforceRateLimit } from "@/lib/rate-limit";
import { searchShots, type ShotScope, type ShotSearchFilters } from "@/lib/shots";
import { savedShotIds } from "@/lib/collections";
import { createClient } from "@/lib/supabase/server";
import { FILTER_KEYS } from "@/lib/filters";

const Query = z.object({
  q: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(96).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
  scope: z.enum(["public", "mine", "saved"]).optional(),
});

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const limited = await enforceRateLimit(user ? "search" : "search_anon", request, user?.id ?? null);
  if (limited) return limited;

  // Every searchable shot belongs to somebody while the public library is off,
  // so an anonymous caller has nothing to search. Still rate limited above, so
  // this cannot be used to probe for free.
  if (!FEATURES.publicLibrary && !user) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const parsed = Query.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
  });
  if (!parsed.success) return jsonError("Invalid query", 400);

  const requested = parsed.data.scope ?? "public";
  if (requested !== "public" && !user) return jsonError("Unauthorized", 401);

  // Off the public library the only shots a caller may search are their own, so
  // "public" means their own too rather than an empty result.
  const scope: ShotScope = FEATURES.publicLibrary
    ? requested
    : requested === "saved"
      ? "saved"
      : "mine";

  const filters: ShotSearchFilters = {};
  for (const key of FILTER_KEYS) {
    const values = url.searchParams.getAll(key).flatMap((v) => v.split(",")).filter(Boolean);
    if (values.length > 0) {
      (filters as Record<string, unknown>)[key] = values.slice(0, 20);
    }
  }
  const videoId = url.searchParams.get("video_id");
  if (videoId) filters.video_id = videoId;
  const minDuration = url.searchParams.get("min_duration");
  if (minDuration) filters.min_duration = Number(minDuration);
  const maxDuration = url.searchParams.get("max_duration");
  if (maxDuration) filters.max_duration = Number(maxDuration);

  try {
    const result = await searchShots({
      query: parsed.data.q,
      filters,
      limit: parsed.data.limit ?? 48,
      offset: parsed.data.offset ?? 0,
      viewerId: user?.id ?? null,
      scope,
    });

    if (parsed.data.q) {
      trackAsync("search_performed", {
        userId: user?.id ?? null,
        properties: {
          query: parsed.data.q,
          scope,
          results: result.total,
          semantic: result.usedSemantic,
          filters: Object.keys(filters),
        },
      });
    } else if (Object.keys(filters).length > 0) {
      trackAsync("filter_used", {
        userId: user?.id ?? null,
        properties: { filters: Object.keys(filters), scope, results: result.total },
      });
    }

    /*
     * Saved state travels with the results. The library page can only compute
     * it for the first page it renders; without this, every shot pulled in by
     * infinite scroll would draw as unsaved.
     */
    const saved = user ? await savedShotIds(user.id, result.shots.map((s) => s.id)) : new Set<string>();

    return NextResponse.json({ ...result, savedIds: [...saved] });
  } catch (e) {
    reportError(e, { source: "shot_search" });
    return jsonError("Search failed", 500);
  }
}
