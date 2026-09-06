import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FEATURES } from "@/lib/features";
import { jsonError } from "@/lib/http";
import { runLearningWorker } from "@/lib/learning/worker";
import { enqueueLearningJob } from "@/lib/learning/queue";
import { retrieveKnowledge } from "@/lib/knowledge";
import { writePromptInsights } from "@/lib/cron-jobs";
import { z } from "zod";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["tick", "seed", "retry_failed", "reembed_batch", "ingest_learn"]),
    batch: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    action: z.enum(["probe_rag", "distill_corrections", "prompt_insights", "rechunk_knowledge"]),
    query: z.string().min(3).max(300).optional(),
    batch: z.number().int().min(1).max(50).optional(),
  }),
]);

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { admin: false };
  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  return { admin: !!profile?.is_admin };
}

export async function POST(request: Request) {
  if (!FEATURES.adminLearning) return jsonError("Not found", 404);

  const { admin } = await requireAdmin();
  if (!admin) return jsonError("Not found", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const batch = "batch" in parsed.data ? (parsed.data.batch ?? 8) : 8;

  switch (parsed.data.action) {
    case "tick": {
      const result = await runLearningWorker(batch);
      return NextResponse.json({ ok: true, ...result });
    }
    case "seed": {
      const { seedRecurringLearningJobs, seedAllCurriculum } = await import("@/lib/learning/jobs");
      let seeded = await seedRecurringLearningJobs();
      seeded += await seedAllCurriculum(5);
      return NextResponse.json({ ok: true, seeded });
    }
    case "retry_failed": {
      const service = createAdminClient();
      const { data: failed } = await service
        .from("learning_jobs")
        .select("id")
        .eq("status", "failed")
        .limit(batch);
      let retried = 0;
      for (const row of failed ?? []) {
        await service
          .from("learning_jobs")
          .update({ status: "pending", attempts: 0, error_message: null, scheduled_at: new Date().toISOString() })
          .eq("id", row.id);
        retried += 1;
      }
      return NextResponse.json({ ok: true, retried });
    }
    case "reembed_batch": {
      const id = await enqueueLearningJob("reembed_batch", { limit: batch * 3 }, { priority: 9 });
      return NextResponse.json({ ok: true, jobId: id });
    }
    case "ingest_learn": {
      const id = await enqueueLearningJob("ingest_learn", {}, { priority: 8 });
      return NextResponse.json({ ok: true, jobId: id });
    }
    case "probe_rag": {
      const query = parsed.data.query ?? "cinematography lighting lens";
      const articles = await retrieveKnowledge(query, 8);
      return NextResponse.json({
        ok: true,
        results: articles.map((a) => ({
          slug: a.slug,
          title: a.title,
          source_type: a.source_type,
          similarity: a.similarity,
          heading: a.heading ?? null,
          preview: a.content.slice(0, 280),
        })),
      });
    }
    case "distill_corrections": {
      const id = await enqueueLearningJob(
        "distill_corrections",
        { limit: batch * 3 },
        { priority: 8 }
      );
      return NextResponse.json({ ok: true, jobId: id });
    }
    case "rechunk_knowledge": {
      const id = await enqueueLearningJob(
        "rechunk_knowledge",
        { limit: batch * 3 },
        { priority: 8 }
      );
      return NextResponse.json({ ok: true, jobId: id });
    }
    case "prompt_insights": {
      const result = await writePromptInsights();
      return NextResponse.json({ ok: true, ...result });
    }
    default:
      return jsonError("Unknown action", 400);
  }
}
