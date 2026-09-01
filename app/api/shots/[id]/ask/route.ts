import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/constants";
import { jsonError } from "@/lib/http";
import { formatKnowledgeBlock, retrieveKnowledge } from "@/lib/knowledge";
import { formatAboutFilmmaker, type UserPreferences } from "@/lib/preferences";
import { askSystemPrompt } from "@/lib/prompts/ask";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getShot } from "@/lib/shots";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AskSchema } from "@/lib/validation";

export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * Follow-up questions about a shot, grounded in its record and the knowledge
 * base. Spend is capped by a per-user rolling budget, not per conversation:
 * a per-conversation cap is unbounded in aggregate once the library has many
 * readable shots.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to ask about a shot", 401);

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

  const shot = await getShot(id, user.id);
  if (!shot?.metadata) return jsonError("Not found", 404);

  const admin = createAdminClient();
  const [{ data: existing }, { data: prefs }, { data: insight }] = await Promise.all([
    admin.from("conversations").select("id, messages").eq("shot_id", id).eq("user_id", user.id).maybeSingle(),
    supabase.from("user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    admin
      .from("prompt_insights")
      .select("summary")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const prior = (existing?.messages as ChatMessage[] | null) ?? [];
  const tags = shot.tags.length ? shot.tags : (shot.metadata.tags ?? []);
  const knowledge = await retrieveKnowledge(
    [parsed.data.question, shot.metadata.description, tags.join(" ")].filter(Boolean).join(" "),
    6,
    { tags }
  ).catch(() => []);

  const system = askSystemPrompt({
    aboutFilmmaker: formatAboutFilmmaker((prefs as UserPreferences | null) ?? null) ?? undefined,
    failureModes: (insight?.summary as string | null) ?? undefined,
    knowledgeBlock: formatKnowledgeBlock(knowledge) ?? undefined,
    breakdownJson: JSON.stringify(shot.metadata),
    title: shot.title,
  });

  const imageBlocks: Anthropic.ContentBlockParam[] = shot.posterUrl
    ? [{ type: "image", source: { type: "url", url: shot.posterUrl } }]
    : [];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [
      ...prior.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
      { role: "user", content: [...imageBlocks, { type: "text", text: parsed.data.question }] },
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
          await admin.from("conversations").insert({ shot_id: id, user_id: user.id, messages: next });
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
    .eq("shot_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  return Response.json({ messages: (data?.messages as ChatMessage[] | null) ?? [] });
}
