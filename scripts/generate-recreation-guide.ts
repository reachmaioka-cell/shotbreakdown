/**
 * Generate an on-demand recreation guide for one shot (same path as the job).
 *
 *   npx tsx --env-file=.env.local scripts/generate-recreation-guide.ts --shot=<uuid>
 *   npx tsx --env-file=.env.local scripts/generate-recreation-guide.ts --missing
 */
import { runGenerateRecreationGuide } from "../lib/pipeline/stages";
import { createAdminClient } from "../lib/supabase/admin";
import { hasRecreationGuide } from "../lib/validation";

const args = process.argv.slice(2);
const shotArg = args.find((a) => a.startsWith("--shot="));
const missing = args.includes("--missing");

async function main() {
  const admin = createAdminClient();
  let shotId = shotArg?.split("=")[1];

  if (!shotId && missing) {
    const { data, error } = await admin
      .from("shots")
      .select("id, metadata, visibility, status")
      .eq("visibility", "public")
      .eq("status", "complete")
      .limit(80);
    if (error) throw new Error(error.message);
    const candidate = (data ?? []).find(
      (row) => !hasRecreationGuide(row.metadata as { recreation_steps?: string[] })
    );
    if (!candidate) {
      console.log("every public shot already has a recreation guide");
      return;
    }
    shotId = candidate.id as string;
  }

  if (!shotId) {
    console.error("pass --shot=<uuid> or --missing");
    process.exit(1);
  }

  console.log("generating recreation guide for", shotId);
  const result = await runGenerateRecreationGuide({
    id: "script",
    video_id: null,
    user_id: null,
    job_type: "generate_recreation_guide",
    payload: { shotId },
    status: "running",
    attempts: 1,
    max_attempts: 1,
    error_message: null,
  });
  console.log("done", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
