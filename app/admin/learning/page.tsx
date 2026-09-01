import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SiteHeader } from "@/components/site-header";
import { MUSIC_VIDEO_CURRICULUM } from "@/lib/learning/music-videos";
import { FILM_CURRICULUM } from "@/lib/learning/films";
import { TECHNIQUE_CURRICULUM } from "@/lib/learning/techniques";
import { AI_TOOL_CURRICULUM } from "@/lib/learning/ai-tools";
import { LearningActions } from "./learning-actions";
import { RagProbe } from "./rag-probe";

export default async function AdminLearningPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) notFound();

  const admin = createAdminClient();

  const [
    { count: pending },
    { count: running },
    { count: failed },
    { count: articles },
    { count: embedded },
    { data: recentJobs },
    { data: curriculumDone },
  ] = await Promise.all([
    admin.from("learning_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("learning_jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
    admin.from("learning_jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    admin.from("knowledge_articles").select("id", { count: "exact", head: true }),
    admin
      .from("knowledge_articles")
      .select("id", { count: "exact", head: true })
      .not("embedding", "is", null),
    admin
      .from("learning_jobs")
      .select("job_type, status, completed_at, error_message, result")
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("knowledge_articles")
      .select("slug, title, source_type, updated_at")
      .in("source_type", ["curriculum", "web", "correction"])
      .order("updated_at", { ascending: false })
      .limit(12),
  ]);

  const mvDone = (curriculumDone ?? []).filter((a) => a.slug.startsWith("mv-")).length;
  const filmDone = (curriculumDone ?? []).filter((a) => a.slug.startsWith("film-")).length;
  const aiDone = (curriculumDone ?? []).filter((a) => a.slug.startsWith("ai-")).length;
  const techniqueDone = (curriculumDone ?? []).filter((a) => a.slug.startsWith("web-")).length;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-6 py-10 w-full">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-sm font-medium text-zinc-200">Learning agent</h1>
          <Link href="/admin/review" className="text-xs text-zinc-500 hover:text-white">
            Review →
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
          {[
            { label: "Pending", value: pending ?? 0 },
            { label: "Running", value: running ?? 0 },
            { label: "Failed", value: failed ?? 0 },
            { label: "Articles", value: articles ?? 0 },
          ].map((stat) => (
            <div key={stat.label} className="border border-zinc-800 rounded-md p-3">
              <p className="text-xs text-zinc-500">{stat.label}</p>
              <p className="text-lg text-white mt-1">{stat.value}</p>
            </div>
          ))}
        </div>

        {(embedded ?? 0) < (articles ?? 0) ? (
          <p className="text-xs text-amber-600/90 border border-amber-900/50 rounded-md px-3 py-2 mb-6">
            {embedded ?? 0} / {articles ?? 0} articles have embeddings. Set{" "}
            <code className="text-amber-500">OPENAI_API_KEY</code> in .env.local, then click{" "}
            <strong className="text-amber-400">Run batch</strong> to backfill vectors — without this,
            RAG falls back to 8 static topics only.
          </p>
        ) : null}

        <LearningActions />

        <RagProbe />

        <section className="mb-10">
          <h2 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Curriculum progress</h2>
          <ul className="text-sm text-zinc-300 space-y-1">
            <li>Music videos: {mvDone} / {MUSIC_VIDEO_CURRICULUM.length} ingested</li>
            <li>Film trailers: {filmDone} / {FILM_CURRICULUM.length} ingested</li>
            <li>AI tools: {aiDone} / {AI_TOOL_CURRICULUM.length} ingested</li>
            <li>Techniques: {techniqueDone} / {TECHNIQUE_CURRICULUM.length} ingested</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Recent knowledge</h2>
          <ul className="flex flex-col gap-2">
            {(curriculumDone ?? []).map((row) => (
              <li key={row.slug} className="text-sm text-zinc-400">
                <span className="text-zinc-200">{row.title}</span>
                <span className="text-zinc-600 ml-2">{row.source_type}</span>
              </li>
            ))}
            {(curriculumDone ?? []).length === 0 ? (
              <li className="text-sm text-zinc-600">No curriculum articles yet — start the worker.</li>
            ) : null}
          </ul>
        </section>

        <section>
          <h2 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Recent jobs</h2>
          <ul className="flex flex-col gap-2">
            {(recentJobs ?? []).map((job, i) => (
              <li key={i} className="text-xs text-zinc-500 flex justify-between gap-4">
                <span>
                  <span className="text-zinc-300">{job.job_type}</span> · {job.status}
                  {job.error_message ? ` — ${job.error_message}` : ""}
                </span>
                {job.completed_at ? (
                  <span className="shrink-0">{new Date(job.completed_at).toLocaleString()}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <p className="text-xs text-zinc-600 mt-10">
          Run locally: <code className="text-zinc-400">npm run learning:worker</code> · Production: ping{" "}
          <code className="text-zinc-400">/api/cron/learning?batch=5</code> every 1–5 min
        </p>
      </main>
    </div>
  );
}
