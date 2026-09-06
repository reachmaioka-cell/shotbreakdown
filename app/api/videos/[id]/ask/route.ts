import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/constants";
import { jsonError } from "@/lib/http";
import { formatKnowledgeBlock, retrieveKnowledge } from "@/lib/knowledge";
import { inferTagsFromText } from "@/lib/knowledge-query";
import { formatAboutFilmmaker, type UserPreferences } from "@/lib/preferences";
import { segmentAskSystemPrompt } from "@/lib/prompts/ask";
import { enforceRateLimit } from "@/lib/rate-limit";
import { formatTimecode } from "@/lib/shot-format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  AskSchema,
  ShotMetadataSchema,
  readSegmentBreakdown,
  type ShotMetadata,
} from "@/lib/validation";

export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

type ShotRow = {
  shot_index: number;
  start_seconds: number | string;
  end_seconds: number | string;
  metadata: unknown;
};

/**
 * One line per shot, terse enough that thirty of them still leave room for the
 * breakdown and the conversation.
 *
 * lib/segment-breakdown.ts builds a richer record for the breakdown pass, but
 * that helper is private to it and carries fields (framing prose, depth,
 * colour notes) this surface does not need: the breakdown itself is already in
 * the prompt, and these lines only have to let an answer name a shot.
 */
function shotLine(row: ShotRow): string {
  const parsed = ShotMetadataSchema.safeParse(row.metadata ?? {});
  const m: ShotMetadata | null = parsed.success ? parsed.data : null;
  const start = Number(row.start_seconds);
  const end = Number(row.end_seconds);

  const parts: string[] = [
    `${row.shot_index}`,
    `${formatTimecode(start)}-${formatTimecode(end)}`,
  ];
  if (m?.one_line_summary) parts.push(m.one_line_summary);
  if (m?.composition) {
    parts.push([m.composition.shot_size, m.composition.camera_angle].filter(Boolean).join(" / "));
  }
  if (m?.movement_facets?.type) parts.push(m.movement_facets.type);
  if (m?.optics) {
    parts.push([m.optics.lens_type, m.optics.focal_length_range].filter(Boolean).join(" "));
  }
  if (m?.lighting_facets) {
    const l = m.lighting_facets;
    parts.push(
      [l.quality, l.key_level, l.key_direction ? `key from ${l.key_direction}` : null]
        .filter(Boolean)
        .join(" ")
    );
  }
  if (m?.color_facets?.palette) parts.push(m.color_facets.palette);
  if (m?.environment) {
    parts.push(
      [
        m.environment.interior_exterior,
        m.environment.location_type,
        m.environment.time_of_day,
        m.environment.weather && m.environment.weather !== "none" ? m.environment.weather : null,
      ]
        .filter(Boolean)
        .join(", ")
    );
  }
  if (m?.subject?.description) parts.push(m.subject.description);

  return parts.filter(Boolean).join(" · ");
}

/**
 * Follow-up questions about a whole segment, grounded in its breakdown and the
 * per-shot records. Shares the "ask" budget with the per-shot Ask on purpose:
 * it is one user's spend either way, and splitting it would double what a user
 * can spend by moving between two surfaces.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to ask about a segment", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();
  const isPro = profile?.plan === "pro";

  const limited = await enforceRateLimit("ask", request, user.id, isPro ? { limit: 200 } : undefined);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = AskSchema.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid input", 400);

  // A public segment is readable by anyone, so ownership is checked here rather
  // than inferred from the read succeeding. The conversation is the owner's.
  const { data: video } = await supabase
    .from("videos")
    .select("id, user_id, title, focus, breakdown")
    .eq("id", id)
    .maybeSingle();
  if (!video || video.user_id !== user.id) return jsonError("Not found", 404);

  const { data: shotRows } = await supabase
    .from("shots")
    .select("shot_index, start_seconds, end_seconds, metadata")
    .eq("video_id", id)
    .eq("status", "complete")
    .order("shot_index");

  const shots = (shotRows ?? []) as ShotRow[];
  if (shots.length === 0) return jsonError("Not found", 404);

  const admin = createAdminClient();
  const [{ data: existing }, { data: prefs }, { data: insight }] = await Promise.all([
    admin.from("conversations").select("id, messages").eq("video_id", id).eq("user_id", user.id).maybeSingle(),
    supabase.from("user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    admin
      .from("prompt_insights")
      .select("summary")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const prior = (existing?.messages as ChatMessage[] | null) ?? [];
  const breakdown = readSegmentBreakdown(video.breakdown);
  const focus = ((video.focus as string | null) ?? "").trim() || null;
  const shotLines = shots.map(shotLine).join("\n");

  const knowledge = await retrieveKnowledge(
    [parsed.data.question, focus, video.title as string | null].filter(Boolean).join(" "),
    6,
    { tags: inferTagsFromText([parsed.data.question, shotLines].join(" ")) }
  ).catch(() => []);

  const system = segmentAskSystemPrompt({
    aboutFilmmaker: formatAboutFilmmaker((prefs as UserPreferences | null) ?? null) ?? undefined,
    failureModes: (insight?.summary as string | null) ?? undefined,
    knowledgeBlock: formatKnowledgeBlock(knowledge) ?? undefined,
    breakdownJson: breakdown ? JSON.stringify(breakdown) : null,
    shotLines,
    focus,
    title: breakdown?.title ?? (video.title as string | null),
  });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [
      ...prior.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
      { role: "user", content: parsed.data.question },
    ],
  });

  const encoder = new TextEncoder();
  let full = "";

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            full += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const next: ChatMessage[] = [
          ...prior,
          { role: "user" as const, content: parsed.data.question },
          { role: "assistant" as const, content: full },
        ].slice(-20);

        if (existing) {
          await admin.from("conversations").update({ messages: next }).eq("id", existing.id);
        } else {
          await admin.from("conversations").insert({ video_id: id, user_id: user.id, messages: next });
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const { data } = await createAdminClient()
    .from("conversations")
    .select("messages")
    .eq("video_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  return Response.json({ messages: (data?.messages as ChatMessage[] | null) ?? [] });
}
